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

import { describe, expect, it, beforeAll } from "vitest";
import { LocalEmbeddingProvider } from "../../../src/embeddings/providers/local.js";

describe("LocalEmbeddingProvider - Real Embedding Tests", () => {
  let provider: LocalEmbeddingProvider;
  let nodeLlamaCppAvailable = false;

  beforeAll(async () => {
    provider = new LocalEmbeddingProvider();
    
    try {
      const llamaCpp = await import("node-llama-cpp");
      nodeLlamaCppAvailable = !!llamaCpp;
      console.log("node-llama-cpp available:", nodeLlamaCppAvailable);
    } catch (err) {
      console.log("node-llama-cpp import error:", err);
      nodeLlamaCppAvailable = false;
    }
  }, 60000);

  it("should create provider instance", () => {
    expect(provider).toBeDefined();
    expect(provider.name).toBe("local");
  });

  it("should embed simple text and return valid vector", async () => {
    if (!nodeLlamaCppAvailable) {
      console.log("Skipping: node-llama-cpp not available");
      return;
    }

    const result = await provider.embed("Hello, world!");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every((v) => typeof v === "number")).toBe(true);
    }
  }, 120000);

  it("should embed Chinese text", async () => {
    if (!nodeLlamaCppAvailable) {
      console.log("Skipping: node-llama-cpp not available");
      return;
    }

    const result = await provider.embed("你好，世界！");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data.length).toBeGreaterThan(0);
    }
  }, 120000);

  it("should embed longer text", async () => {
    if (!nodeLlamaCppAvailable) {
      console.log("Skipping: node-llama-cpp not available");
      return;
    }

    const longText = "This is a longer piece of text that should still be embedded correctly. ".repeat(10);
    const result = await provider.embed(longText);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data.length).toBeGreaterThan(0);
    }
  }, 120000);

  it("should produce normalized vectors", async () => {
    if (!nodeLlamaCppAvailable) {
      console.log("Skipping: node-llama-cpp not available");
      return;
    }

    const result = await provider.embed("Test normalization");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const vector = result.data;
      const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    }
  }, 120000);

  it("should produce consistent embeddings for same text", async () => {
    if (!nodeLlamaCppAvailable) {
      console.log("Skipping: node-llama-cpp not available");
      return;
    }

    const text = "Consistent embedding test";
    const result1 = await provider.embed(text);
    const result2 = await provider.embed(text);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    
    if (result1.ok && result2.ok) {
      for (let i = 0; i < result1.data.length; i++) {
        expect(result1.data[i]).toBeCloseTo(result2.data[i], 5);
      }
    }
  }, 120000);

  it("should handle empty string", async () => {
    if (!nodeLlamaCppAvailable) {
      console.log("Skipping: node-llama-cpp not available");
      return;
    }

    const result = await provider.embed("");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Array);
    }
  }, 120000);

  it("should handle special characters", async () => {
    if (!nodeLlamaCppAvailable) {
      console.log("Skipping: node-llama-cpp not available");
      return;
    }

    const result = await provider.embed("Special chars: @#$%^&*(){}[]|\\\\:;\\\"'<>,.?/~`");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Array);
    }
  }, 120000);

  it("should return error when node-llama-cpp is not available", async () => {
    if (nodeLlamaCppAvailable) {
      console.log("Skipping: node-llama-cpp is available, this test is for unavailable case");
      return;
    }

    const result = await provider.embed("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBeDefined();
      expect(result.error.message).toContain("Local embeddings unavailable");
    }
  });
});
