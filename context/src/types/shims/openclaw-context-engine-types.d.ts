// SPDX-License-Identifier: Apache-2.0

declare module "openclaw/context-engine/types" {
  import type { AgentMessage } from "@mariozechner/pi-agent-core";

  export type AssembleResult = {
    messages: AgentMessage[];
    estimatedTokens: number;
    systemPromptAddition?: string;
  };

  export type CompactResult = {
    ok: boolean;
    compacted: boolean;
    reason?: string;
    result?: {
      summary?: string;
      firstKeptEntryId?: string;
      tokensBefore: number;
      tokensAfter?: number;
      details?: unknown;
    };
  };

  export type IngestResult = {
    ingested: boolean;
  };

  export type IngestBatchResult = {
    ingestedCount: number;
  };

  export type BootstrapResult = {
    bootstrapped: boolean;
    importedMessages?: number;
    reason?: string;
  };

  export type ContextEngineInfo = {
    id: string;
    name: string;
    version?: string;
    ownsCompaction?: boolean;
  };

  export type SubagentSpawnPreparation = {
    rollback: () => void | Promise<void>;
  };

  export interface ContextEngine {
    readonly info: ContextEngineInfo;
    bootstrap?(params: { sessionId: string; sessionFile: string }): Promise<BootstrapResult>;
    ingest(params: {
      sessionId: string;
      message: AgentMessage;
      isHeartbeat?: boolean;
    }): Promise<IngestResult>;
    ingestBatch?(params: {
      sessionId: string;
      messages: AgentMessage[];
      isHeartbeat?: boolean;
    }): Promise<IngestBatchResult>;
    afterTurn?(params: {
      sessionId: string;
      sessionFile: string;
      messages: AgentMessage[];
      prePromptMessageCount: number;
      autoCompactionSummary?: string;
      isHeartbeat?: boolean;
      tokenBudget?: number;
      runtimeContext?: Record<string, unknown>;
    }): Promise<void>;
    assemble(params: {
      sessionId: string;
      messages: AgentMessage[];
      tokenBudget?: number;
    }): Promise<AssembleResult>;
    compact(params: {
      sessionId: string;
      sessionFile: string;
      tokenBudget?: number;
      force?: boolean;
      currentTokenCount?: number;
      compactionTarget?: "budget" | "threshold";
      customInstructions?: string;
      runtimeContext?: Record<string, unknown>;
    }): Promise<CompactResult>;
    prepareSubagentSpawn?(params: {
      parentSessionKey: string;
      childSessionKey: string;
      ttlMs?: number;
    }): Promise<SubagentSpawnPreparation | undefined>;
    onSubagentEnded?(params: {
      childSessionKey: string;
      reason: "deleted" | "completed" | "swept" | "released";
    }): Promise<void>;
    dispose?(): Promise<void>;
  }
}
