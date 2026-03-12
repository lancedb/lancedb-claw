// SPDX-License-Identifier: Apache-2.0

import type { ResolvedContextConfig } from "../types/config.js";
import type { RecallCandidate } from "../types/domain.js";
import { OpenAICompatibleEmbedder } from "../embedding/openai-compatible-embedder.js";
import { TextRecall } from "./text-recall.js";
import { VectorRecall } from "./vector-recall.js";

export class HybridRecall {
  constructor(
    private readonly deps: {
      config: ResolvedContextConfig;
      textRecall: TextRecall;
      vectorRecall: VectorRecall;
      embedder?: OpenAICompatibleEmbedder;
    },
  ) {}

  private mergeCandidates(
    textMatches: RecallCandidate[],
    vectorMatches: RecallCandidate[],
  ): RecallCandidate[] {
    const merged = new Map<string, RecallCandidate>();

    for (const candidate of vectorMatches) {
      merged.set(candidate.entry.entry_id, { ...candidate });
    }
    for (const candidate of textMatches) {
      const existing = merged.get(candidate.entry.entry_id);
      if (!existing) {
        merged.set(candidate.entry.entry_id, { ...candidate });
        continue;
      }
      existing.textScore = Math.max(existing.textScore, candidate.textScore);
      existing.source = "hybrid";
    }

    const results = [...merged.values()].map((candidate) => ({
      ...candidate,
      score:
        candidate.vectorScore * this.deps.config.internal.vectorBias +
        candidate.textScore * this.deps.config.internal.textBias,
    }));

    return results.sort((a, b) => b.score - a.score || a.entry.turn_from - b.entry.turn_from);
  }

  async recall(params: {
    sessionId: string;
    query: string;
    limit: number;
  }): Promise<RecallCandidate[]> {
    if (!params.query.trim() || params.limit <= 0) {
      return [];
    }
    const textMatches = await this.deps.textRecall.recall(
      params.sessionId,
      params.query,
      params.limit,
    );
    let vectorMatches: RecallCandidate[] = [];
    if (this.deps.embedder) {
      try {
        const queryVector = await this.deps.embedder.embedText(params.query);
        vectorMatches = await this.deps.vectorRecall.recall(
          params.sessionId,
          queryVector,
          params.limit,
        );
      } catch {
        vectorMatches = [];
      }
    }
    return this.mergeCandidates(textMatches, vectorMatches);
  }
}
