// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { resolveContextConfig } from "../../src/types/config.js";
import { HybridRecall } from "../../src/search/hybrid-recall.js";

describe("hybrid-recall", () => {
  it("merges text and vector matches with weighted scoring", async () => {
    const config = resolveContextConfig(
      {
        semanticIndex: {
          apiKey: "test-key",
        },
      },
      (input) => input,
    );
    const hybridRecall = new HybridRecall({
      config,
      textRecall: {
        recall: async () => [
          {
            entry: {
              entry_id: "digest-1",
              session_id: "session-a",
              entry_kind: "digest",
              render_role: "digest",
              turn_from: 1,
              turn_to: 3,
              layer_no: 1,
              plain_text: "Text result",
              payload_json: "{}",
              token_estimate: 10,
              covered_token_estimate: 30,
              origin_entry_ids_json: "[]",
              vector_blob: [0.1, 0.2],
              vector_model_id: "model-a",
              vector_size: 2,
              created_at: "",
              updated_at: "",
              meta_json: "{}",
            },
            score: 0.4,
            vectorScore: 0,
            textScore: 0.4,
            source: "text",
          },
        ],
      } as any,
      vectorRecall: {
        recall: async () => [
          {
            entry: {
              entry_id: "digest-1",
              session_id: "session-a",
              entry_kind: "digest",
              render_role: "digest",
              turn_from: 1,
              turn_to: 3,
              layer_no: 1,
              plain_text: "Vector result",
              payload_json: "{}",
              token_estimate: 10,
              covered_token_estimate: 30,
              origin_entry_ids_json: "[]",
              vector_blob: [0.1, 0.2],
              vector_model_id: "model-a",
              vector_size: 2,
              created_at: "",
              updated_at: "",
              meta_json: "{}",
            },
            score: 0.9,
            vectorScore: 0.9,
            textScore: 0,
            source: "vector",
          },
        ],
      } as any,
      embedder: {
        embedText: async () => [0.1, 0.2],
      } as any,
    });

    const matches = await hybridRecall.recall({
      sessionId: "session-a",
      query: "digest query",
      limit: 3,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]!.source).toBe("hybrid");
    expect(matches[0]!.score).toBeGreaterThan(0.6);
  });
});
