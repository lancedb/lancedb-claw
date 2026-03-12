// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { resolveContextConfig } from "../../src/types/config.js";
import { DigestBuilder } from "../../src/summary/digest-builder.js";

describe("digest-builder", () => {
  it("falls back to rule-based digest generation when no model is available", async () => {
    const builder = new DigestBuilder({
      config: resolveContextConfig(
        {
          semanticIndex: {
            apiKey: "test-key",
          },
        },
        (input) => input,
      ),
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
      },
      runtimeBridge: {
        readDefaultModelRef: () => "",
        readProviderApi: () => undefined,
        resolveApiKeyForModel: async () => undefined,
      },
    });

    const result = await builder.buildDigest({
      sessionId: "session-a",
      sourceEntries: [
        {
          entry_id: "turn-1",
          session_id: "session-a",
          entry_kind: "turn",
          render_role: "user",
          turn_from: 1,
          turn_to: 1,
          layer_no: 0,
          plain_text: "Need a schema redesign.",
          payload_json: "{}",
          token_estimate: 8,
          covered_token_estimate: 8,
          origin_entry_ids_json: "[]",
          vector_blob: null,
          vector_model_id: "",
          vector_size: 0,
          created_at: "",
          updated_at: "",
          meta_json: "{}",
        },
      ],
    });

    expect(result.draft.layerNo).toBe(1);
    expect(result.draft.payload.source).toBe("fallback");
    expect(result.draft.plainText).toContain("Covers turns");
  });
});
