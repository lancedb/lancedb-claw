// SPDX-License-Identifier: Apache-2.0

import type { IngestBatchResult, IngestResult } from "openclaw/context-engine/types";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { nowIso } from "../helpers/clock.js";
import type { ContextServices, DigestEntry, PromptSlot, TurnEntry } from "../types/domain.js";
import type { SessionStateRow } from "../types/storage.js";
import { normalizeTurnBatch } from "../codec/turn-normalizer.js";

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

function buildSessionStateRow(params: {
  existing: SessionStateRow | null;
  sessionId: string;
  sessionFile?: string;
  importedTurnCount: number;
  lastTurnSeq: number;
  highestLayerNo: number;
}): SessionStateRow {
  const timestamp = nowIso();
  return {
    session_id: params.sessionId,
    session_file: params.sessionFile ?? params.existing?.session_file ?? "",
    imported_turn_count: params.importedTurnCount,
    last_turn_seq: params.lastTurnSeq,
    highest_layer_no: Math.max(params.existing?.highest_layer_no ?? 0, params.highestLayerNo),
    startup_probe_text: params.existing?.startup_probe_text ?? "",
    dirty_text_index: true,
    dirty_vector_entry_ids_json: params.existing?.dirty_vector_entry_ids_json ?? "[]",
    created_at: params.existing?.created_at ?? timestamp,
    updated_at: timestamp,
    meta_json: params.existing?.meta_json ?? "{}",
  };
}

function pickFallbackRollups(digests: DigestEntry[], limit: number): DigestEntry[] {
  return [...digests]
    .sort((a, b) => b.layer_no - a.layer_no || a.turn_from - b.turn_from)
    .slice(0, limit)
    .sort((a, b) => a.turn_from - b.turn_from);
}

function buildFallbackPromptRows(params: {
  sessionId: string;
  turns: TurnEntry[];
  digests: DigestEntry[];
  tailKeepCount: number;
  rollupLimit: number;
}): PromptSlot[] {
  if (params.digests.length === 0) {
    return params.turns.map((turn, index) =>
      makePromptSlot({
        sessionId: params.sessionId,
        slotNo: index,
        entryId: turn.entry_id,
        slotType: "tail",
        holdMode: "sticky",
      }),
    );
  }

  const tails = params.turns.slice(-params.tailKeepCount);
  const tailEntryIds = new Set(tails.map((turn) => turn.entry_id));
  const rollups = pickFallbackRollups(params.digests, params.rollupLimit).filter(
    (digest) => !tailEntryIds.has(digest.entry_id),
  );

  const rows: PromptSlot[] = [];
  let slotNo = 0;
  for (const digest of rollups) {
    rows.push(
      makePromptSlot({
        sessionId: params.sessionId,
        slotNo,
        entryId: digest.entry_id,
        slotType: "rollup",
        holdMode: "normal",
      }),
    );
    slotNo += 1;
  }
  for (const turn of tails) {
    rows.push(
      makePromptSlot({
        sessionId: params.sessionId,
        slotNo,
        entryId: turn.entry_id,
        slotType: "tail",
        holdMode: "sticky",
      }),
    );
    slotNo += 1;
  }
  return rows;
}

export async function appendTurnMessages(
  services: ContextServices,
  params: {
    sessionId: string;
    messages: AgentMessage[];
    sessionFile?: string;
  },
): Promise<{ rows: TurnEntry[] }> {
  await services.indexMaintainer.ensureBaseIndexes();

  const startSeq = (await services.entryStoreReader.getMaxTurnSeq(params.sessionId)) + 1;
  const drafts = normalizeTurnBatch({
    sessionId: params.sessionId,
    messages: params.messages,
    startSeq,
    trimTextChars: services.config.internal.trimTextChars,
  });
  if (drafts.length === 0) {
    return { rows: [] };
  }

  const rows = await services.entryStoreWriter.writeTurnDrafts(params.sessionId, drafts);
  const promptRows = await services.promptViewReader.list(params.sessionId);
  if (promptRows.length === 0) {
    const turns = await services.entryStoreReader.listTurns(params.sessionId);
    const digests = await services.entryStoreReader.listDigests(params.sessionId);
    await services.promptViewWriter.replace(
      params.sessionId,
      buildFallbackPromptRows({
        sessionId: params.sessionId,
        turns,
        digests,
        tailKeepCount: services.config.tailKeepCount,
        rollupLimit: services.config.internal.rollupBaselineLimit,
      }),
    );
  } else {
    const startSlotNo = promptRows[promptRows.length - 1]!.slot_no + 1;
    await services.promptViewWriter.append(
      rows.map((row, index) =>
        makePromptSlot({
          sessionId: params.sessionId,
          slotNo: startSlotNo + index,
          entryId: row.entry_id,
          slotType: "tail",
          holdMode: "sticky",
        }),
      ),
    );
  }

  const turns = await services.entryStoreReader.listTurns(params.sessionId);
  const digests = await services.entryStoreReader.listDigests(params.sessionId);
  const existingState = await services.sessionStateReader.get(params.sessionId);
  await services.sessionStateWriter.upsert(
    buildSessionStateRow({
      existing: existingState,
      sessionId: params.sessionId,
      sessionFile: params.sessionFile,
      importedTurnCount: turns.length,
      lastTurnSeq: turns[turns.length - 1]?.turn_to ?? 0,
      highestLayerNo: digests.reduce((max, digest) => Math.max(max, digest.layer_no), 0),
    }),
  );

  return { rows };
}

export async function ingestContext(
  services: ContextServices,
  params: {
    sessionId: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  },
): Promise<IngestResult> {
  const result = await appendTurnMessages(services, {
    sessionId: params.sessionId,
    messages: [params.message],
  });
  return {
    ingested: result.rows.length > 0,
  };
}

export async function ingestBatchContext(
  services: ContextServices,
  params: {
    sessionId: string;
    messages: AgentMessage[];
    isHeartbeat?: boolean;
  },
): Promise<IngestBatchResult> {
  const result = await appendTurnMessages(services, {
    sessionId: params.sessionId,
    messages: params.messages,
  });
  return {
    ingestedCount: result.rows.length,
  };
}
