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
import { SkillSearchEngineModule } from "../engine/skill-search.js";
import type { ContextLanceDbStore } from "../store.js";
import type {
  ContextEngineAssembleResult,
  ContextEngineBootstrapResult,
} from "../types.js";
import type {
  ContextEngineRule,
  ContextEngineRuleFailureMode,
  ContextEngineRuleHookContext,
  SessionStoreLike,
} from "./base.js";

export class SkillSearchRule implements ContextEngineRule {
  readonly id = "skill-search";
  readonly order = 200;
  readonly failureMode: ContextEngineRuleFailureMode = "fail-open";
  private readonly module: SkillSearchEngineModule;

  constructor(
    private readonly config: ContextLanceDbConfig,
    deps: {
      logger: PluginLogger;
      store: ContextLanceDbStore;
      loadSessionStore?: (storePath: string) => SessionStoreLike;
    },
  ) {
    this.module = new SkillSearchEngineModule(config, {
      logger: deps.logger,
      store: deps.store,
      loadSessionStore: deps.loadSessionStore,
    });
  }

  isEnabled(): boolean {
    return this.config.skillSearchEnabled;
  }

  warmup(): void {
    this.module.warmup();
  }

  async bootstrap(
    ctx: ContextEngineRuleHookContext<"bootstrap">,
  ): Promise<ContextEngineBootstrapResult | undefined> {
    const result = await this.module.bootstrap(ctx.params);
    return ctx.previous ?? result;
  }

  async assemble(
    ctx: ContextEngineRuleHookContext<"assemble">,
  ): Promise<ContextEngineAssembleResult | undefined> {
    const baseResult = ctx.previous ?? {
      messages: ctx.params.messages,
      estimatedTokens: 0,
    };
    return this.module.assemble({
      sessionId: ctx.params.sessionId,
      sessionKey: ctx.params.sessionKey,
      messages: ctx.params.messages,
      tokenBudget: ctx.params.tokenBudget,
      prompt: ctx.params.prompt,
      baseResult,
    });
  }

  async afterTurn(ctx: ContextEngineRuleHookContext<"afterTurn">): Promise<void> {
    await this.module.afterTurn(ctx.params);
  }
}
