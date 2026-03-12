// SPDX-License-Identifier: Apache-2.0

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ContextLogger } from "../types/domain.js";
import type { RuntimeModelAuth, RuntimeModelAuthLookupModel } from "../types/runtime.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferApiFromProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "anthropic") {
    return "anthropic-messages";
  }
  if (normalized === "openai-codex" || normalized === "github-copilot") {
    return "openai-codex-responses";
  }
  if (normalized === "google" || normalized === "google-antigravity") {
    return "google-generative-ai";
  }
  if (normalized === "google-gemini-cli") {
    return "google-gemini-cli";
  }
  if (normalized === "google-vertex") {
    return "google-vertex";
  }
  if (normalized === "amazon-bedrock") {
    return "bedrock-converse-stream";
  }
  return "openai-responses";
}

function buildLookupModel(provider: string, model: string): RuntimeModelAuthLookupModel {
  return {
    id: model,
    name: model,
    provider,
    api: inferApiFromProvider(provider),
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

export class OpenClawRuntimeBridge {
  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly logger: ContextLogger,
  ) {}

  private getModelAuth(): RuntimeModelAuth | undefined {
    const runtime = this.api.runtime as OpenClawPluginApi["runtime"] & {
      modelAuth?: RuntimeModelAuth;
    };
    return runtime.modelAuth;
  }

  readDefaultModelRef(): string {
    const config = this.api.config as Record<string, unknown>;
    const agents = isRecord(config.agents) ? config.agents : undefined;
    const defaults = agents && isRecord(agents.defaults) ? agents.defaults : undefined;
    const model = defaults?.model;
    if (typeof model === "string") {
      return model.trim();
    }
    if (isRecord(model) && typeof model.primary === "string") {
      return model.primary.trim();
    }
    return "";
  }

  readProviderApi(provider: string): string | undefined {
    const config = this.api.config as Record<string, unknown>;
    const models = isRecord(config.models) ? config.models : undefined;
    const providers = models && isRecord(models.providers) ? models.providers : undefined;
    if (!providers) {
      return undefined;
    }
    const providerConfig = providers[provider];
    if (!isRecord(providerConfig)) {
      return undefined;
    }
    return typeof providerConfig.api === "string" ? providerConfig.api.trim() : undefined;
  }

  async resolveApiKeyForModel(provider: string, model: string): Promise<string | undefined> {
    const modelAuth = this.getModelAuth();
    if (!modelAuth) {
      this.logger.debug("runtime modelAuth unavailable");
      return undefined;
    }
    try {
      const result = await modelAuth.getApiKeyForModel({
        model: buildLookupModel(provider, model),
        cfg: this.api.config,
      });
      return typeof result?.apiKey === "string" && result.apiKey.trim()
        ? result.apiKey.trim()
        : undefined;
    } catch (error) {
      this.logger.debug("runtime modelAuth lookup failed", {
        provider,
        model,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  resolveAgentDir(): string {
    return this.api.resolvePath(".");
  }
}
