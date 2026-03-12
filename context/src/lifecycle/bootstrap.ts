// SPDX-License-Identifier: Apache-2.0

import type { BootstrapResult } from "openclaw/context-engine/types";
import { nowIso } from "../helpers/clock.js";
import type { ContextServices, DigestEntry, PromptSlot, RecallCandidate, TurnEntry } from "../types/domain.js";
import type { SessionStateRow } from "../types/storage.js";
import { buildStartupRecallQuery } from "../codec/query-extractor.js";
import { normalizeTurnBatch, readSessionMessagesFromFile } from "../codec/turn-normalizer.js";
import { filterRecallCandidates } from "../search/recall-filter.js";
import { stringifyJson } from "../utils/json.js";

function makePromptSlot(params: {
  sessionId: string;
  slotNo: number;
  entryId: string;
  slotType: PromptSlot["slot_type"];
  holdMode: PromptSlot["hold_mode"];
}): PromptSlot {
  return {
    session_id: params.sessionId,
    slot_no: params.slotNo,
    entry_id: params.entryId,
    slot_type: params.slotType,
    hold_mode: params.holdMode,
    updated_at: nowIso(),
  };
}

function overlapsTail(entry: DigestEntry, range: { start: number; end: number } | undefined): boolean {
  if (!range) {
    return false;
  }
  return entry.turn_from <= range.end && range.start <= entry.turn_to;
}

function selectAnchorsWithinTokenCap(
  recallHits: RecallCandidate[],
  tokenCap: number,
): DigestEntry[] {
  const chosenAnchors: DigestEntry[] = [];
  let consumedTokens = 0;
  for (const recallHit of recallHits) {
    const nextTokenTotal = consumedTokens + Math.max(recallHit.entry.token_estimate, 1);
    if (chosenAnchors.length > 0 && nextTokenTotal > tokenCap) {
      break;
    }
    chosenAnchors.push(recallHit.entry);
    consumedTokens = nextTokenTotal;
  }
  return chosenAnchors;
}

function pickRollups(params: {
  digests: DigestEntry[];
  excludedIds: Set<string>;
  protectedTailRange?: { start: number; end: number };
  limit: number;
}): DigestEntry[] {
  const accepted: DigestEntry[] = [];
  for (const digest of [...params.digests].sort(
    (a, b) => b.layer_no - a.layer_no || a.turn_from - b.turn_from,
  )) {
    if (params.excludedIds.has(digest.entry_id)) {
      continue;
    }
    if (overlapsTail(digest, params.protectedTailRange)) {
      continue;
    }
    if (
      accepted.some(
        (keptDigest) =>
          keptDigest.turn_from <= digest.turn_to && digest.turn_from <= keptDigest.turn_to,
      )
    ) {
      continue;
    }
    accepted.push(digest);
    if (accepted.length >= params.limit) {
      break;
    }
  }
  return accepted.sort((a, b) => a.turn_from - b.turn_from);
}

function buildPromptViewRows(params: {
  sessionId: string;
  anchors: DigestEntry[];
  rollups: DigestEntry[];
  tails: TurnEntry[];
}): PromptSlot[] {
  const rows: PromptSlot[] = [];
  let slotNo = 0;

  for (const entry of params.anchors) {
    rows.push(
      makePromptSlot({
        sessionId: params.sessionId,
        slotNo,
        entryId: entry.entry_id,
        slotType: "anchor",
        holdMode: "normal",
      }),
    );
    slotNo += 1;
  }

  for (const entry of params.rollups) {
    rows.push(
      makePromptSlot({
        sessionId: params.sessionId,
        slotNo,
        entryId: entry.entry_id,
        slotType: "rollup",
        holdMode: "normal",
      }),
    );
    slotNo += 1;
  }

  for (const entry of params.tails) {
    rows.push(
      makePromptSlot({
        sessionId: params.sessionId,
        slotNo,
        entryId: entry.entry_id,
        slotType: "tail",
        holdMode: "sticky",
      }),
    );
    slotNo += 1;
  }

  return rows;
}

function buildSessionStateRow(params: {
  previousRow: SessionStateRow | null;
  sessionId: string;
  sessionFile: string;
  importedTurnCount: number;
  lastTurnSeq: number;
  highestLayerNo: number;
  startupProbeText: string;
  dirtyTextIndex: boolean;
  dirtyVectorEntryIds: string[];
}): SessionStateRow {
  const timestamp = nowIso();
  return {
    session_id: params.sessionId,
    session_file: params.sessionFile,
    imported_turn_count: params.importedTurnCount,
    last_turn_seq: params.lastTurnSeq,
    highest_layer_no: params.highestLayerNo,
    startup_probe_text: params.startupProbeText,
    dirty_text_index: params.dirtyTextIndex,
    dirty_vector_entry_ids_json: stringifyJson(params.dirtyVectorEntryIds),
    created_at: params.previousRow?.created_at ?? timestamp,
    updated_at: timestamp,
    meta_json: params.previousRow?.meta_json ?? "{}",
  };
}

async function backfillDigestVectors(
  services: ContextServices,
  sessionId: string,
  digests: DigestEntry[],
): Promise<string[]> {
  const pendingDigestIds: string[] = [];
  for (const digest of digests) {
    if (digest.vector_blob && digest.vector_size > 0) {
      continue;
    }
    try {
      const vector = await services.embedder.embedText(digest.plain_text);
      await services.vectorWriter.writeVector({
        sessionId,
        entryId: digest.entry_id,
        vector,
        modelId: services.config.semanticIndex.model,
      });
    } catch (error) {
      services.logger.warn("digest vector backfill failed", {
        sessionId,
        entryId: digest.entry_id,
        error: error instanceof Error ? error.message : String(error),
      });
      pendingDigestIds.push(digest.entry_id);
    }
  }
  return pendingDigestIds;
}

export async function bootstrapContext(
  services: ContextServices,
  params: { sessionId: string; sessionFile: string },
): Promise<BootstrapResult> {
  await services.indexMaintainer.ensureBaseIndexes();

  const existingState = await services.sessionStateReader.get(params.sessionId);
  const turnCountBefore = await services.entryStoreReader.getTurnCount(params.sessionId);
  const transcriptMessages = readSessionMessagesFromFile(params.sessionFile);
  const turnDrafts = normalizeTurnBatch({
    sessionId: params.sessionId,
    messages: transcriptMessages,
    startSeq: 1,
    trimTextChars: services.config.internal.trimTextChars,
  });
  await services.entryStoreWriter.writeTurnDrafts(params.sessionId, turnDrafts);

  const turns = await services.entryStoreReader.listTurns(params.sessionId);
  let digests = await services.entryStoreReader.listDigests(params.sessionId);
  const outstandingVectorIds = await backfillDigestVectors(services, params.sessionId, digests);
  digests = await services.entryStoreReader.listDigests(params.sessionId);

  const startupProbeText = buildStartupRecallQuery(
    turns,
    services.config.internal.bootstrapQueryWindow,
  );
  const tails = digests.length === 0 ? turns : turns.slice(-services.config.tailKeepCount);
  const protectedTailRange =
    tails.length > 0
      ? { start: tails[0]!.turn_from, end: tails[tails.length - 1]!.turn_to }
      : undefined;

  let anchors: DigestEntry[] = [];
  if (startupProbeText && services.config.startupRecallLimit > 0) {
    const recallHits = await services.hybridRecall.recall({
      sessionId: params.sessionId,
      query: startupProbeText,
      limit: Math.max(services.config.startupRecallLimit * 4, services.config.startupRecallLimit),
    });
    anchors = selectAnchorsWithinTokenCap(
      filterRecallCandidates({
        candidates: recallHits,
        excludedEntryIds: new Set<string>(),
        protectedTailRange,
        floorScore: services.config.internal.recallFloorScore,
        limit: services.config.startupRecallLimit,
      }),
      services.config.internal.bootstrapRecallTokenCap,
    );
  }

  const blockedEntryIds = new Set<string>(anchors.map((entry) => entry.entry_id));
  const rollups = digests.length === 0
    ? []
    : pickRollups({
        digests,
        excludedIds: blockedEntryIds,
        protectedTailRange,
        limit: services.config.internal.rollupBaselineLimit,
      });
  const promptRows = buildPromptViewRows({
    sessionId: params.sessionId,
    anchors,
    rollups,
    tails,
  });

  if (digests.length === 0 && turns.length > 0) {
    await services.promptViewWriter.replace(
      params.sessionId,
      turns.map((turn, index) =>
        makePromptSlot({
          sessionId: params.sessionId,
          slotNo: index,
          entryId: turn.entry_id,
          slotType: "tail",
          holdMode: "sticky",
        }),
      ),
    );
  } else {
    await services.promptViewWriter.replace(params.sessionId, promptRows);
  }

  const nextState = buildSessionStateRow({
    previousRow: existingState,
    sessionId: params.sessionId,
    sessionFile: params.sessionFile,
    importedTurnCount: turns.length,
    lastTurnSeq: turns[turns.length - 1]?.turn_to ?? 0,
    highestLayerNo: digests.reduce((max, digest) => Math.max(max, digest.layer_no), 0),
    startupProbeText,
    dirtyTextIndex: turnDrafts.length > 0,
    dirtyVectorEntryIds: outstandingVectorIds,
  });
  await services.sessionStateWriter.upsert(nextState);
  await services.indexMaintainer.retryDirtyState(params.sessionId);

  return {
    bootstrapped: true,
    importedMessages: Math.max(0, turns.length - turnCountBefore),
  };
}
