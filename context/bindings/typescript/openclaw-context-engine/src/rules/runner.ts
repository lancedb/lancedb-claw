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
  ContextEngineRule,
  ContextEngineRuleDeps,
  ContextEngineRuleEffectLifecycleName,
  ContextEngineRuleLifecycleParamsMap,
  ContextEngineRuleLifecycleResultMap,
  ContextEngineRuleResultLifecycleName,
  ContextEngineRuleSharedState,
} from "./base.js";
import { ContextEngineRuleRegistry } from "./registry.js";

export class ContextEngineRuleRunner {
  constructor(
    private readonly registry: ContextEngineRuleRegistry,
    private readonly deps: ContextEngineRuleDeps,
  ) {}

  hasEnabledRules(): boolean {
    return this.registry.hasEnabledRules();
  }

  warmup(): void {
    const shared: ContextEngineRuleSharedState = {};
    for (const rule of this.registry.getEnabledRules()) {
      const handler = rule.warmup;
      if (!handler) {
        continue;
      }
      try {
        handler.call(rule, {
          params: undefined,
          previous: undefined,
          shared,
          deps: this.deps,
        });
      } catch (err) {
        this.handleRuleError(rule, "warmup", err);
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.deps.store) {
      await this.deps.store.initialize();
    }
    await this.runEffectLifecycle("initialize", undefined);
  }

  async bootstrap(
    params: ContextEngineRuleLifecycleParamsMap["bootstrap"],
  ): Promise<ContextEngineRuleLifecycleResultMap["bootstrap"] | undefined> {
    return this.runResultLifecycle("bootstrap", params);
  }

  async ingest(
    params: ContextEngineRuleLifecycleParamsMap["ingest"],
  ): Promise<ContextEngineRuleLifecycleResultMap["ingest"] | undefined> {
    return this.runResultLifecycle("ingest", params);
  }

  async ingestBatch(
    params: ContextEngineRuleLifecycleParamsMap["ingestBatch"],
  ): Promise<ContextEngineRuleLifecycleResultMap["ingestBatch"] | undefined> {
    return this.runResultLifecycle("ingestBatch", params);
  }

  async maintain(
    params: ContextEngineRuleLifecycleParamsMap["maintain"],
  ): Promise<ContextEngineRuleLifecycleResultMap["maintain"] | undefined> {
    return this.runResultLifecycle("maintain", params);
  }

  async assemble(
    params: ContextEngineRuleLifecycleParamsMap["assemble"],
    initial: ContextEngineRuleLifecycleResultMap["assemble"],
  ): Promise<ContextEngineRuleLifecycleResultMap["assemble"]> {
    return (await this.runResultLifecycle("assemble", params, initial)) ?? initial;
  }

  async afterTurn(params: ContextEngineRuleLifecycleParamsMap["afterTurn"]): Promise<void> {
    await this.runEffectLifecycle("afterTurn", params);
  }

  async compact(
    params: ContextEngineRuleLifecycleParamsMap["compact"],
  ): Promise<ContextEngineRuleLifecycleResultMap["compact"] | undefined> {
    return this.runResultLifecycle("compact", params);
  }

  async prepareSubagentSpawn(
    params: ContextEngineRuleLifecycleParamsMap["prepareSubagentSpawn"],
  ): Promise<ContextEngineRuleLifecycleResultMap["prepareSubagentSpawn"] | undefined> {
    return this.runResultLifecycle("prepareSubagentSpawn", params);
  }

  async onSubagentEnded(
    params: ContextEngineRuleLifecycleParamsMap["onSubagentEnded"],
  ): Promise<void> {
    await this.runEffectLifecycle("onSubagentEnded", params);
  }

  async dispose(): Promise<void> {
    await this.runEffectLifecycle("dispose", undefined);
    if (this.deps.store) {
      await this.deps.store.dispose();
    }
  }

  private async runResultLifecycle<L extends ContextEngineRuleResultLifecycleName>(
    lifecycle: L,
    params: ContextEngineRuleLifecycleParamsMap[L],
    initial?: ContextEngineRuleLifecycleResultMap[L],
  ): Promise<ContextEngineRuleLifecycleResultMap[L] | undefined> {
    const shared: ContextEngineRuleSharedState = {};
    let previous = initial;
    for (const rule of this.registry.getEnabledRules()) {
      const handler = rule[lifecycle] as
        | ((
            ctx: {
              params: ContextEngineRuleLifecycleParamsMap[L];
              previous: ContextEngineRuleLifecycleResultMap[L] | undefined;
              shared: ContextEngineRuleSharedState;
              deps: ContextEngineRuleDeps;
            },
          ) => Promise<ContextEngineRuleLifecycleResultMap[L] | undefined>)
        | undefined;
      if (!handler) {
        continue;
      }
      try {
        const next = await handler.call(rule, {
          params,
          previous,
          shared,
          deps: this.deps,
        });
        if (next !== undefined) {
          previous = next;
        }
      } catch (err) {
        this.handleRuleError(rule, lifecycle, err);
      }
    }
    return previous;
  }

  private async runEffectLifecycle<L extends ContextEngineRuleEffectLifecycleName>(
    lifecycle: L,
    params: ContextEngineRuleLifecycleParamsMap[L],
  ): Promise<void> {
    const shared: ContextEngineRuleSharedState = {};
    for (const rule of this.registry.getEnabledRules()) {
      const handler = rule[lifecycle] as
        | ((
            ctx: {
              params: ContextEngineRuleLifecycleParamsMap[L];
              previous: undefined;
              shared: ContextEngineRuleSharedState;
              deps: ContextEngineRuleDeps;
            },
          ) => Promise<void> | void)
        | undefined;
      if (!handler) {
        continue;
      }
      try {
        await handler.call(rule, {
          params,
          previous: undefined,
          shared,
          deps: this.deps,
        });
      } catch (err) {
        this.handleRuleError(rule, lifecycle, err);
      }
    }
  }

  private handleRuleError(rule: ContextEngineRule, lifecycle: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.deps.logger.warn(`context-lancedb: rule ${rule.id} failed during ${lifecycle} (${message})`);
    if (rule.failureMode === "fail-fast") {
      throw err;
    }
  }
}
