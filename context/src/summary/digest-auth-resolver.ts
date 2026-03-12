// SPDX-License-Identifier: Apache-2.0

import type { ResolvedContextConfig } from "../types/config.js";
import type { DigestResolution } from "../types/runtime.js";

function mapDigestProviderToApi(providerKey: string): string {
  const normalizedProviderKey = providerKey.trim().toLowerCase();
  if (normalizedProviderKey === "anthropic") {
    return "anthropic-messages";
  }
  if (normalizedProviderKey === "openai-codex" || normalizedProviderKey === "github-copilot") {
    return "openai-codex-responses";
  }
  if (normalizedProviderKey === "google-gemini-cli") {
    return "google-gemini-cli";
  }
  if (normalizedProviderKey === "google-vertex") {
    return "google-vertex";
  }
  if (normalizedProviderKey === "google" || normalizedProviderKey === "google-antigravity") {
    return "google-generative-ai";
  }
  if (normalizedProviderKey === "amazon-bedrock") {
    return "bedrock-converse-stream";
  }
  return "openai-responses";
}

function parseRuntimeModelPointer(rawModelRef: string): { provider: string; model: string } | null {
  const trimmedModelRef = rawModelRef.trim();
  if (!trimmedModelRef) {
    return null;
  }
  if (trimmedModelRef.includes("/")) {
    const [providerKey, ...remainingParts] = trimmedModelRef.split("/");
    const modelId = remainingParts.join("/").trim();
    if (providerKey?.trim() && modelId) {
      return { provider: providerKey.trim(), model: modelId };
    }
  }
  return { provider: "openai", model: trimmedModelRef };
}

export async function chooseDigestResolution(params: {
  config: ResolvedContextConfig;
  runtimeBridge: {
    readDefaultModelRef: () => string;
    readProviderApi: (provider: string) => string | undefined;
    resolveApiKeyForModel: (provider: string, model: string) => Promise<string | undefined>;
  };
}): Promise<DigestResolution | null> {
  if (params.config.digestModel) {
    const digestOverride = params.config.digestModel;
    return {
      provider: digestOverride.provider,
      model: digestOverride.model,
      apiKey: digestOverride.apiKey,
      baseUrl: digestOverride.baseUrl,
      api:
        params.runtimeBridge.readProviderApi(digestOverride.provider) ??
        mapDigestProviderToApi(digestOverride.provider),
      source: "override",
    };
  }

  const runtimeModelPointer = parseRuntimeModelPointer(params.runtimeBridge.readDefaultModelRef());
  if (!runtimeModelPointer) {
    return null;
  }
  const resolvedApiKey = await params.runtimeBridge.resolveApiKeyForModel(
    runtimeModelPointer.provider,
    runtimeModelPointer.model,
  );
  return {
    provider: runtimeModelPointer.provider,
    model: runtimeModelPointer.model,
    apiKey: resolvedApiKey,
    api:
      params.runtimeBridge.readProviderApi(runtimeModelPointer.provider) ??
      mapDigestProviderToApi(runtimeModelPointer.provider),
    source: "runtime",
  };
}
