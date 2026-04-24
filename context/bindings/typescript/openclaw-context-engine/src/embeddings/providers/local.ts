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

import type { EmbeddingProvider, Result, EmbeddingError } from "../types.js";
import { ok, err, EmbeddingErrorType } from "../types.js";

const DEFAULT_LOCAL_MODEL = "hf:CompendiumLabs/bge-small-zh-v1.5-gguf/bge-small-zh-v1.5-f16.gguf";

type NodeLlamaModule = {
  getLlama: (params: { logLevel: unknown }) => Promise<unknown>;
  resolveModelFile: (modelPath: string, modelCacheDir?: string) => Promise<string>;
  LlamaLogLevel: { error: unknown };
};

let nodeLlamaImportPromise: Promise<NodeLlamaModule> | null = null;

const importNodeLlamaCpp = async (): Promise<NodeLlamaModule> => {
  if (!nodeLlamaImportPromise) {
    nodeLlamaImportPromise = import("node-llama-cpp") as Promise<NodeLlamaModule>;
  }
  try {
    return await nodeLlamaImportPromise;
  } catch (error) {
    nodeLlamaImportPromise = null;
    throw error;
  }
};

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";

  private llama: unknown = null;
  private model: unknown = null;
  private context: unknown = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly modelPath: string = DEFAULT_LOCAL_MODEL,
    private readonly modelCacheDir?: string,
  ) {}

  private parseLocalError(error: unknown): EmbeddingError {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();

    let errorType: EmbeddingErrorType;

    if (lowerMessage.includes("model") && lowerMessage.includes("load")) {
      errorType = EmbeddingErrorType.SERVER_ERROR;
    } else if (lowerMessage.includes("memory") || lowerMessage.includes("oom")) {
      errorType = EmbeddingErrorType.SERVER_ERROR;
    } else if (lowerMessage.includes("input is longer than the context size")) {
      errorType = EmbeddingErrorType.TOKEN_LIMIT;
    } else {
      errorType = EmbeddingErrorType.UNKNOWN;
    }

    return {
      type: errorType,
      message: `Failed to generate local embedding: ${message}`,
      details: {
        cause: error,
      },
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.context) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      const { getLlama, resolveModelFile, LlamaLogLevel } = await importNodeLlamaCpp();

      if (!this.llama) {
        this.llama = await getLlama({ logLevel: LlamaLogLevel.error });
      }

      if (!this.model) {
        const resolved = await resolveModelFile(this.modelPath, this.modelCacheDir);
        this.model = await (this.llama as { loadModel: (opts: { modelPath: string }) => Promise<unknown> }).loadModel({ modelPath: resolved });
      }

      if (!this.context) {
        this.context = await (this.model as { createEmbeddingContext: () => Promise<unknown> }).createEmbeddingContext();
      }
    } catch (error) {
      this.initPromise = null;
      const detail = error instanceof Error ? error.message : String(error);
      const err = new Error(`[context-lancedb] Local embeddings unavailable. Reason: ${detail}`);
      (err as { cause: unknown }).cause = error;
      throw err;
    }
  }

  async embed(text: string): Promise<Result<number[]>> {
    try {
      await this.ensureInitialized();

      const embedding = await (this.context as { getEmbeddingFor: (text: string) => Promise<{ vector: Iterable<number> }> }).getEmbeddingFor(text);
      const vector = Array.from(embedding.vector) as number[];

      const sanitized = vector.map((val) => (Number.isFinite(val) ? val : 0));

      const magnitude = Math.sqrt(sanitized.reduce((sum, val) => sum + val * val, 0));
      if (magnitude > 0) {
        return ok(sanitized.map((val) => val / magnitude));
      }

      if (sanitized.length > 0 && text.trim().length > 0) {
        throw new Error("local embedding model returned a zero vector");
      }

      return ok(sanitized);
    } catch (error) {
      return err(this.parseLocalError(error));
    }
  }
}
