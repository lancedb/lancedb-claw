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

import { EmbeddingErrorType, EmbeddingProvider } from './types.js';
import { DoubaoEmbeddingProvider, LocalEmbeddingProvider, OpenAiEmbeddingProvider } from './providers/index.js';
import {ContextLanceDbEmbeddingConfig} from "../config.js";

export interface EmbedderOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

export interface EmbedderConfig {
  provider: 'openai' | 'doubao' | 'local';
  apiKey?: string;
  model?: string;
  url?: string;
  dimensions?: number;
  localModelPath?: string;
  localModelCacheDir?: string;
  retry?: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    timeoutMs?: number;
  };
}

export interface EmbedderLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export class Embedder {
  private provider: EmbeddingProvider;
  private options: EmbedderOptions;
  private logger: EmbedderLogger;

  constructor(
    provider: EmbeddingProvider,
    logger: EmbedderLogger,
    options: EmbedderOptions = {}
  ) {
    this.provider = provider;
    this.logger = logger;
    this.options = options;
  }

  async embed(text: string): Promise<number[]> {
    return await this.embedWithRetry(text);
  }

  private async embedWithRetry(text: string): Promise<number[]> {
    let lastError: Error | null = null;
    let lastErrorType: EmbeddingErrorType | null = null;
    let delay = this.options.initialDelayMs ?? 1000;

    for (let attempt = 0; attempt <= (this.options.maxRetries ?? 3); attempt++) {
      if (attempt !== 0) {
        this.logger.warn(
          `${this.provider.name} embeddings: retrying attempt ${attempt} after error (${lastErrorType}): ${lastError?.message}`,
        );
      }

      try {
        const result = await this.provider.embed(text);
        if (result.ok) {
          return result.data;
        }

        const errorResult = result as { ok: false; error: { type: EmbeddingErrorType; message: string; details?: { retryAfter?: number } } };
        lastError = new Error(errorResult.error.message);
        lastErrorType = errorResult.error.type;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        lastErrorType = 'unknown' as EmbeddingErrorType;
      }

      if (attempt >= (this.options.maxRetries ?? 3)) {
        this.logger.warn(
          `${this.provider.name} embeddings: reached max retries ${this.options.maxRetries ?? 3}, giving up`,
        );
        break;
      }

      const isRetryable = this.isRetryableErrorType(lastErrorType);
      if (!isRetryable) {
        this.logger.warn(`${this.provider.name} embeddings: non-retryable error (${lastErrorType}): ${lastError?.message}`);
        throw lastError;
      }

      let waitDelay = delay;
      await new Promise((resolve) => setTimeout(resolve, waitDelay));
      delay = Math.min(delay * 2, this.options.maxDelayMs ?? 30000);
    }

    throw lastError ?? new Error(`${this.provider.name} embeddings failed`);
  }

  private isRetryableErrorType(errorType: EmbeddingErrorType | null): boolean {
    if (!errorType) {
      return false;
    }

    switch (errorType) {
      case EmbeddingErrorType.NETWORK_ERROR:
      case EmbeddingErrorType.RATE_LIMIT:
      case EmbeddingErrorType.SERVER_ERROR:
      case EmbeddingErrorType.TIMEOUT:
        return true;
      case EmbeddingErrorType.TOKEN_LIMIT:
      case EmbeddingErrorType.AUTH_ERROR:
      case EmbeddingErrorType.INVALID_REQUEST:
      case EmbeddingErrorType.UNKNOWN:
        return false;
      default:
        return false;
    }
  }

  static create(
    config: ContextLanceDbEmbeddingConfig,
    logger: EmbedderLogger,
  ): Embedder {
    const { provider, apiKey, model, url, localModelPath, localModelCacheDir, dimensions, retry } = config;

    let providerInstance: EmbeddingProvider;

    switch (provider) {
      case 'openai': {
        if (!apiKey) {
          throw new Error('OpenAI embedding provider requires apiKey');
        }
        providerInstance = new OpenAiEmbeddingProvider(apiKey, model ?? 'text-embedding-3-small');
        break;
      }

      case 'doubao': {
        if (!apiKey) {
          throw new Error('Doubao embedding provider requires apiKey');
        }
        const vectorModel = model ?? 'doubao-embedding-vision-251215';
        const dims = dimensions ?? 2048;
        providerInstance = new DoubaoEmbeddingProvider(
          apiKey,
          vectorModel,
          dims,
          url,
          retry?.timeoutMs,
        );
        break;
      }

      case 'local': {
        providerInstance = new LocalEmbeddingProvider(localModelPath, localModelCacheDir);
        break;
      }

      default: {
        throw new Error(`Unsupported embedding provider: ${provider}`);
      }
    }

    const options: EmbedderOptions = {
      ...retry,
    };

    return new Embedder(providerInstance, logger, options);
  }
}
