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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ContextEngineCompactParams,
  ContextEngineCompactResult,
} from "../../src/types.js";

const delegateCompactionToRuntime = vi.fn<
  (params: ContextEngineCompactParams) => Promise<ContextEngineCompactResult>
>();

vi.mock("openclaw/plugin-sdk", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk")>(
    "openclaw/plugin-sdk",
  );
  return {
    ...actual,
    delegateCompactionToRuntime,
  };
});

import { CopiedLegacyContextEngine } from "../../src/engine/legacy.js";

describe("CopiedLegacyContextEngine", () => {
  beforeEach(() => {
    delegateCompactionToRuntime.mockReset();
  });

  it("delegates compact to openclaw's official runtime bridge", async () => {
    const params: ContextEngineCompactParams = {
      sessionId: "session-legacy-compact",
      sessionFile: "/tmp/session-legacy-compact.jsonl",
      sessionKey: "agent:test:main",
      tokenBudget: 8192,
      force: true,
      currentTokenCount: 2048,
      customInstructions: "Keep identifiers exact.",
      runtimeContext: {
        workspaceDir: "/tmp/workspace",
        currentTokenCount: 1024,
        trigger: "manual",
      },
    };
    const expected: ContextEngineCompactResult = {
      ok: true,
      compacted: true,
      reason: "manual",
      result: {
        summary: "summary text",
        firstKeptEntryId: "entry-42",
        tokensBefore: 2048,
        tokensAfter: 512,
        details: {
          source: "delegate",
        },
      },
    };
    delegateCompactionToRuntime.mockResolvedValue(expected);

    const engine = new CopiedLegacyContextEngine();
    const result = await engine.compact(params);

    expect(delegateCompactionToRuntime).toHaveBeenCalledTimes(1);
    expect(delegateCompactionToRuntime).toHaveBeenCalledWith(params);
    expect(result).toEqual(expected);
  });

  it("keeps legacy no-op behavior for ingest and assemble", async () => {
    const engine = new CopiedLegacyContextEngine();

    await expect(
      engine.ingest({
        sessionId: "session-ingest",
        message: {
          role: "user",
          content: "hello",
        },
      }),
    ).resolves.toEqual({ ingested: false });

    await expect(
      engine.assemble({
        sessionId: "session-assemble",
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
        tokenBudget: 4096,
      }),
    ).resolves.toEqual({
      messages: [
        {
          role: "user",
          content: "hello",
        },
      ],
      estimatedTokens: 0,
    });
  });
});
