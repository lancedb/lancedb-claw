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

import { describe, test, expect, beforeEach, beforeAll, vi } from 'vitest';
import { Embedder } from '../../src/embeddings/embedder.js';
import type { EmbeddingProvider, Result } from '../../src/embeddings/types.js';
import { EmbeddingErrorType } from '../../src/embeddings/types.js';
import { LocalEmbeddingProvider } from '../../src/embeddings/providers/local.js';

class MockProvider implements EmbeddingProvider {
  readonly name = 'MockProvider';
  private callCount = 0;
  private succeedOnAttempt: number;
  private errorType: EmbeddingErrorType | null;
  private errorMessage: string;
  private successData: number[];

  constructor(config: {
    succeedOnAttempt?: number;
    errorType?: EmbeddingErrorType | null;
    errorMessage?: string;
    successData?: number[];
  } = {}) {
    this.succeedOnAttempt = config.succeedOnAttempt ?? 1;
    this.errorType = config.errorType ?? null;
    this.errorMessage = config.errorMessage ?? 'Mock error';
    this.successData = config.successData ?? [0.1, 0.2, 0.3];
  }

  getCallCount(): number {
    return this.callCount;
  }

  reset(): void {
    this.callCount = 0;
  }

  async embed(_text: string): Promise<Result<number[]>> {
    this.callCount++;
    
    if (this.callCount >= this.succeedOnAttempt) {
      return { ok: true, data: this.successData };
    }

    if (this.errorType) {
      return {
        ok: false,
        error: {
          type: this.errorType,
          message: this.errorMessage,
        },
      };
    }

    return { ok: true, data: this.successData };
  }
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
};

describe('Embedder retry logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Retry on retryable errors', () => {
    test('NETWORK_ERROR should trigger retry', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 3,
        errorType: EmbeddingErrorType.NETWORK_ERROR,
        errorMessage: 'Network connection failed',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      const result = await embedder.embed('test text');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(provider.getCallCount()).toBe(3);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('retrying attempt 1'),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('retrying attempt 2'),
      );
    });

    test('RATE_LIMIT should trigger retry', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 2,
        errorType: EmbeddingErrorType.RATE_LIMIT,
        errorMessage: 'Rate limit exceeded',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100
      });

      const result = await embedder.embed('test text');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(provider.getCallCount()).toBe(2);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('retrying attempt 1'),
      );
    });

    test('SERVER_ERROR should trigger retry', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 2,
        errorType: EmbeddingErrorType.SERVER_ERROR,
        errorMessage: 'Internal server error',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      const result = await embedder.embed('test text');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(provider.getCallCount()).toBe(2);
    });

    test('TIMEOUT should trigger retry', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 2,
        errorType: EmbeddingErrorType.TIMEOUT,
        errorMessage: 'Request timeout',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      const result = await embedder.embed('test text');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(provider.getCallCount()).toBe(2);
    });
  });

  describe('No retry on non-retryable errors', () => {
    test('AUTH_ERROR should throw immediately', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 999,
        errorType: EmbeddingErrorType.AUTH_ERROR,
        errorMessage: 'Invalid API key',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      await expect(embedder.embed('test text')).rejects.toThrow('Invalid API key');
      expect(provider.getCallCount()).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('non-retryable error'),
      );
    });

    test('TOKEN_LIMIT should throw immediately', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 999,
        errorType: EmbeddingErrorType.TOKEN_LIMIT,
        errorMessage: 'Token limit exceeded',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      await expect(embedder.embed('test text')).rejects.toThrow('Token limit exceeded');
      expect(provider.getCallCount()).toBe(1);
    });

    test('INVALID_REQUEST should throw immediately', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 999,
        errorType: EmbeddingErrorType.INVALID_REQUEST,
        errorMessage: 'Invalid request parameters',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      await expect(embedder.embed('test text')).rejects.toThrow('Invalid request parameters');
      expect(provider.getCallCount()).toBe(1);
    });

    test('UNKNOWN should throw immediately', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 999,
        errorType: EmbeddingErrorType.UNKNOWN,
        errorMessage: 'Unknown error occurred',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      await expect(embedder.embed('test text')).rejects.toThrow('Unknown error occurred');
      expect(provider.getCallCount()).toBe(1);
    });
  });

  describe('Max retries limit', () => {
    test('stops after maxRetries attempts', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 999,
        errorType: EmbeddingErrorType.NETWORK_ERROR,
        errorMessage: 'Network error',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      await expect(embedder.embed('test text')).rejects.toThrow('Network error');
      expect(provider.getCallCount()).toBe(4);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('reached max retries 3'),
      );
    });
  });

  describe('Success after N retries', () => {
    test('success after 1 retry', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 2,
        errorType: EmbeddingErrorType.NETWORK_ERROR,
        errorMessage: 'Network error',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      const result = await embedder.embed('test text');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(provider.getCallCount()).toBe(2);
    });

    test('success after 2 retries', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 3,
        errorType: EmbeddingErrorType.SERVER_ERROR,
        errorMessage: 'Server error',
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      const result = await embedder.embed('test text');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(provider.getCallCount()).toBe(3);
    });
  });

  describe('Success on first attempt', () => {
    test('no retries when first attempt succeeds', async () => {
      const provider = new MockProvider({
        succeedOnAttempt: 1,
      });

      const embedder = new Embedder(provider, mockLogger, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
      });

      const result = await embedder.embed('test text');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(provider.getCallCount()).toBe(1);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});

describe('Embedder with LocalEmbeddingProvider - Real Embedding Tests', () => {
  let nodeLlamaCppAvailable = false;
  let localEmbeddingAvailable = false;
  let localEmbeddingProbeError: unknown;

  beforeAll(async () => {
    try {
      await import('node-llama-cpp');
      nodeLlamaCppAvailable = true;
      console.log('node-llama-cpp available for Embedder integration tests:', nodeLlamaCppAvailable);
      const provider = new LocalEmbeddingProvider();
      const probe = await provider.embed('Local embedder health check');
      if (probe.ok) {
        const magnitude = Math.sqrt(probe.data.reduce((sum, val) => sum + val * val, 0));
        localEmbeddingAvailable = probe.data.length > 0 && magnitude > 0;
        if (!localEmbeddingAvailable) {
          localEmbeddingProbeError = new Error('local embedding provider returned a degenerate vector');
        }
      } else {
        localEmbeddingProbeError = probe.error;
      }
      if (!localEmbeddingAvailable) {
        console.log('Local embedding provider unavailable for Embedder integration tests:', localEmbeddingProbeError);
      }
    } catch (err) {
      console.log('node-llama-cpp import error:', err);
      nodeLlamaCppAvailable = false;
      localEmbeddingProbeError = err;
    }
  }, 60000);

  function skipIfLocalEmbeddingUnavailable(): boolean {
    if (!nodeLlamaCppAvailable) {
      console.log('Skipping: node-llama-cpp not available');
      return true;
    }
    if (!localEmbeddingAvailable) {
      console.log('Skipping: local embedding provider unavailable');
      return true;
    }
    return false;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should embed Chinese text using local provider through Embedder', async () => {
    if (skipIfLocalEmbeddingUnavailable()) {
      return;
    }

    const embedder = Embedder.create(
        { provider: 'local' },
        mockLogger,
    );

    const result = await embedder.embed('你好，世界！');

    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);
  }, 120000);

  test('Embedder.create should create embedder with local provider', async () => {
    if (skipIfLocalEmbeddingUnavailable()) {
      return;
    }

    const embedder = Embedder.create(
      { provider: 'local' },
      mockLogger,
    );

    const result = await embedder.embed('Test Embedder.create');

    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);
  }, 120000);
});
