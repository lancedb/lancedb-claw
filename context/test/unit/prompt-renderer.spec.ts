// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { renderDigestEntry, renderTurnEntry } from "../../src/codec/prompt-renderer.js";

describe("prompt-renderer", () => {
  it("renders digest entries as synthetic user messages", () => {
    const rendered = renderDigestEntry(
      {
        entry_id: "digest-a",
        session_id: "session-a",
        entry_kind: "digest",
        render_role: "digest",
        turn_from: 1,
        turn_to: 3,
        layer_no: 2,
        plain_text: "A concise digest.",
        payload_json: "{}",
        token_estimate: 12,
        covered_token_estimate: 40,
        origin_entry_ids_json: "[]",
        vector_blob: [0.1, 0.2],
        vector_model_id: "model-a",
        vector_size: 2,
        created_at: "",
        updated_at: "",
        meta_json: "{}",
      },
      "reply_recall",
    );

    expect(JSON.stringify(rendered)).toContain("<context_digest");
    expect(JSON.stringify(rendered)).toContain("reply_recall");
  });

  it("round-trips stored turn payloads when available", () => {
    const rendered = renderTurnEntry({
      entry_id: "turn-a",
      session_id: "session-a",
      entry_kind: "turn",
      render_role: "user",
      turn_from: 1,
      turn_to: 1,
      layer_no: 0,
      plain_text: "Hello",
      payload_json: JSON.stringify({
        role: "user",
        content: [{ type: "text", text: "Hello" }],
        timestamp: Date.now(),
      }),
      token_estimate: 2,
      covered_token_estimate: 2,
      origin_entry_ids_json: "[]",
      vector_blob: null,
      vector_model_id: "",
      vector_size: 0,
      created_at: "",
      updated_at: "",
      meta_json: "{}",
    });

    expect(JSON.stringify(rendered)).toContain("Hello");
  });
});
