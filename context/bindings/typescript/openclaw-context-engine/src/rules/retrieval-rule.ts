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

import type { PluginLogger } from "openclaw/plugin-sdk";
import type { ContextLanceDbConfig } from "../config.js";
import { RetrievalEngineModule } from "../engine/retrieval.js";
import type { CopiedLegacyContextEngine } from "../engine/legacy.js";
import type { ContextLanceDbStore } from "../store.js";
import type {
  ContextEngineAssembleResult,
  ContextEngineBootstrapResult,
  ContextEngineCompactResult,
  ContextEngineIngestBatchResult,
  ContextEngineIngestResult,
} from "../types.js";
import type {
  ContextEngineRule,
  ContextEngineRuleFailureMode,
  ContextEngineRuleHookContext,
} from "./base.js";

export class RetrievalRule implements ContextEngineRule {
  readonly id = "retrieval";
  readonly order = 100;
  readonly failureMode: ContextEngineRuleFailureMode = "fail-open";
  private readonly module: RetrievalEngineModule;

  constructor(
    private readonly config: ContextLanceDbConfig,
    deps: {
      logger: PluginLogger;
      store: ContextLanceDbStore;
      legacyEngine: CopiedLegacyContextEngine;
    },
  ) {
    this.module = new RetrievalEngineModule(config, {
      logger: deps.logger,
      store: deps.store,
      legacyCompact: (params) => deps.legacyEngine.compact(params),
    });
  }

  isEnabled(): boolean {
    return this.config.retrievalEnabled;
  }

  warmup(): void {
    this.module.warmup();
  }

  async bootstrap(
    ctx: ContextEngineRuleHookContext<"bootstrap">,
  ): Promise<ContextEngineBootstrapResult | undefined> {
    return this.module.bootstrap(ctx.params);
  }

  async ingest(ctx: ContextEngineRuleHookContext<"ingest">): Promise<ContextEngineIngestResult | undefined> {
    return this.module.ingest(ctx.params);
  }

  async ingestBatch(
    ctx: ContextEngineRuleHookContext<"ingestBatch">,
  ): Promise<ContextEngineIngestBatchResult | undefined> {
    return this.module.ingestBatch(ctx.params);
  }

  async assemble(
    ctx: ContextEngineRuleHookContext<"assemble">,
  ): Promise<ContextEngineAssembleResult | undefined> {
    return this.module.assemble(ctx.params);
  }

  async afterTurn(ctx: ContextEngineRuleHookContext<"afterTurn">): Promise<void> {
    await this.module.afterTurn(ctx.params);
  }

  async compact(
    ctx: ContextEngineRuleHookContext<"compact">,
  ): Promise<ContextEngineCompactResult | undefined> {
    return this.module.compact(ctx.params);
  }
}
