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
import { EmbeddingErrorType } from "../types.js";
import { err, ok } from "../types.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export class DoubaoEmbeddingProvider implements EmbeddingProvider {
  readonly name = "doubao";
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    url?: string,
    timeoutMs?: number,
  ) {
    this.endpoint = this.buildEndpoint(url);
    this.timeoutMs = timeoutMs ?? 30000;
  }

  private buildEndpoint(url?: string): string {
    const defaultUrl = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal";
    let base = (url ?? defaultUrl).trim();
    if (!base.startsWith("http://") && !base.startsWith("https://")) {
      base = `https://${base}`;
    }
    return base;
  }

  private parseErrorResponse(statusCode: number, body: unknown, rawText: string): EmbeddingError {
    const errorMessage = (body as { error?: unknown }).error || `Request failed with status ${statusCode}`;
    const message = typeof errorMessage === "string" ? errorMessage : JSON.stringify(errorMessage);

    let type: EmbeddingErrorType;
    if (statusCode === 401 || statusCode === 403) {
      type = EmbeddingErrorType.AUTH_ERROR;
    } else if (statusCode === 429) {
      type = EmbeddingErrorType.RATE_LIMIT;
    } else if (statusCode >= 400 && statusCode < 500) {
      type = EmbeddingErrorType.INVALID_REQUEST;
    } else if (statusCode >= 500) {
      type = EmbeddingErrorType.SERVER_ERROR;
    } else {
      type = EmbeddingErrorType.UNKNOWN;
    }

    return {
      type,
      message,
      details: {
        statusCode,
        responseBody: rawText,
      },
    };
  }

  private parseFetchError(error: unknown): EmbeddingError {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          type: EmbeddingErrorType.TIMEOUT,
          message: `Doubao embeddings request timed out after ${this.timeoutMs}ms`,
          details: { cause: error },
        };
      }
      return {
        type: EmbeddingErrorType.NETWORK_ERROR,
        message: `Doubao embeddings request failed: ${error.message}`,
        details: { cause: error },
      };
    }
    return {
      type: EmbeddingErrorType.NETWORK_ERROR,
      message: `Doubao embeddings request failed: ${String(error)}`,
      details: { cause: error },
    };
  }

  async embed(text: string): Promise<Result<number[]>> {
    const payload = {
      model: this.model,
      input: [{ type: "text", text }],
      encoding_format: "float" as const,
      dimensions: this.dimensions,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: FetchResponse;
    try {
      response = (await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })) as FetchResponse;
    } catch (error) {
      clearTimeout(timeoutId);
      return err(this.parseFetchError(error));
    } finally {
      clearTimeout(timeoutId);
    }

    let rawText: string;
    try {
      rawText = await response.text();
    } catch (error) {
      return err({
        type: EmbeddingErrorType.NETWORK_ERROR,
        message: `Failed to read Doubao embeddings response (status ${response.status}): ${String(error)}`,
        details: { statusCode: response.status, cause: error },
      });
    }

    let body: unknown;
    if (rawText) {
      try {
        body = JSON.parse(rawText) as unknown;
      } catch (error) {
        return err({
          type: EmbeddingErrorType.INVALID_REQUEST,
          message: `Failed to parse Doubao embeddings response JSON (status ${response.status}): ${String(error)}; body=${rawText}`,
          details: { statusCode: response.status, responseBody: rawText, cause: error },
        });
      }
    } else {
      body = {};
    }

    if (!response.ok) {
      return err(this.parseErrorResponse(response.status, body, rawText));
    }

    const embedding = (body as { data?: { embedding?: number[] } }).data?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      const errorMessage = (body as { error?: unknown }).error || "No embedding returned from Doubao API";
      return err({
        type: EmbeddingErrorType.INVALID_REQUEST,
        message: typeof errorMessage === "string" ? errorMessage : JSON.stringify(errorMessage),
        details: { responseBody: rawText },
      });
    }

    return ok(embedding);
  }
}
