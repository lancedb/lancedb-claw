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
import { RetrievalEngineModule } from "./engine/retrieval.js";
import { SkillSearchEngineModule } from "./engine/skill-search.js";
import { CopiedLegacyContextEngine } from "./engine/legacy.js";
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
  private readonly retrievalEngine: RetrievalEngineModule | null;
  private readonly skillSearchEngine: SkillSearchEngineModule | null;

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
    this.retrievalEngine = this.isRetrievalEnabled()
      ? new RetrievalEngineModule(this.config, {
          logger: this.deps.logger,
          store: this.getStore(),
          legacyCompact: (params) => this.legacyEngine.compact(params),
        })
      : null;
    this.skillSearchEngine = this.isSkillSearchEnabled()
      ? new SkillSearchEngineModule(this.config, {
          logger: this.deps.logger,
          store: this.getStore(),
          loadSessionStore: this.deps.loadSessionStore,
        })
      : null;
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
    if (this.isSkillSearchEnabled()) {
      this.getSkillSearchEngine().warmup();
    }
    if (this.isRetrievalEnabled()) {
      this.getRetrievalEngine().warmup();
    }
  }

  async initialize(): Promise<void> {
    if (!this.isRetrievalEnabled() && !this.isSkillSearchEnabled()) {
      return;
    }
    await this.getStore().initialize();
  }

  private getRetrievalEngine(): RetrievalEngineModule {
    if (!this.retrievalEngine) {
      throw new Error("context-lancedb: retrieval is disabled");
    }
    return this.retrievalEngine;
  }

  private getSkillSearchEngine(): SkillSearchEngineModule {
    if (!this.skillSearchEngine) {
      throw new Error("context-lancedb: skill search is disabled");
    }
    return this.skillSearchEngine;
  }

  private async retrievalBootstrapImpl(params: {
    sessionId: ContextEngineBootstrapParams["sessionId"];
    sessionKey?: ContextEngineBootstrapParams["sessionKey"];
    sessionFile: ContextEngineBootstrapParams["sessionFile"];
  }): Promise<ContextEngineBootstrapResult> {
    return this.getRetrievalEngine().bootstrap(params);
  }

  private async skillSearchBootstrapImpl(
    params: ContextEngineBootstrapParams,
  ): Promise<ContextEngineBootstrapResult> {
    return this.getSkillSearchEngine().bootstrap(params);
  }

  private async retrievalAssembleImpl(params: ContextEngineAssembleParams): Promise<ContextEngineAssembleResult> {
    return this.getRetrievalEngine().assemble(params);
  }

  private async retrievalIngestImpl(params: ContextEngineIngestParams): Promise<ContextEngineIngestResult> {
    return this.getRetrievalEngine().ingest(params);
  }

  private async retrievalIngestBatchImpl(
    params: ContextEngineIngestBatchParams,
  ): Promise<ContextEngineIngestBatchResult> {
    return this.getRetrievalEngine().ingestBatch(params);
  }

  private async retrievalAfterTurnImpl(params: ContextEngineAfterTurnParams): Promise<void> {
    return this.getRetrievalEngine().afterTurn(params);
  }

  private async retrievalCompactImpl(params: ContextEngineCompactParams): Promise<ContextEngineCompactResult> {
    return this.getRetrievalEngine().compact(params);
  }

  private async skillSearchAssembleImpl(params: {
    sessionId: ContextEngineAssembleParams["sessionId"];
    sessionKey?: ContextEngineAssembleParams["sessionKey"];
    messages: ContextEngineAssembleParams["messages"];
    tokenBudget?: ContextEngineAssembleParams["tokenBudget"];
    prompt?: ContextEngineAssembleParams["prompt"];
    baseResult: ContextEngineAssembleResult;
  }): Promise<ContextEngineAssembleResult> {
    return this.getSkillSearchEngine().assemble(params);
  }

  private async skillSearchAfterTurnImpl(params: ContextEngineAfterTurnParams): Promise<void> {
    return this.getSkillSearchEngine().afterTurn(params);
  }


  // ------------------------------------------------------------------------
  // 核心逻辑
  // ------------------------------------------------------------------------
  async bootstrap(params: ContextEngineBootstrapParams): Promise<ContextEngineBootstrapResult> {
    const startedAt = Date.now();
    let result: ContextEngineBootstrapResult;
    try {
      let retrievalResult: ContextEngineBootstrapResult | null = null;
      if (this.isRetrievalEnabled()) {
        retrievalResult = await this.retrievalBootstrapImpl(params);
      }
      if (this.isSkillSearchEnabled()) {
        await this.skillSearchBootstrapImpl(params);
      }
      if (retrievalResult) {
        result = retrievalResult;
      } else if (this.isSkillSearchEnabled()) {
        result = {
          bootstrapped: true,
          reason: "skill-search-only",
        };
      } else {
        result = {
          bootstrapped: false as const,
          reason: "disabled",
        };
      }
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
    if (this.isRetrievalEnabled()) {
      return this.retrievalIngestImpl(params);
    }
    return { ingested: false };
  }

  async ingestBatch(params: ContextEngineIngestBatchParams): Promise<ContextEngineIngestBatchResult> {
    if (this.isRetrievalEnabled()) {
      return this.retrievalIngestBatchImpl(params);
    }
    return { ingestedCount: 0 };
  }

  async maintain(_params: ContextEngineMaintainParams): Promise<ContextEngineMaintainResult> {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "not-supported",
    };
  }

  async assemble(params: ContextEngineAssembleParams): Promise<ContextEngineAssembleResult> {
    if (!this.isRetrievalEnabled() && !this.isSkillSearchEnabled()) {
      return this.legacyEngine.assemble(params);
    }
    const baseResult = this.isRetrievalEnabled()
      ? await this.retrievalAssembleImpl(params)
      : {
          messages: params.messages,
          estimatedTokens: 0,
        };
    if (this.isSkillSearchEnabled()) {
      return this.skillSearchAssembleImpl({
        ...params,
        baseResult,
      });
    }
    return baseResult;
  }

  async afterTurn(params: ContextEngineAfterTurnParams): Promise<void> {
    if (!this.isRetrievalEnabled() && !this.isSkillSearchEnabled()) {
      return this.legacyEngine.afterTurn(params);
    }
    if (this.isRetrievalEnabled()) {
      await this.retrievalAfterTurnImpl(params);
    }
    if (this.isSkillSearchEnabled()) {
      await this.skillSearchAfterTurnImpl(params);
    }
  }

  async compact(params: ContextEngineCompactParams): Promise<ContextEngineCompactResult> {
    if (this.isRetrievalEnabled()) {
      return this.retrievalCompactImpl(params);
    }
    return this.legacyEngine.compact(params);
  }

  async prepareSubagentSpawn(
    _params: ContextEnginePrepareSubagentSpawnParams,
  ): Promise<ContextEnginePrepareSubagentSpawnResult> {
    return undefined;
  }

  async onSubagentEnded(_params: ContextEngineOnSubagentEndedParams): Promise<void> {}

  async dispose(): Promise<void> {
  }
}
