/*
 * Copyright 2026 The OpenClaw Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
  ContextEngine,
  ContextEngineInfo,
  PluginLogger,
} from "openclaw/plugin-sdk";
import type { ContextLanceDbConfig } from "./config.js";
import { CopiedLegacyContextEngine } from "./engine/legacy.js";
import { RetrievalRule } from "./rules/retrieval-rule.js";
import { SkillSearchRule } from "./rules/skill-search-rule.js";
import { ContextEngineRuleRegistry } from "./rules/registry.js";
import { ContextEngineRuleRunner } from "./rules/runner.js";
import { ContextLanceDbStore } from "./store.js";
import type {
  ContextEngineAfterTurnParams,
  ContextEngineAssembleResult,
  ContextEngineAssembleParams,
  ContextEngineBootstrapResult,
  ContextEngineBootstrapParams,
  ContextEngineCompactResult,
  ContextEngineCompactParams,
  ContextEngineIngestBatchParams,
  ContextEngineIngestBatchResult,
  ContextEngineIngestParams,
  ContextEngineIngestResult,
  ContextEngineMaintainParams,
  ContextEngineMaintainResult,
  ContextEngineOnSubagentEndedParams,
  OpenClawConfig,
  ContextEnginePrepareSubagentSpawnParams,
  ContextEnginePrepareSubagentSpawnResult,
} from "./types.js";
import type { ContextEngineRule } from "./rules/base.js";

type ContextEmbeddingClient = {
  embed(text: string): Promise<number[]>;
};

export class LanceDBContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "lancedb",
    name: "LanceDB Context Engine",
    version: "1.0.0",
    ownsCompaction: false,
  };

  private readonly legacyEngine = new CopiedLegacyContextEngine();
  private readonly store: ContextLanceDbStore | null;
  private readonly ruleRunner: ContextEngineRuleRunner;

  constructor(
    private readonly config: ContextLanceDbConfig,
    private readonly deps: {
      logger: PluginLogger;
      embeddingClient: ContextEmbeddingClient | null;
      openClawConfig?: OpenClawConfig;
      loadSessionStore?: (storePath: string) => Record<string, unknown>;
    },
  ) {
    const hasEnabledFeature = this.isRetrievalEnabled() || this.isSkillSearchEnabled();
    this.store = hasEnabledFeature
      ? new ContextLanceDbStore(
          this.config,
          this.deps.embeddingClient,
          this.deps.logger,
        )
      : null;
    const rules: ContextEngineRule[] = [];
    if (this.store) {
      rules.push(
        new RetrievalRule(this.config, {
          logger: this.deps.logger,
          store: this.store,
          legacyEngine: this.legacyEngine,
        }),
        new SkillSearchRule(this.config, {
          logger: this.deps.logger,
          store: this.store,
          loadSessionStore: this.deps.loadSessionStore,
        }),
      );
    }
    this.ruleRunner = new ContextEngineRuleRunner(
      new ContextEngineRuleRegistry(rules),
      {
        config: this.config,
        logger: this.deps.logger,
        store: this.store,
        legacyEngine: this.legacyEngine,
        openClawConfig: this.deps.openClawConfig,
        loadSessionStore: this.deps.loadSessionStore,
      },
    );
  }

  private isRetrievalEnabled(): boolean {
    return this.config.retrievalEnabled;
  }

  private isSkillSearchEnabled(): boolean {
    return this.config.skillSearchEnabled;
  }

  private getStore(): ContextLanceDbStore {
    if (!this.store) {
      throw new Error("context-lancedb: store is unavailable when all features are disabled");
    }
    return this.store;
  }

  warmup(): void {
    this.ruleRunner.warmup();
  }

  async initialize(): Promise<void> {
    await this.ruleRunner.initialize();
  }


  // ------------------------------------------------------------------------
  // 核心逻辑
  // ------------------------------------------------------------------------
  async bootstrap(params: ContextEngineBootstrapParams): Promise<ContextEngineBootstrapResult> {
    const startedAt = Date.now();
    let result: ContextEngineBootstrapResult;
    try {
      result = (await this.ruleRunner.bootstrap(params)) ?? {
        bootstrapped: false as const,
        reason: "disabled",
      };
    } finally {
      const elapsedMs = Date.now() - startedAt;
      const sessionKey = params.sessionKey?.trim() || "unknown";
      this.deps.logger.info(
        `context-lancedb: bootstrap completed in ${elapsedMs}ms (sessionId=${params.sessionId}, sessionKey=${sessionKey})`,
      );
    }

    return result;
  }

  async ingest(params: ContextEngineIngestParams): Promise<ContextEngineIngestResult> {
    return (await this.ruleRunner.ingest(params)) ?? { ingested: false };
  }

  async ingestBatch(params: ContextEngineIngestBatchParams): Promise<ContextEngineIngestBatchResult> {
    return (await this.ruleRunner.ingestBatch(params)) ?? { ingestedCount: 0 };
  }

  async maintain(params: ContextEngineMaintainParams): Promise<ContextEngineMaintainResult> {
    return (await this.ruleRunner.maintain(params)) ?? {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "not-supported",
    };
  }

  async assemble(params: ContextEngineAssembleParams): Promise<ContextEngineAssembleResult> {
    if (!this.ruleRunner.hasEnabledRules()) {
      return this.legacyEngine.assemble(params);
    }
    return this.ruleRunner.assemble(params, {
      messages: params.messages,
      estimatedTokens: 0,
    });
  }

  async afterTurn(params: ContextEngineAfterTurnParams): Promise<void> {
    if (!this.ruleRunner.hasEnabledRules()) {
      return this.legacyEngine.afterTurn(params);
    }
    await this.ruleRunner.afterTurn(params);
  }

  async compact(params: ContextEngineCompactParams): Promise<ContextEngineCompactResult> {
    return (await this.ruleRunner.compact(params)) ?? this.legacyEngine.compact(params);
  }

  async prepareSubagentSpawn(
    params: ContextEnginePrepareSubagentSpawnParams,
  ): Promise<ContextEnginePrepareSubagentSpawnResult> {
    return this.ruleRunner.prepareSubagentSpawn(params);
  }

  async onSubagentEnded(params: ContextEngineOnSubagentEndedParams): Promise<void> {
    await this.ruleRunner.onSubagentEnded(params);
  }

  async dispose(): Promise<void> {
    await this.ruleRunner.dispose();
  }
}
