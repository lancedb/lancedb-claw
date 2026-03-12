// SPDX-License-Identifier: Apache-2.0

import type { CompactResult } from "openclaw/context-engine/types";
import { nowIso } from "../helpers/clock.js";
import type { ContextServices, PromptSlot } from "../types/domain.js";
import type { EntryStoreRow, SessionStateRow } from "../types/storage.js";

type OrderedSlotEntry = {
  slot: PromptSlot;
  entry: EntryStoreRow;
};

type CompactionWindow = {
  startIndex: number;
  endIndex: number;
  entries: OrderedSlotEntry[];
};

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
  previousRow: SessionStateRow | null;
  sessionId: string;
  sessionFile: string;
  importedTurnCount: number;
  lastTurnSeq: number;
  highestLayerNo: number;
}): SessionStateRow {
  const timestamp = nowIso();
  return {
    session_id: params.sessionId,
    session_file: params.sessionFile,
    imported_turn_count: params.importedTurnCount,
    last_turn_seq: params.lastTurnSeq,
    highest_layer_no: Math.max(params.previousRow?.highest_layer_no ?? 0, params.highestLayerNo),
    startup_probe_text: params.previousRow?.startup_probe_text ?? "",
    dirty_text_index: params.previousRow?.dirty_text_index ?? false,
    dirty_vector_entry_ids_json: params.previousRow?.dirty_vector_entry_ids_json ?? "[]",
    created_at: params.previousRow?.created_at ?? timestamp,
    updated_at: timestamp,
    meta_json: params.previousRow?.meta_json ?? "{}",
  };
}

function sumEntryTokens(entries: EntryStoreRow[]): number {
  return entries.reduce(
    (sum, entry) => sum + Math.max(entry.covered_token_estimate, entry.token_estimate, 1),
    0,
  );
}

function selectCompactionWindow(
  entries: OrderedSlotEntry[],
  protectedTailStart: number,
  services: ContextServices,
): CompactionWindow | null {
  const eligibleWindowEntries = entries.slice(0, protectedTailStart);
  for (let startIndex = 0; startIndex < eligibleWindowEntries.length; startIndex += 1) {
    const firstEntry = eligibleWindowEntries[startIndex]!.entry;
    if (firstEntry.entry_kind === "turn") {
      const window: OrderedSlotEntry[] = [];
      let covered = 0;
      for (let index = startIndex; index < eligibleWindowEntries.length; index += 1) {
        const slotEntry = eligibleWindowEntries[index]!;
        if (slotEntry.entry.entry_kind !== "turn") {
          break;
        }
        window.push(slotEntry);
        covered += Math.max(
          slotEntry.entry.covered_token_estimate,
          slotEntry.entry.token_estimate,
          1,
        );
        if (
          window.length >= services.config.internal.firstDigestMinCount &&
          covered >= services.config.internal.firstDigestTokenGoal
        ) {
          return { startIndex, endIndex: index, entries: window };
        }
      }
      if (window.length >= services.config.internal.firstDigestMinCount) {
        return {
          startIndex,
          endIndex: startIndex + window.length - 1,
          entries: window,
        };
      }
      continue;
    }

    const layerNo = firstEntry.layer_no;
    const window: OrderedSlotEntry[] = [];
    let covered = 0;
    for (let index = startIndex; index < eligibleWindowEntries.length; index += 1) {
      const slotEntry = eligibleWindowEntries[index]!;
      if (slotEntry.entry.entry_kind !== "digest" || slotEntry.entry.layer_no !== layerNo) {
        break;
      }
      window.push(slotEntry);
      covered += Math.max(
        slotEntry.entry.covered_token_estimate,
        slotEntry.entry.token_estimate,
        1,
      );
      if (
        window.length >= services.config.internal.mergeDigestMinCount &&
        covered >= services.config.internal.mergeDigestTokenGoal
      ) {
        return { startIndex, endIndex: index, entries: window };
      }
    }
    if (window.length >= services.config.internal.mergeDigestMinCount) {
      return {
        startIndex,
        endIndex: startIndex + window.length - 1,
        entries: window,
      };
    }
  }

  return null;
}

export async function compactContext(
  services: ContextServices,
  params: {
    sessionId: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: Record<string, unknown>;
  },
): Promise<CompactResult> {
  await services.indexMaintainer.ensureBaseIndexes();

  const promptSlots = await services.promptViewReader.list(params.sessionId);
  if (promptSlots.length === 0) {
    return {
      ok: true,
      compacted: false,
      reason: "prompt view is empty",
    };
  }

  const entries = await services.entryStoreReader.listEntriesByIds(
    params.sessionId,
    promptSlots.map((slot) => slot.entry_id),
  );
  const entryMap = new Map(entries.map((entry) => [entry.entry_id, entry]));
  const ordered = promptSlots
    .map((slot) => {
      const entry = entryMap.get(slot.entry_id);
      return entry ? { slot, entry } : null;
    })
    .filter((item): item is OrderedSlotEntry => item !== null);

  if (ordered.length === 0) {
    return {
      ok: true,
      compacted: false,
      reason: "prompt view has no resolvable entries",
    };
  }

  const currentTokenCount =
    params.currentTokenCount ?? ordered.reduce((sum, item) => sum + item.entry.token_estimate, 0);
  if (
    !params.force &&
    (!params.tokenBudget ||
      currentTokenCount < params.tokenBudget * services.config.shrinkStartRatio)
  ) {
    return {
      ok: true,
      compacted: false,
      reason: "compaction threshold not reached",
      result: {
        tokensBefore: currentTokenCount,
      },
    };
  }

  const protectedTailStart = Math.max(0, ordered.length - services.config.tailKeepCount);
  const window = selectCompactionWindow(ordered, protectedTailStart, services);
  if (!window) {
    return {
      ok: true,
      compacted: false,
      reason: "no eligible compaction window",
      result: {
        tokensBefore: currentTokenCount,
      },
    };
  }

  const previousState = await services.sessionStateReader.get(params.sessionId);
  if (!previousState) {
    const turns = await services.entryStoreReader.listTurns(params.sessionId);
    const digests = await services.entryStoreReader.listDigests(params.sessionId);
    await services.sessionStateWriter.upsert(
      buildSessionStateRow({
        previousRow: null,
        sessionId: params.sessionId,
        sessionFile: params.sessionFile,
        importedTurnCount: turns.length,
        lastTurnSeq: turns[turns.length - 1]?.turn_to ?? 0,
        highestLayerNo: digests.reduce((max, digest) => Math.max(max, digest.layer_no), 0),
      }),
    );
  }

  const sourceEntries = window.entries.map((item) => item.entry);
  const digestBuild = await services.digestBuilder.buildDigest({
    sessionId: params.sessionId,
    sourceEntries,
    customInstructions: params.customInstructions,
  });
  const digestRow = services.digestBuilder.toDigestRow(params.sessionId, digestBuild.draft);

  await services.entryStoreWriter.writeDigest(digestRow);
  await services.sessionStateWriter.markDirtyText(params.sessionId, true);
  await services.sessionStateWriter.addDirtyVectorId(params.sessionId, digestRow.entry_id);

  try {
    const vector = await services.embedder.embedText(digestRow.plain_text);
    await services.vectorWriter.writeVector({
      sessionId: params.sessionId,
      entryId: digestRow.entry_id,
      vector,
      modelId: services.config.semanticIndex.model,
    });
  } catch (error) {
    services.logger.warn("digest vector generation failed", {
      sessionId: params.sessionId,
      entryId: digestRow.entry_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await services.indexMaintainer.syncAfterShrink(params.sessionId, digestRow.entry_id);

  const replacementRows: PromptSlot[] = [];
  let slotNo = 0;
  for (const item of ordered.slice(0, window.startIndex)) {
    replacementRows.push(
      makePromptSlot({
        sessionId: params.sessionId,
        slotNo,
        entryId: item.entry.entry_id,
        slotType: item.slot.slot_type,
        holdMode: item.slot.hold_mode,
      }),
    );
    slotNo += 1;
  }
  replacementRows.push(
    makePromptSlot({
      sessionId: params.sessionId,
      slotNo,
      entryId: digestRow.entry_id,
      slotType: "rollup",
      holdMode: "normal",
    }),
  );
  slotNo += 1;
  for (const item of ordered.slice(window.endIndex + 1)) {
    replacementRows.push(
      makePromptSlot({
        sessionId: params.sessionId,
        slotNo,
        entryId: item.entry.entry_id,
        slotType: item.slot.slot_type,
        holdMode: item.slot.hold_mode,
      }),
    );
    slotNo += 1;
  }
  await services.promptViewWriter.replace(params.sessionId, replacementRows);

  const turns = await services.entryStoreReader.listTurns(params.sessionId);
  const digests = await services.entryStoreReader.listDigests(params.sessionId);
  const refreshedState = await services.sessionStateReader.get(params.sessionId);
    await services.sessionStateWriter.upsert(
      buildSessionStateRow({
        previousRow: refreshedState,
        sessionId: params.sessionId,
        sessionFile: params.sessionFile,
        importedTurnCount: turns.length,
      lastTurnSeq: turns[turns.length - 1]?.turn_to ?? 0,
      highestLayerNo: Math.max(
        digestRow.layer_no,
        ...digests.map((digest) => digest.layer_no),
      ),
    }),
  );

  const sourceTokenCount = sumEntryTokens(sourceEntries);
  return {
    ok: true,
    compacted: true,
    result: {
      summary: digestRow.plain_text,
      firstKeptEntryId: replacementRows[Math.min(window.startIndex, replacementRows.length - 1)]?.entry_id,
      tokensBefore: currentTokenCount,
      tokensAfter: Math.max(0, currentTokenCount - sourceTokenCount + digestRow.token_estimate),
      details: {
        sourceEntryIds: sourceEntries.map((entry) => entry.entry_id),
        digestEntryId: digestRow.entry_id,
        layerNo: digestRow.layer_no,
      },
    },
  };
}
