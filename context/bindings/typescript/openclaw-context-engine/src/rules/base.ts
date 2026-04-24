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
import type { CopiedLegacyContextEngine } from "../engine/legacy.js";
import type { ContextLanceDbStore } from "../store.js";
import type {
  ContextEngineAfterTurnParams,
  ContextEngineAssembleParams,
  ContextEngineAssembleResult,
  ContextEngineBootstrapParams,
  ContextEngineBootstrapResult,
  ContextEngineCompactParams,
  ContextEngineCompactResult,
  ContextEngineIngestBatchParams,
  ContextEngineIngestBatchResult,
  ContextEngineIngestParams,
  ContextEngineIngestResult,
  ContextEngineMaintainParams,
  ContextEngineMaintainResult,
  ContextEngineOnSubagentEndedParams,
  ContextEnginePrepareSubagentSpawnParams,
  ContextEnginePrepareSubagentSpawnResult,
  OpenClawConfig,
} from "../types.js";

export type SessionStoreLike = Record<string, unknown>;
export type ContextEngineRuleFailureMode = "fail-open" | "fail-fast";

export type ContextEngineRuleLifecycleParamsMap = {
  warmup: undefined;
  initialize: undefined;
  bootstrap: ContextEngineBootstrapParams;
  ingest: ContextEngineIngestParams;
  ingestBatch: ContextEngineIngestBatchParams;
  maintain: ContextEngineMaintainParams;
  assemble: ContextEngineAssembleParams;
  afterTurn: ContextEngineAfterTurnParams;
  compact: ContextEngineCompactParams;
  prepareSubagentSpawn: ContextEnginePrepareSubagentSpawnParams;
  onSubagentEnded: ContextEngineOnSubagentEndedParams;
  dispose: undefined;
};

export type ContextEngineRuleLifecycleResultMap = {
  warmup: void;
  initialize: void;
  bootstrap: ContextEngineBootstrapResult;
  ingest: ContextEngineIngestResult;
  ingestBatch: ContextEngineIngestBatchResult;
  maintain: ContextEngineMaintainResult;
  assemble: ContextEngineAssembleResult;
  afterTurn: void;
  compact: ContextEngineCompactResult;
  prepareSubagentSpawn: ContextEnginePrepareSubagentSpawnResult;
  onSubagentEnded: void;
  dispose: void;
};

export type ContextEngineRuleLifecycleName = keyof ContextEngineRuleLifecycleParamsMap;

export type ContextEngineRuleResultLifecycleName = Exclude<
  ContextEngineRuleLifecycleName,
  "warmup" | "initialize" | "afterTurn" | "onSubagentEnded" | "dispose"
>;

export type ContextEngineRuleEffectLifecycleName = Exclude<
  ContextEngineRuleLifecycleName,
  ContextEngineRuleResultLifecycleName
>;

export type ContextEngineRuleSharedState = Record<string, unknown>;

export type ContextEngineRuleDeps = {
  config: ContextLanceDbConfig;
  logger: PluginLogger;
  store: ContextLanceDbStore | null;
  legacyEngine: CopiedLegacyContextEngine;
  openClawConfig?: OpenClawConfig;
  loadSessionStore?: (storePath: string) => SessionStoreLike;
};

export type ContextEngineRuleHookContext<L extends ContextEngineRuleLifecycleName> = {
  params: ContextEngineRuleLifecycleParamsMap[L];
  previous: ContextEngineRuleLifecycleResultMap[L] | undefined;
  shared: ContextEngineRuleSharedState;
  deps: ContextEngineRuleDeps;
};

type MaybePromise<T> = Promise<T> | T;

export interface ContextEngineRule {
  readonly id: string;
  readonly order: number;
  readonly failureMode: ContextEngineRuleFailureMode;

  isEnabled(): boolean;

  warmup?(ctx: ContextEngineRuleHookContext<"warmup">): void;
  initialize?(ctx: ContextEngineRuleHookContext<"initialize">): MaybePromise<void>;
  bootstrap?(
    ctx: ContextEngineRuleHookContext<"bootstrap">,
  ): MaybePromise<ContextEngineBootstrapResult | undefined>;
  ingest?(ctx: ContextEngineRuleHookContext<"ingest">): MaybePromise<ContextEngineIngestResult | undefined>;
  ingestBatch?(
    ctx: ContextEngineRuleHookContext<"ingestBatch">,
  ): MaybePromise<ContextEngineIngestBatchResult | undefined>;
  maintain?(
    ctx: ContextEngineRuleHookContext<"maintain">,
  ): MaybePromise<ContextEngineMaintainResult | undefined>;
  assemble?(
    ctx: ContextEngineRuleHookContext<"assemble">,
  ): MaybePromise<ContextEngineAssembleResult | undefined>;
  afterTurn?(ctx: ContextEngineRuleHookContext<"afterTurn">): MaybePromise<void>;
  compact?(ctx: ContextEngineRuleHookContext<"compact">): MaybePromise<ContextEngineCompactResult | undefined>;
  prepareSubagentSpawn?(
    ctx: ContextEngineRuleHookContext<"prepareSubagentSpawn">,
  ): MaybePromise<ContextEnginePrepareSubagentSpawnResult | undefined>;
  onSubagentEnded?(ctx: ContextEngineRuleHookContext<"onSubagentEnded">): MaybePromise<void>;
  dispose?(ctx: ContextEngineRuleHookContext<"dispose">): MaybePromise<void>;
}
