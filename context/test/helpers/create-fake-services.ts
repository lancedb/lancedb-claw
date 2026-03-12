// SPDX-License-Identifier: Apache-2.0

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { nowIso } from "../../src/helpers/clock.js";
import { resolveContextConfig } from "../../src/types/config.js";
import type {
  ContextServices,
  ContextLogger,
  DigestBuildResult,
  DigestEntry,
  PromptSlot,
  RecallCandidate,
  TurnDraft,
  TurnEntry,
} from "../../src/types/domain.js";
import type { EntryStoreRow, SessionStateRow } from "../../src/types/storage.js";
import { makeDigestEntryId } from "../../src/helpers/ids.js";
import { stringifyJson } from "../../src/utils/json.js";

type FakeState = {
  sessionState: Map<string, SessionStateRow>;
  entryStore: Map<string, EntryStoreRow[]>;
  promptView: Map<string, PromptSlot[]>;
  calls: {
    syncAfterTurn: Array<{ sessionId: string; newTurnIds: string[] }>;
    syncAfterShrink: Array<{ sessionId: string; newDigestId: string }>;
    retryDirtyState: string[];
  };
};

type FakeOptions = {
  recallCandidates?: RecallCandidate[];
  embedVector?: number[];
  digestText?: string;
};

function createLogger(): ContextLogger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function getEntries(state: FakeState, sessionId: string): EntryStoreRow[] {
  return state.entryStore.get(sessionId) ?? [];
}

function setEntries(state: FakeState, sessionId: string, rows: EntryStoreRow[]): void {
  state.entryStore.set(
    sessionId,
    [...rows].sort((a, b) => a.turn_from - b.turn_from || a.layer_no - b.layer_no),
  );
}

function toTurnRow(sessionId: string, draft: TurnDraft): TurnEntry {
  const timestamp = nowIso();
  return {
    entry_id: draft.entryId,
    session_id: sessionId,
    entry_kind: "turn",
    render_role: draft.role,
    turn_from: draft.turnFrom,
    turn_to: draft.turnTo,
    layer_no: 0,
    plain_text: draft.plainText,
    payload_json: stringifyJson(draft.payload),
    token_estimate: draft.tokenEstimate,
    covered_token_estimate: draft.tokenEstimate,
    origin_entry_ids_json: "[]",
    vector_blob: null,
    vector_model_id: "",
    vector_size: 0,
    created_at: timestamp,
    updated_at: timestamp,
    meta_json: "{}",
  };
}

export function createFakeServices(options: FakeOptions = {}): {
  services: ContextServices;
  state: FakeState;
} {
  const state: FakeState = {
    sessionState: new Map(),
    entryStore: new Map(),
    promptView: new Map(),
    calls: {
      syncAfterTurn: [],
      syncAfterShrink: [],
      retryDirtyState: [],
    },
  };
  const config = resolveContextConfig(
    {
      semanticIndex: {
        apiKey: "test-key",
      },
    },
    (input) => input,
  );
  const logger = createLogger();

  const services: ContextServices = {
    config,
    logger,
    runtimeBridge: {
      readDefaultModelRef: () => "",
      readProviderApi: () => undefined,
      resolveApiKeyForModel: async () => undefined,
      resolveAgentDir: () => ".",
    },
    db: {
      ensureInitialized: async () => undefined,
      dispose: async () => undefined,
    },
    queue: {
      run: async (_sessionId, task) => task(),
    },
    sessionStateReader: {
      get: async (sessionId) => state.sessionState.get(sessionId) ?? null,
    },
    entryStoreReader: {
      getTurnCount: async (sessionId) =>
        getEntries(state, sessionId).filter((entry): entry is TurnEntry => entry.entry_kind === "turn")
          .length,
      getMaxTurnSeq: async (sessionId) =>
        getEntries(state, sessionId)
          .filter((entry): entry is TurnEntry => entry.entry_kind === "turn")
          .reduce((max, entry) => Math.max(max, entry.turn_to), 0),
      listTurns: async (sessionId) =>
        getEntries(state, sessionId).filter((entry): entry is TurnEntry => entry.entry_kind === "turn"),
      listDigests: async (sessionId) =>
        getEntries(state, sessionId).filter(
          (entry): entry is DigestEntry => entry.entry_kind === "digest",
        ),
      listEntriesByIds: async (sessionId, entryIds) => {
        const wanted = new Set(entryIds);
        return getEntries(state, sessionId).filter((entry) => wanted.has(entry.entry_id));
      },
      listPendingDigestVectors: async (sessionId) =>
        getEntries(state, sessionId).filter(
          (entry): entry is DigestEntry =>
            entry.entry_kind === "digest" && (!entry.vector_blob || entry.vector_size <= 0),
        ),
      getById: async (sessionId, entryId) =>
        getEntries(state, sessionId).find((entry) => entry.entry_id === entryId) ?? null,
    },
    promptViewReader: {
      list: async (sessionId) =>
        [...(state.promptView.get(sessionId) ?? [])].sort((a, b) => a.slot_no - b.slot_no),
    },
    sessionStateWriter: {
      upsert: async (row) => {
        state.sessionState.set(row.session_id, row);
      },
      markDirtyText: async (sessionId, value) => {
        const row = state.sessionState.get(sessionId);
        if (!row) {
          return;
        }
        state.sessionState.set(sessionId, { ...row, dirty_text_index: value, updated_at: nowIso() });
      },
      addDirtyVectorId: async (sessionId, entryId) => {
        const row = state.sessionState.get(sessionId);
        if (!row) {
          return;
        }
        const next = new Set(JSON.parse(row.dirty_vector_entry_ids_json) as string[]);
        next.add(entryId);
        state.sessionState.set(sessionId, {
          ...row,
          dirty_vector_entry_ids_json: JSON.stringify([...next]),
          updated_at: nowIso(),
        });
      },
      clearDirtyVectorIds: async (sessionId, entryIds) => {
        const row = state.sessionState.get(sessionId);
        if (!row) {
          return;
        }
        const toRemove = new Set(entryIds);
        const next = (JSON.parse(row.dirty_vector_entry_ids_json) as string[]).filter(
          (entryId) => !toRemove.has(entryId),
        );
        state.sessionState.set(sessionId, {
          ...row,
          dirty_vector_entry_ids_json: JSON.stringify(next),
          updated_at: nowIso(),
        });
      },
    },
    entryStoreWriter: {
      writeTurns: async (rows) => {
        if (rows.length === 0) {
          return;
        }
        const sessionId = rows[0]!.session_id;
        const existing = getEntries(state, sessionId);
        const next = new Map(existing.map((entry) => [entry.entry_id, entry]));
        for (const row of rows) {
          next.set(row.entry_id, row);
        }
        setEntries(state, sessionId, [...next.values()]);
      },
      writeTurnDrafts: async (sessionId, drafts) => {
        const rows = drafts.map((draft) => toTurnRow(sessionId, draft));
        await services.entryStoreWriter.writeTurns(rows);
        return rows;
      },
      writeDigest: async (row) => {
        const existing = getEntries(state, row.session_id);
        const next = new Map(existing.map((entry) => [entry.entry_id, entry]));
        next.set(row.entry_id, row);
        setEntries(state, row.session_id, [...next.values()]);
      },
    },
    promptViewWriter: {
      replace: async (sessionId, rows) => {
        state.promptView.set(
          sessionId,
          [...rows].sort((a, b) => a.slot_no - b.slot_no),
        );
      },
      append: async (rows) => {
        if (rows.length === 0) {
          return;
        }
        const sessionId = rows[0]!.session_id;
        const existing = state.promptView.get(sessionId) ?? [];
        state.promptView.set(
          sessionId,
          [...existing, ...rows].sort((a, b) => a.slot_no - b.slot_no),
        );
      },
    },
    vectorWriter: {
      writeVector: async ({ sessionId, entryId, vector, modelId }) => {
        const entries = getEntries(state, sessionId);
        setEntries(
          state,
          sessionId,
          entries.map((entry) =>
            entry.entry_id === entryId
              ? {
                  ...entry,
                  vector_blob: vector,
                  vector_model_id: modelId,
                  vector_size: vector.length,
                  updated_at: nowIso(),
                }
              : entry,
          ),
        );
      },
    },
    indexMaintainer: {
      ensureBaseIndexes: async () => undefined,
      syncAfterTurn: async (sessionId, newTurnIds) => {
        state.calls.syncAfterTurn.push({ sessionId, newTurnIds });
        const row = state.sessionState.get(sessionId);
        if (row) {
          state.sessionState.set(sessionId, { ...row, dirty_text_index: false, updated_at: nowIso() });
        }
      },
      syncAfterShrink: async (sessionId, newDigestId) => {
        state.calls.syncAfterShrink.push({ sessionId, newDigestId });
        const row = state.sessionState.get(sessionId);
        if (row) {
          const pending = (JSON.parse(row.dirty_vector_entry_ids_json) as string[]).filter(
            (entryId) => entryId !== newDigestId,
          );
          state.sessionState.set(sessionId, {
            ...row,
            dirty_text_index: false,
            dirty_vector_entry_ids_json: JSON.stringify(pending),
            updated_at: nowIso(),
          });
        }
      },
      retryDirtyState: async (sessionId) => {
        state.calls.retryDirtyState.push(sessionId);
        const row = state.sessionState.get(sessionId);
        if (row) {
          state.sessionState.set(sessionId, { ...row, dirty_text_index: false, updated_at: nowIso() });
        }
      },
    },
    hybridRecall: {
      recall: async () => options.recallCandidates ?? [],
    },
    digestBuilder: {
      buildDigest: async ({ sessionId, sourceEntries, customInstructions }) => {
        const turnFrom = Math.min(...sourceEntries.map((entry) => entry.turn_from));
        const turnTo = Math.max(...sourceEntries.map((entry) => entry.turn_to));
        const layerNo = Math.max(...sourceEntries.map((entry) => entry.layer_no)) + 1;
        const plainText = options.digestText ?? `Digest for ${turnFrom}-${turnTo}`;
        const draft: DigestBuildResult["draft"] = {
          entryId: makeDigestEntryId({
            sessionId,
            layerNo,
            turnFrom,
            turnTo,
            originEntryIds: sourceEntries.map((entry) => entry.entry_id),
            plainText,
          }),
          turnFrom,
          turnTo,
          layerNo,
          plainText,
          payload: {
            text: plainText,
            source: "fallback",
            promptVersion: customInstructions ? "v1-custom" : "v1",
          },
          tokenEstimate: Math.max(1, Math.ceil(plainText.length / 4)),
          coveredTokenEstimate: sourceEntries.reduce((sum, entry) => sum + entry.token_estimate, 0),
          originEntryIds: sourceEntries.map((entry) => entry.entry_id),
        };
        return { draft };
      },
      toDigestRow: (sessionId, build) => {
        const timestamp = nowIso();
        return {
          entry_id: build.entryId,
          session_id: sessionId,
          entry_kind: "digest",
          render_role: "digest",
          turn_from: build.turnFrom,
          turn_to: build.turnTo,
          layer_no: build.layerNo,
          plain_text: build.plainText,
          payload_json: stringifyJson(build.payload),
          token_estimate: build.tokenEstimate,
          covered_token_estimate: build.coveredTokenEstimate,
          origin_entry_ids_json: stringifyJson(build.originEntryIds),
          vector_blob: null,
          vector_model_id: "",
          vector_size: 0,
          created_at: timestamp,
          updated_at: timestamp,
          meta_json: "{}",
        };
      },
    },
    embedder: {
      embedText: async () => options.embedVector ?? [0.1, 0.2, 0.3],
    },
  };

  return { services, state };
}
