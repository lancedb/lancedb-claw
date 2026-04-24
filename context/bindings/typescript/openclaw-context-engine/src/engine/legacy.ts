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

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  ContextEngine,
  ContextEngineInfo,
} from "openclaw/plugin-sdk";
import type {
  ContextEngineAfterTurnParams,
  ContextEngineAssembleParams,
  ContextEngineAssembleResult,
  ContextEngineCompactParams,
  ContextEngineCompactResult,
  ContextEngineIngestResult,
} from "../types.js";

export class CopiedLegacyContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: "legacy",
    name: "Legacy Context Engine",
    version: "1.0.0",
  };

  async ingest(): Promise<ContextEngineIngestResult> {
    return { ingested: false };
  }

  async assemble(params: ContextEngineAssembleParams): Promise<ContextEngineAssembleResult> {
    return {
      messages: params.messages,
      estimatedTokens: 0,
    };
  }

  async afterTurn(_params: ContextEngineAfterTurnParams): Promise<void> {}

  async compact(params: ContextEngineCompactParams): Promise<ContextEngineCompactResult> {
    const { delegateCompactionToRuntime } = await import("openclaw/plugin-sdk");
    return await delegateCompactionToRuntime(params);
  }

  async dispose(): Promise<void> {}
}
