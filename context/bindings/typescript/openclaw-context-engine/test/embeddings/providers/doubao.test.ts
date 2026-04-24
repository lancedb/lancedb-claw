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
import { DoubaoEmbeddingProvider } from "../../../src/embeddings/providers/doubao.js";

describe("DoubaoEmbeddingProvider - Real Embedding Tests", () => {
  let provider: DoubaoEmbeddingProvider | undefined;
  let hasApiKey = false;

  beforeAll(() => {
    const apiKey = process.env.ARK_API_KEY || process.env.DOUBAO_API_KEY;
    hasApiKey = !!apiKey;
    
    if (hasApiKey) {
      provider = new DoubaoEmbeddingProvider(
        apiKey!,
        "doubao-embedding-vision-251215",
        2048,
      );
    }
    
    console.log("Doubao API key available:", hasApiKey);
  });

  it("should embed simple text and return valid vector", async () => {
    if (!provider) {
      console.log("Skipping: no API key available");
      return;
    }

    const result = await provider!.embed("Hello, world!");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every((v) => typeof v === "number")).toBe(true);
    }
  }, 30000);

  it("should embed Chinese text", async () => {
    if (!provider) {
      console.log("Skipping: no API key available");
      return;
    }

    const result = await provider!.embed("你好，世界！");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data.length).toBeGreaterThan(0);
    }
  }, 30000);

  it("should embed longer text", async () => {
    if (!provider) {
      console.log("Skipping: no API key available");
      return;
    }

    const longText = "This is a longer piece of text that should still be embedded correctly. ".repeat(10);
    const result = await provider!.embed(longText);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data.length).toBeGreaterThan(0);
    }
  }, 30000);

  it("should return error with invalid API key", async () => {
    const invalidProvider = new DoubaoEmbeddingProvider(
      "invalid-api-key",
      "doubao-embedding-vision-251215",
      2048,
    );

    const result = await invalidProvider.embed("test");
    console.log(result);

    expect(result.ok).toBe(false);
    expect(["auth_error", "network_error"]).toContain(result.error.type);
  }, 30000);
});
