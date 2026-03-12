// SPDX-License-Identifier: Apache-2.0

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ResolvedContextConfig } from "./config.js";
import type { EntryStoreRow, PromptViewRow, SessionStateRow } from "./storage.js";
import type { DigestResolution } from "./runtime.js";

export type EntryKind = "turn" | "digest";
export type SlotType = "anchor" | "rollup" | "tail";
export type HoldMode = "sticky" | "normal";

export type ContextLogger = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export type TurnEntry = EntryStoreRow & {
  entry_kind: "turn";
};

export type DigestEntry = EntryStoreRow & {
  entry_kind: "digest";
};

export type PromptSlot = PromptViewRow;

export type RecallCandidate = {
  entry: DigestEntry;
  score: number;
  vectorScore: number;
  textScore: number;
  source: "vector" | "text" | "hybrid";
};

export type TurnDraft = {
  entryId: string;
  role: string;
  turnFrom: number;
  turnTo: number;
  plainText: string;
  payload: AgentMessage;
  tokenEstimate: number;
};

export type DigestDraft = {
  entryId: string;
  turnFrom: number;
  turnTo: number;
  layerNo: number;
  plainText: string;
  payload: {
    text: string;
    source: "model" | "fallback";
    promptVersion: string;
  };
  tokenEstimate: number;
  coveredTokenEstimate: number;
  originEntryIds: string[];
};

export type DigestBuildResult = {
  draft: DigestDraft;
  resolution?: DigestResolution;
};

export type SessionStateSnapshot = {
  row: SessionStateRow | null;
  dirtyVectorEntryIds: string[];
};

export type ContextServices = {
  config: ResolvedContextConfig;
  logger: ContextLogger;
  runtimeBridge: {
    readDefaultModelRef: () => string;
    readProviderApi: (provider: string) => string | undefined;
    resolveApiKeyForModel: (provider: string, model: string) => Promise<string | undefined>;
    resolveAgentDir: () => string;
  };
  db: {
    ensureInitialized: () => Promise<void>;
    dispose: () => Promise<void>;
  };
  queue: {
    run: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>;
  };
  sessionStateReader: {
    get: (sessionId: string) => Promise<SessionStateRow | null>;
  };
  entryStoreReader: {
    getTurnCount: (sessionId: string) => Promise<number>;
    getMaxTurnSeq: (sessionId: string) => Promise<number>;
    listTurns: (sessionId: string) => Promise<TurnEntry[]>;
    listDigests: (sessionId: string) => Promise<DigestEntry[]>;
    listEntriesByIds: (sessionId: string, entryIds: string[]) => Promise<EntryStoreRow[]>;
    listPendingDigestVectors: (sessionId: string) => Promise<DigestEntry[]>;
    getById: (sessionId: string, entryId: string) => Promise<EntryStoreRow | null>;
  };
  promptViewReader: {
    list: (sessionId: string) => Promise<PromptSlot[]>;
  };
  sessionStateWriter: {
    upsert: (row: SessionStateRow) => Promise<void>;
    markDirtyText: (sessionId: string, value: boolean) => Promise<void>;
    addDirtyVectorId: (sessionId: string, entryId: string) => Promise<void>;
    clearDirtyVectorIds: (sessionId: string, entryIds: string[]) => Promise<void>;
  };
  entryStoreWriter: {
    writeTurns: (rows: TurnEntry[]) => Promise<void>;
    writeTurnDrafts: (sessionId: string, drafts: TurnDraft[]) => Promise<TurnEntry[]>;
    writeDigest: (row: DigestEntry) => Promise<void>;
  };
  promptViewWriter: {
    replace: (sessionId: string, rows: PromptSlot[]) => Promise<void>;
    append: (rows: PromptSlot[]) => Promise<void>;
  };
  vectorWriter: {
    writeVector: (params: {
      sessionId: string;
      entryId: string;
      vector: number[];
      modelId: string;
    }) => Promise<void>;
  };
  indexMaintainer: {
    ensureBaseIndexes: () => Promise<void>;
    syncAfterTurn: (sessionId: string, newTurnIds: string[]) => Promise<void>;
    syncAfterShrink: (sessionId: string, newDigestId: string) => Promise<void>;
    retryDirtyState: (sessionId: string) => Promise<void>;
  };
  hybridRecall: {
    recall: (params: { sessionId: string; query: string; limit: number }) => Promise<RecallCandidate[]>;
  };
  digestBuilder: {
    buildDigest: (params: {
      sessionId: string;
      sourceEntries: EntryStoreRow[];
      customInstructions?: string;
    }) => Promise<DigestBuildResult>;
    toDigestRow: (sessionId: string, build: DigestBuildResult["draft"]) => DigestEntry;
  };
  embedder: {
    embedText: (text: string) => Promise<number[]>;
  };
};
