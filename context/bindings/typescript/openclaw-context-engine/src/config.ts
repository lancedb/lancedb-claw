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

import { homedir } from "node:os";
import path from "node:path";
import type {
  OpenClawPluginConfigSchema,
} from "openclaw/plugin-sdk";

export type EmbeddingProviderType = 'openai' | 'doubao' | 'local';

export type EmbeddingRetryConfig = {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
};

export type ContextLanceDbEmbeddingConfig = {
  provider: EmbeddingProviderType;
  model?: string;
  apiKey?: string;
  url?: string;
  dimensions?: number;
  localModelPath?: string;
  localModelCacheDir?: string;
  retry?: EmbeddingRetryConfig;
};

export type ContextLanceDbConfig = {
  retrievalEnabled: boolean;
  skillSearchEnabled: boolean;
  skillSearchRecentMessageCount: number;
  skillSearchCandidateLimit: number;
  skillSearchMinResults: number;
  skillSearchCacheSize: number;
  skillSearchCleanupOlderThanDays: number;
  skillSearchMaxDistance: number;
  skillSyncIntervalSeconds: number;
  dbPath: string;
  freshTailCount: number;
  summaryRecallLimit: number;
  recentSummaryCount: number;
  detailMessagesPerSummary: number;
  retrievalTokenReserve: number;
  retry: {
    attempts: number;
    minDelayMs: number;
    maxDelayMs: number;
    jitter: number;
  };
  embedding?: ContextLanceDbEmbeddingConfig;
};

const DEFAULT_DB_PATH = path.join(homedir(), ".openclaw", "context-engine", "lancedb");
const DEFAULT_LOCAL_MODEL_CACHE_DIR = path.join(homedir(), ".node-llama-cpp", "models");
const DEFAULT_LOCAL_EMBEDDING_DIMENSIONS = 512;
const DEFAULT_REMOTE_EMBEDDING_DIMENSIONS = 2048;
const DEFAULT_FRESH_TAIL_COUNT = 12;
const DEFAULT_SUMMARY_RECALL_LIMIT = 3;
const DEFAULT_RECENT_SUMMARY_COUNT = 2;
const DEFAULT_DETAIL_MESSAGES_PER_SUMMARY = 3;
const DEFAULT_RETRIEVAL_TOKEN_RESERVE = 1600;
const DEFAULT_SKILL_SEARCH_RECENT_MESSAGE_COUNT = 2;
const DEFAULT_SKILL_SEARCH_CANDIDATE_LIMIT = 2;
const DEFAULT_SKILL_SEARCH_MIN_RESULTS = 2;
const DEFAULT_SKILL_SEARCH_CACHE_SIZE = 10;
const DEFAULT_SKILL_SEARCH_CLEANUP_OLDER_THAN_DAYS = 3;
const DEFAULT_SKILL_SEARCH_MAX_DISTANCE = 10;
const DEFAULT_SKILL_SYNC_INTERVAL_SECONDS = 60;
const DEFAULT_RETRY = {
  attempts: 3,
  minDelayMs: 300,
  maxDelayMs: 5000,
  jitter: 0.2,
};

function error(message: string, _pathParts: Array<string | number> = []) {
  return {
    success: false as const,
    error: {
      issues: [{ path: [], message }],
    },
  };
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function parseNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseEmbeddingRetryConfig(raw: unknown): EmbeddingRetryConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  return {
    maxRetries: parsePositiveInt(value.maxRetries, 3, 1, 10),
    initialDelayMs: parsePositiveInt(value.initialDelayMs, 1000, 0, 60_000),
    maxDelayMs: parsePositiveInt(value.maxDelayMs, 30000, 0, 300_000),
    timeoutMs: parsePositiveInt(value.timeoutMs, 30000, 0, 300_000),
  };
}

function parseEmbeddingConfig(raw: unknown): ContextLanceDbEmbeddingConfig | undefined {
  if (!raw) {
    return undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("embedding must be an object");
  }
  const value = raw as Record<string, unknown>;
  
  const providerStr = parseString(value.provider);
  if (!providerStr) {
    throw new Error("embedding.provider is required when embedding is configured");
  }
  
  const validProviders: EmbeddingProviderType[] = ['openai', 'doubao', 'local'];
  if (!validProviders.includes(providerStr as EmbeddingProviderType)) {
    throw new Error(`embedding.provider must be one of: ${validProviders.join(', ')}`);
  }

  const provider = providerStr as EmbeddingProviderType;
  const localModelCacheDir =
    provider === "local"
      ? (parseString(value.localModelCacheDir) ?? DEFAULT_LOCAL_MODEL_CACHE_DIR)
      : parseString(value.localModelCacheDir);
  const defaultDimensions =
    provider === "local" ? DEFAULT_LOCAL_EMBEDDING_DIMENSIONS : DEFAULT_REMOTE_EMBEDDING_DIMENSIONS;
  
  return {
    provider,
    model: parseString(value.model),
    apiKey: parseString(value.apiKey),
    url: parseString(value.url),
    dimensions: parsePositiveInt(value.dimensions, defaultDimensions, 1, Number.MAX_SAFE_INTEGER),
    localModelPath: parseString(value.localModelPath),
    localModelCacheDir,
    retry: parseEmbeddingRetryConfig(value.retry),
  };
}

export function parseContextLanceDbConfig(raw: unknown): ContextLanceDbConfig {
  if (raw === undefined) {
    return {
      retrievalEnabled: false,
      skillSearchEnabled: false,
      skillSearchRecentMessageCount: DEFAULT_SKILL_SEARCH_RECENT_MESSAGE_COUNT,
      skillSearchCandidateLimit: DEFAULT_SKILL_SEARCH_CANDIDATE_LIMIT,
      skillSearchMinResults: DEFAULT_SKILL_SEARCH_MIN_RESULTS,
      skillSearchCacheSize: DEFAULT_SKILL_SEARCH_CACHE_SIZE,
      skillSearchCleanupOlderThanDays: DEFAULT_SKILL_SEARCH_CLEANUP_OLDER_THAN_DAYS,
      skillSearchMaxDistance: DEFAULT_SKILL_SEARCH_MAX_DISTANCE,
      skillSyncIntervalSeconds: DEFAULT_SKILL_SYNC_INTERVAL_SECONDS,
      dbPath: DEFAULT_DB_PATH,
      freshTailCount: DEFAULT_FRESH_TAIL_COUNT,
      summaryRecallLimit: DEFAULT_SUMMARY_RECALL_LIMIT,
      recentSummaryCount: DEFAULT_RECENT_SUMMARY_COUNT,
      detailMessagesPerSummary: DEFAULT_DETAIL_MESSAGES_PER_SUMMARY,
      retrievalTokenReserve: DEFAULT_RETRIEVAL_TOKEN_RESERVE,
      retry: { ...DEFAULT_RETRY },
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("context-lancedb config must be an object");
  }
  const value = raw as Record<string, unknown>;
  const retryValue =
    value.retry && typeof value.retry === "object" && !Array.isArray(value.retry)
      ? (value.retry as Record<string, unknown>)
      : undefined;

  return {
    retrievalEnabled: value.retrievalEnabled === true,
    skillSearchEnabled: value.skillSearchEnabled === true,
    skillSearchRecentMessageCount: parsePositiveInt(
      value.skillSearchRecentMessageCount,
      DEFAULT_SKILL_SEARCH_RECENT_MESSAGE_COUNT,
      1,
      16,
    ),
    skillSearchCandidateLimit: parsePositiveInt(
      value.skillSearchCandidateLimit,
      DEFAULT_SKILL_SEARCH_CANDIDATE_LIMIT,
      1,
      64,
    ),
    skillSearchMinResults: parsePositiveInt(
      value.skillSearchMinResults,
      DEFAULT_SKILL_SEARCH_MIN_RESULTS,
      1,
      32,
    ),
    skillSearchCacheSize: parsePositiveInt(
      value.skillSearchCacheSize,
      DEFAULT_SKILL_SEARCH_CACHE_SIZE,
      1,
      500,
    ),
    skillSearchCleanupOlderThanDays: parsePositiveInt(
      value.skillSearchCleanupOlderThanDays,
      DEFAULT_SKILL_SEARCH_CLEANUP_OLDER_THAN_DAYS,
      0,
      365,
    ),
    skillSearchMaxDistance: parseNumberInRange(
      value.skillSearchMaxDistance,
      DEFAULT_SKILL_SEARCH_MAX_DISTANCE,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    skillSyncIntervalSeconds: parsePositiveInt(
        value.skillSyncIntervalSeconds,
        DEFAULT_SKILL_SYNC_INTERVAL_SECONDS,
        1,
        86400,
    ),
    dbPath: parseString(value.dbPath) ?? DEFAULT_DB_PATH,
    freshTailCount: parsePositiveInt(value.freshTailCount, DEFAULT_FRESH_TAIL_COUNT, 1, 128),
    summaryRecallLimit: parsePositiveInt(
      value.summaryRecallLimit,
      DEFAULT_SUMMARY_RECALL_LIMIT,
      1,
      32,
    ),
    recentSummaryCount: parsePositiveInt(
      value.recentSummaryCount,
      DEFAULT_RECENT_SUMMARY_COUNT,
      0,
      32,
    ),
    detailMessagesPerSummary: parsePositiveInt(
      value.detailMessagesPerSummary,
      DEFAULT_DETAIL_MESSAGES_PER_SUMMARY,
      0,
      16,
    ),
    retrievalTokenReserve: parsePositiveInt(
      value.retrievalTokenReserve,
      DEFAULT_RETRIEVAL_TOKEN_RESERVE,
      128,
      16_384,
    ),
    retry: {
      attempts: parsePositiveInt(retryValue?.attempts, DEFAULT_RETRY.attempts ?? 3, 1, 10),
      minDelayMs: parsePositiveInt(
        retryValue?.minDelayMs,
        DEFAULT_RETRY.minDelayMs ?? 300,
        0,
        60_000,
      ),
      maxDelayMs: parsePositiveInt(
        retryValue?.maxDelayMs,
        DEFAULT_RETRY.maxDelayMs ?? 5000,
        0,
        300_000,
      ),
      jitter:
        typeof retryValue?.jitter === "number" && Number.isFinite(retryValue.jitter)
          ? Math.min(1, Math.max(0, retryValue.jitter))
          : DEFAULT_RETRY.jitter,
    },
    embedding: parseEmbeddingConfig(value.embedding),
  };
}

export const contextLanceDbConfigSchema: OpenClawPluginConfigSchema = {
  safeParse(value: unknown) {
    try {
      return {
        success: true as const,
        data: parseContextLanceDbConfig(value),
      };
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  },
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      retrievalEnabled: { type: "boolean" },
      skillSearchEnabled: { type: "boolean" },
      skillSearchRecentMessageCount: { type: "number", minimum: 1 },
      skillSearchCandidateLimit: { type: "number", minimum: 1 },
      skillSearchMinResults: { type: "number", minimum: 1 },
      skillSearchCacheSize: { type: "number", minimum: 1 },
      skillSearchCleanupOlderThanDays: { type: "number", minimum: 0 },
      skillSearchMaxDistance: { type: "number", minimum: 0 },
      skillSyncIntervalSeconds: { type: "number", minimum: 60 },
      dbPath: { type: "string" },
      freshTailCount: { type: "number", minimum: 1 },
      summaryRecallLimit: { type: "number", minimum: 1 },
      recentSummaryCount: { type: "number", minimum: 0 },
      detailMessagesPerSummary: { type: "number", minimum: 0 },
      retrievalTokenReserve: { type: "number", minimum: 128 },
      retry: {
        type: "object",
        additionalProperties: false,
        properties: {
          attempts: { type: "number", minimum: 1 },
          minDelayMs: { type: "number", minimum: 0 },
          maxDelayMs: { type: "number", minimum: 0 },
          jitter: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      embedding: {
        type: "object",
        additionalProperties: false,
        properties: {
          provider: {
            type: "string",
            enum: ["openai", "doubao", "local"],
          },
          model: { type: "string" },
          apiKey: { type: "string" },
          url: { type: "string" },
          dimensions: { type: "number", minimum: 1 },
          localModelPath: { type: "string" },
          localModelCacheDir: { type: "string" },
          retry: {
            type: "object",
            additionalProperties: false,
            properties: {
              maxRetries: { type: "number", minimum: 1 },
              initialDelayMs: { type: "number", minimum: 0 },
              maxDelayMs: { type: "number", minimum: 0 },
              timeoutMs: { type: "number", minimum: 0 },
            },
          },
        },
        required: ["provider"],
      },
    },
  },
};
