// SPDX-License-Identifier: Apache-2.0

import os from "node:os";
import path from "node:path";

export type LogLevelName = "debug" | "info" | "warn" | "error";

export type DigestModelConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
};

export type SemanticIndexConfig = {
  provider: "openai";
  model: string;
  apiKey: string;
  baseUrl?: string;
  dimensions?: number;
};

export type LanceDbContextConfig = {
  storePath?: string;
  tailKeepCount?: number;
  shrinkStartRatio?: number;
  startupRecallLimit?: number;
  replyRecallLimit?: number;
  digestModel?: DigestModelConfig;
  semanticIndex?: SemanticIndexConfig;
  logLevel?: LogLevelName;
};

export type InternalContextDefaults = {
  bootstrapQueryWindow: number;
  bootstrapRecallTokenCap: number;
  replyRecallTokenCap: number;
  recallFloorScore: number;
  vectorBias: number;
  textBias: number;
  firstDigestMinCount: number;
  firstDigestTokenGoal: number;
  mergeDigestMinCount: number;
  mergeDigestTokenGoal: number;
  digestOutputMaxTokens: number;
  rollupBaselineLimit: number;
  trimTextChars: number;
};

export type ResolvedContextConfig = {
  storePath: string;
  tailKeepCount: number;
  shrinkStartRatio: number;
  startupRecallLimit: number;
  replyRecallLimit: number;
  digestModel?: DigestModelConfig;
  semanticIndex: SemanticIndexConfig;
  logLevel: LogLevelName;
  internal: InternalContextDefaults;
};

const DEFAULT_STORE_PATH = "~/.openclaw/context/lancedb-claw";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULTS: ResolvedContextConfig = {
  storePath: path.join(os.homedir(), ".openclaw", "context", "lancedb-claw"),
  tailKeepCount: 8,
  shrinkStartRatio: 0.72,
  startupRecallLimit: 3,
  replyRecallLimit: 3,
  semanticIndex: {
    provider: "openai",
    model: DEFAULT_EMBEDDING_MODEL,
    apiKey: "",
  },
  logLevel: "info",
  internal: {
    bootstrapQueryWindow: 4,
    bootstrapRecallTokenCap: 3500,
    replyRecallTokenCap: 3000,
    recallFloorScore: 0.28,
    vectorBias: 0.6,
    textBias: 0.4,
    firstDigestMinCount: 6,
    firstDigestTokenGoal: 18000,
    mergeDigestMinCount: 4,
    mergeDigestTokenGoal: 12000,
    digestOutputMaxTokens: 2000,
    rollupBaselineLimit: 2,
    trimTextChars: 24000,
  },
};

const KNOWN_EMBEDDING_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
};

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
}

function resolveHomeAndPath(
  value: string | undefined,
  resolvePath: (input: string) => string,
): string {
  const raw = resolveEnvVars(value?.trim() || DEFAULT_STORE_PATH);
  const expanded = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  return path.isAbsolute(expanded) ? expanded : resolvePath(expanded);
}

function requirePositiveInteger(value: unknown, label: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return Math.max(0, Math.floor(value));
}

function requireRatio(value: unknown, label: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1`);
  }
  return value;
}

function parseDigestModelOverride(value: unknown): DigestModelConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isConfigRecord(value)) {
    throw new Error("digestModel must be an object");
  }
  // TODO: Tighten digestModel validation again after OpenClaw can scaffold
  // plugin config during install without failing on temporarily empty objects.
  const providerKey =
    typeof value.provider === "string" ? resolveEnvVars(value.provider).trim() : "";
  const modelId = typeof value.model === "string" ? resolveEnvVars(value.model).trim() : "";
  const apiSecret = typeof value.apiKey === "string" ? resolveEnvVars(value.apiKey).trim() : "";
  const endpointBaseUrl =
    typeof value.baseUrl === "string" && value.baseUrl.trim()
      ? resolveEnvVars(value.baseUrl).trim()
      : undefined;
  if (!providerKey && !modelId && !apiSecret && !endpointBaseUrl) {
    return undefined;
  }
  if (!providerKey || !modelId || !apiSecret) {
    return undefined;
  }
  return {
    provider: providerKey,
    model: modelId,
    apiKey: apiSecret,
    baseUrl: endpointBaseUrl,
  };
}

function resolveSemanticIndex(value: unknown): SemanticIndexConfig {
  // TODO: Tighten semanticIndex validation again after OpenClaw supports
  // install-time config scaffolding for required plugin fields.
  if (value === undefined) {
    return { ...DEFAULTS.semanticIndex };
  }
  if (!isConfigRecord(value)) {
    throw new Error("semanticIndex must be an object");
  }
  const provider = typeof value.provider === "string" ? value.provider.trim() : "openai";
  if (provider !== "openai") {
    throw new Error("semanticIndex.provider must be 'openai'");
  }
  const model =
    typeof value.model === "string" && value.model.trim()
      ? resolveEnvVars(value.model).trim()
      : DEFAULT_EMBEDDING_MODEL;
  const apiKey = typeof value.apiKey === "string" ? resolveEnvVars(value.apiKey).trim() : "";
  const baseUrl =
    typeof value.baseUrl === "string" && value.baseUrl.trim()
      ? resolveEnvVars(value.baseUrl).trim()
      : undefined;
  const dimensions =
    typeof value.dimensions === "number" && Number.isFinite(value.dimensions)
      ? Math.max(1, Math.floor(value.dimensions))
      : undefined;
  return { provider: "openai", model, apiKey, baseUrl, dimensions };
}

export function resolveEmbeddingDimensions(config: SemanticIndexConfig): number {
  if (typeof config.dimensions === "number" && config.dimensions > 0) {
    return config.dimensions;
  }
  const known = KNOWN_EMBEDDING_DIMS[config.model];
  if (!known) {
    throw new Error(
      `semanticIndex.dimensions is required for unsupported embedding model '${config.model}'`,
    );
  }
  return known;
}

export function resolveContextConfig(
  value: unknown,
  resolvePath: (input: string) => string,
): ResolvedContextConfig {
  const configInput = isConfigRecord(value) ? value : {};
  const semanticIndex = resolveSemanticIndex(configInput.semanticIndex);
  return {
    storePath: resolveHomeAndPath(
      typeof configInput.storePath === "string" ? configInput.storePath : undefined,
      resolvePath,
    ),
    tailKeepCount: requirePositiveInteger(
      configInput.tailKeepCount,
      "tailKeepCount",
      DEFAULTS.tailKeepCount,
    ),
    shrinkStartRatio: requireRatio(
      configInput.shrinkStartRatio,
      "shrinkStartRatio",
      DEFAULTS.shrinkStartRatio,
    ),
    startupRecallLimit: requirePositiveInteger(
      configInput.startupRecallLimit,
      "startupRecallLimit",
      DEFAULTS.startupRecallLimit,
    ),
    replyRecallLimit: requirePositiveInteger(
      configInput.replyRecallLimit,
      "replyRecallLimit",
      DEFAULTS.replyRecallLimit,
    ),
    digestModel: parseDigestModelOverride(configInput.digestModel),
    semanticIndex,
    logLevel:
      configInput.logLevel === "debug" ||
      configInput.logLevel === "info" ||
      configInput.logLevel === "warn" ||
      configInput.logLevel === "error"
        ? configInput.logLevel
        : DEFAULTS.logLevel,
    internal: { ...DEFAULTS.internal },
  };
}
