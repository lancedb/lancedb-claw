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

export enum EmbeddingErrorType {
  NETWORK_ERROR = 'network_error',
  RATE_LIMIT = 'rate_limit',
  TOKEN_LIMIT = 'token_limit',
  AUTH_ERROR = 'auth_error',
  SERVER_ERROR = 'server_error',
  INVALID_REQUEST = 'invalid_request',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown',
}

export interface EmbeddingError {
  type: EmbeddingErrorType;
  message: string;
  details?: {
    statusCode?: number;
    responseBody?: string;
    cause?: unknown;
  };
}

export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<Result<number[]>>;
}

export type Result<T> = 
  | { ok: true; data: T }
  | { ok: false; error: EmbeddingError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err(error: EmbeddingError): Result<never> {
  return { ok: false, error };
}
