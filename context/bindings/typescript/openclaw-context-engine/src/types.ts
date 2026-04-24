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

// Internal type re-exports for standalone use outside the openclaw monorepo.
// OpenClawConfig is not exported from openclaw/plugin-sdk directly,
// so we extract it from OpenClawPluginApi which carries it as the `config` field.
import type {
  ContextEngine,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk";

export type OpenClawConfig = OpenClawPluginApi["config"];
export type ContextEngineBootstrapParams = Parameters<NonNullable<ContextEngine["bootstrap"]>>[0];
export type ContextEngineAssembleResult = Awaited<ReturnType<ContextEngine["assemble"]>>;
export type ContextEngineAssembleParams = Parameters<ContextEngine["assemble"]>[0];
export type ContextEngineCompactResult = Awaited<ReturnType<ContextEngine["compact"]>>;
export type ContextEngineCompactParams = Parameters<ContextEngine["compact"]>[0];
export type ContextEngineBootstrapResult = Awaited<
  ReturnType<NonNullable<ContextEngine["bootstrap"]>>
>;
export type ContextEngineIngestParams = Parameters<ContextEngine["ingest"]>[0];
export type ContextEngineIngestResult = Awaited<ReturnType<ContextEngine["ingest"]>>;
export type ContextEngineIngestBatchParams = Parameters<
  NonNullable<ContextEngine["ingestBatch"]>
>[0];
export type ContextEngineIngestBatchResult = Awaited<
  ReturnType<NonNullable<ContextEngine["ingestBatch"]>>
>;
export type ContextEngineAfterTurnParams = Parameters<
  NonNullable<ContextEngine["afterTurn"]>
>[0];
export type ContextEngineMaintainParams = Parameters<NonNullable<ContextEngine["maintain"]>>[0];
export type ContextEngineMaintainResult = Awaited<
  ReturnType<NonNullable<ContextEngine["maintain"]>>
>;
export type ContextEnginePrepareSubagentSpawnParams = Parameters<
  NonNullable<ContextEngine["prepareSubagentSpawn"]>
>[0];
export type ContextEnginePrepareSubagentSpawnResult = Awaited<
  ReturnType<NonNullable<ContextEngine["prepareSubagentSpawn"]>>
>;
export type ContextEngineOnSubagentEndedParams = Parameters<
  NonNullable<ContextEngine["onSubagentEnded"]>
>[0];
