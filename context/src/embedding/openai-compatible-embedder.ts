// SPDX-License-Identifier: Apache-2.0

import type { SemanticIndexConfig } from "../types/config.js";

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const raw = baseUrl?.trim() || "https://api.openai.com/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export class OpenAICompatibleEmbedder {
  constructor(private readonly config: SemanticIndexConfig) {}

  async embedText(text: string): Promise<number[]> {
    const httpResponse = await fetch(`${normalizeBaseUrl(this.config.baseUrl)}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
        ...(typeof this.config.dimensions === "number"
          ? { dimensions: this.config.dimensions }
          : {}),
      }),
    });

    if (!httpResponse.ok) {
      throw new Error(`Embedding request failed with status ${httpResponse.status}`);
    }

    const payload = (await httpResponse.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vector = payload.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("Embedding response did not include a vector");
    }
    return vector.map((value) => Number(value));
  }
}
