// SPDX-License-Identifier: Apache-2.0

import type { ResolvedContextConfig } from "../types/config.js";
import type { DigestResolution } from "../types/runtime.js";

function inferApiFromProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "anthropic") {
    return "anthropic-messages";
  }
  if (normalized === "openai-codex" || normalized === "github-copilot") {
    return "openai-codex-responses";
  }
  if (normalized === "google-gemini-cli") {
    return "google-gemini-cli";
  }
  if (normalized === "google-vertex") {
    return "google-vertex";
  }
  if (normalized === "google" || normalized === "google-antigravity") {
    return "google-generative-ai";
  }
  if (normalized === "amazon-bedrock") {
    return "bedrock-converse-stream";
  }
  return "openai-responses";
}

function parseModelReference(raw: string): { provider: string; model: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.includes("/")) {
    const [provider, ...rest] = trimmed.split("/");
    const model = rest.join("/").trim();
    if (provider?.trim() && model) {
      return { provider: provider.trim(), model };
    }
  }
  return { provider: "openai", model: trimmed };
}

export async function resolveDigestModel(params: {
  config: ResolvedContextConfig;
  runtimeBridge: {
    readDefaultModelRef: () => string;
    readProviderApi: (provider: string) => string | undefined;
    resolveApiKeyForModel: (provider: string, model: string) => Promise<string | undefined>;
  };
}): Promise<DigestResolution | null> {
  if (params.config.digestModel) {
    const override = params.config.digestModel;
    return {
      provider: override.provider,
      model: override.model,
      apiKey: override.apiKey,
      baseUrl: override.baseUrl,
      api: params.runtimeBridge.readProviderApi(override.provider) ?? inferApiFromProvider(override.provider),
      source: "override",
    };
  }

  const parsed = parseModelReference(params.runtimeBridge.readDefaultModelRef());
  if (!parsed) {
    return null;
  }
  const apiKey = await params.runtimeBridge.resolveApiKeyForModel(parsed.provider, parsed.model);
  return {
    provider: parsed.provider,
    model: parsed.model,
    apiKey,
    api: params.runtimeBridge.readProviderApi(parsed.provider) ?? inferApiFromProvider(parsed.provider),
    source: "runtime",
  };
}
