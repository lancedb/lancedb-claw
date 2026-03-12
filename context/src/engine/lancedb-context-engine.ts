// SPDX-License-Identifier: Apache-2.0

// Inspired by the context-engine implementation of openclaw and the design and implementation of losses claw
// https://github.com/Martian-Engineering/lossless-claw
import type {
  AssembleResult,
  BootstrapResult,
  CompactResult,
  ContextEngine,
  ContextEngineInfo,
  IngestBatchResult,
  IngestResult,
  SubagentSpawnPreparation,
} from "openclaw/context-engine/types";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ContextServices } from "../types/domain.js";
import { bootstrapContext } from "../lifecycle/bootstrap.js";
import { ingestBatchContext, ingestContext } from "../lifecycle/ingest.js";
import { afterTurnContext } from "../lifecycle/after-turn.js";
import { assembleContext } from "../lifecycle/assemble.js";
import { compactContext } from "../lifecycle/compact.js";

const ENGINE_INFO: ContextEngineInfo = {
  id: "lancedb-claw",
  name: "LanceDB Context Engine",
  version: "0.1.0",
  ownsCompaction: true,
};

export class LanceDbContextEngine implements ContextEngine {
  readonly info = ENGINE_INFO;

  constructor(private readonly services: ContextServices) {}

  async bootstrap(params: {
    sessionId: string;
    sessionFile: string;
  }): Promise<BootstrapResult> {
    return this.services.queue.run(params.sessionId, () => bootstrapContext(this.services, params));
  }

  async ingest(params: {
    sessionId: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    return this.services.queue.run(params.sessionId, () => ingestContext(this.services, params));
  }

  async ingestBatch(params: {
    sessionId: string;
    messages: AgentMessage[];
    isHeartbeat?: boolean;
  }): Promise<IngestBatchResult> {
    return this.services.queue.run(params.sessionId, () => ingestBatchContext(this.services, params));
  }

  async afterTurn(params: {
    sessionId: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    runtimeContext?: Record<string, unknown>;
  }): Promise<void> {
    return this.services.queue.run(params.sessionId, () => afterTurnContext(this.services, params));
  }

  async assemble(params: {
    sessionId: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  }): Promise<AssembleResult> {
    return assembleContext(this.services, params);
  }

  async compact(params: {
    sessionId: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: Record<string, unknown>;
  }): Promise<CompactResult> {
    return this.services.queue.run(params.sessionId, () => compactContext(this.services, params));
  }

  async prepareSubagentSpawn(_params: {
    parentSessionKey: string;
    childSessionKey: string;
    ttlMs?: number;
  }): Promise<SubagentSpawnPreparation | undefined> {
    return undefined;
  }

  async onSubagentEnded(_params: {
    childSessionKey: string;
    reason: "deleted" | "completed" | "swept" | "released";
  }): Promise<void> {
    return;
  }

  async dispose(): Promise<void> {
    await this.services.db.dispose();
  }
}
