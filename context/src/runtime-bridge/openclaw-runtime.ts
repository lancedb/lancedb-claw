// SPDX-License-Identifier: Apache-2.0

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ContextLogger } from "../types/domain.js";
import type { RuntimeModelAuth, RuntimeModelAuthLookupModel } from "../types/runtime.js";

function isRuntimeObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferRuntimeApi(providerKey: string): string {
  return "openai-responses";
}

function buildAuthLookupDescriptor(
  providerKey: string,
  modelId: string,
): RuntimeModelAuthLookupModel {
  return {
    id: modelId,
    name: modelId,
    provider: providerKey,
    api: inferRuntimeApi(providerKey),
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

  private readRuntimeModelAuth(): RuntimeModelAuth | undefined {
    const runtimeBinding = this.api.runtime as OpenClawPluginApi["runtime"] & {
      modelAuth?: RuntimeModelAuth;
    };
    return runtimeBinding.modelAuth;
  }

  readDefaultModelRef(): string {
    const rootConfig = this.api.config as Record<string, unknown>;
    const agentConfig = isRuntimeObjectRecord(rootConfig.agents) ? rootConfig.agents : undefined;
    const defaultAgentConfig =
      agentConfig && isRuntimeObjectRecord(agentConfig.defaults) ? agentConfig.defaults : undefined;
    const primaryModelRef = defaultAgentConfig?.model;
    if (typeof primaryModelRef === "string") {
      return primaryModelRef.trim();
    }
    if (
      isRuntimeObjectRecord(primaryModelRef) &&
      typeof primaryModelRef.primary === "string"
    ) {
      return primaryModelRef.primary.trim();
    }
    return "";
  }

  readProviderApi(providerKey: string): string | undefined {
    const rootConfig = this.api.config as Record<string, unknown>;
    const modelCatalog = isRuntimeObjectRecord(rootConfig.models) ? rootConfig.models : undefined;
    const providerCatalog =
      modelCatalog && isRuntimeObjectRecord(modelCatalog.providers)
        ? modelCatalog.providers
        : undefined;
    if (!providerCatalog) {
      return undefined;
    }
    const providerEntry = providerCatalog[providerKey];
    if (!isRuntimeObjectRecord(providerEntry)) {
      return undefined;
    }
    return typeof providerEntry.api === "string" ? providerEntry.api.trim() : undefined;
  }

  async resolveApiKeyForModel(providerKey: string, modelId: string): Promise<string | undefined> {
    const runtimeAuth = this.readRuntimeModelAuth();
    if (!runtimeAuth) {
      this.logger.debug("runtime modelAuth unavailable");
      return undefined;
    }
    try {
      const authLookup = await runtimeAuth.getApiKeyForModel({
        model: buildAuthLookupDescriptor(providerKey, modelId),
        cfg: this.api.config,
      });
      return typeof authLookup?.apiKey === "string" && authLookup.apiKey.trim()
        ? authLookup.apiKey.trim()
        : undefined;
    } catch (error) {
      this.logger.debug("runtime modelAuth lookup failed", {
        provider: providerKey,
        model: modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  resolveAgentDir(): string {
    return this.api.resolvePath(".");
  }
}
