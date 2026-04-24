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

import type { EmbeddingProvider, Result, EmbeddingError } from '../types.js';
import { ok, err, EmbeddingErrorType } from '../types.js';

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  private client: {
    embeddings: {
      create: (params: { model: string; input: string }) => Promise<{
        data: Array<{ embedding: number[] }>;
      }>;
    };
  };

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = {
      embeddings: {
        create: async (params: { model: string; input: string }) => {
          const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
          });
          if (!response.ok) {
            const errorText = await response.text();
            const error: Error & { status?: number; code?: string } = new Error(errorText);
            error.status = response.status;
            throw error;
          }
          return (await response.json()) as {
            data: Array<{ embedding: number[] }>;
          };
        },
      },
    };
  }

  private parseOpenAIError(error: unknown): EmbeddingError {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const statusCode = (error as { status?: number })?.status;
    const errorCode = (error as { code?: string })?.code;

    let errorType: EmbeddingErrorType = EmbeddingErrorType.UNKNOWN;

    if (errorCode === 'rate_limit_exceeded' || errorCode === 'quota_exceeded') {
      errorType = EmbeddingErrorType.RATE_LIMIT;
    } else if (errorCode === 'insufficient_quota' || errorCode === 'invalid_api_key' || errorCode === 'invalid_auth') {
      errorType = EmbeddingErrorType.AUTH_ERROR;
    } else if (errorCode === 'context_length_exceeded' || errorCode === 'token_limit') {
      errorType = EmbeddingErrorType.TOKEN_LIMIT;
    } else if (errorCode === 'invalid_request' || errorCode === 'validation_error') {
      errorType = EmbeddingErrorType.INVALID_REQUEST;
    } else if (statusCode && statusCode >= 500) {
      errorType = EmbeddingErrorType.SERVER_ERROR;
    }

    return {
      type: errorType,
      message: errorMessage,
      details: {
        statusCode,
        cause: error,
      },
    };
  }

  async embed(text: string): Promise<Result<number[]>> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });
      return ok(response.data[0].embedding);
    } catch (error) {
      return err(this.parseOpenAIError(error));
    }
  }
}
