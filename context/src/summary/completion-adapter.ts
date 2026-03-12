// SPDX-License-Identifier: Apache-2.0

import type { DigestResolution } from "../types/runtime.js";

type PiAiModule = typeof import("@mariozechner/pi-ai");

type PiAiModel = {
  id: string;
  name: string;
  provider: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
};

function inferBaseUrl(provider: string, explicitBaseUrl?: string): string {
  if (explicitBaseUrl?.trim()) {
    return explicitBaseUrl.trim();
  }
  if (provider === "openai" || provider === "openai-codex") {
    return "https://api.openai.com/v1";
  }
  return "";
}

function buildFallbackModel(resolution: DigestResolution): PiAiModel {
  return {
    id: resolution.model,
    name: resolution.model,
    provider: resolution.provider,
    api: resolution.api,
    baseUrl: inferBaseUrl(resolution.provider, resolution.baseUrl),
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 0,
    maxTokens: 0,
  };
}

async function loadPiAi(): Promise<PiAiModule> {
  return import("@mariozechner/pi-ai");
}

export async function generateDigestText(params: {
  resolution: DigestResolution;
  instructionText: string;
  sourceBundleText: string;
  maxTokens: number;
}): Promise<string> {
  if (!params.resolution.apiKey) {
    throw new Error("Missing API key for digest generation");
  }
  const piAi = await loadPiAi();
  const getModel =
    typeof piAi.getModel === "function"
      ? (piAi.getModel as unknown as
          | ((provider: string, model: string) => PiAiModel | undefined)
          | undefined)
      : undefined;
  const catalogModel = getModel?.(params.resolution.provider, params.resolution.model);
  const completionModel = catalogModel ?? buildFallbackModel(params.resolution);
  const completionResult = await piAi.completeSimple(
    completionModel,
    {
      systemPrompt: params.instructionText,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: params.sourceBundleText }],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: params.resolution.apiKey,
      maxTokens: params.maxTokens,
      temperature: 0,
    },
  );

  const digestBodyText = completionResult.content
    .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!digestBodyText) {
    throw new Error("Digest model returned empty content");
  }
  return digestBodyText;
}
