// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { assembleContext } from "../../src/lifecycle/assemble.js";
import { createFakeServices } from "../helpers/create-fake-services.js";

describe("assemble lifecycle", () => {
  it("injects temporary recall digests before protected tail turns", async () => {
    const { services, state } = createFakeServices({
      recallCandidates: [
        {
          entry: {
            entry_id: "digest-recall",
            session_id: "session-a",
            entry_kind: "digest",
            render_role: "digest",
            turn_from: 1,
            turn_to: 4,
            layer_no: 2,
            plain_text: "Relevant historical digest",
            payload_json: "{}",
            token_estimate: 8,
            covered_token_estimate: 32,
            origin_entry_ids_json: JSON.stringify(["turn-1", "turn-2"]),
            vector_blob: [0.1, 0.2, 0.3],
            vector_model_id: "test",
            vector_size: 3,
            created_at: "",
            updated_at: "",
            meta_json: "{}",
          },
          score: 0.9,
          vectorScore: 0.9,
          textScore: 0.8,
          source: "hybrid",
        },
      ],
    });
    state.entryStore.set("session-a", [
      {
        entry_id: "digest-baseline",
        session_id: "session-a",
        entry_kind: "digest",
        render_role: "digest",
        turn_from: 1,
        turn_to: 3,
        layer_no: 1,
        plain_text: "Baseline digest",
        payload_json: "{}",
        token_estimate: 8,
        covered_token_estimate: 24,
        origin_entry_ids_json: JSON.stringify(["turn-1"]),
        vector_blob: [0.1, 0.2, 0.3],
        vector_model_id: "test",
        vector_size: 3,
        created_at: "",
        updated_at: "",
        meta_json: "{}",
      },
      {
        entry_id: "turn-9",
        session_id: "session-a",
        entry_kind: "turn",
        render_role: "user",
        turn_from: 9,
        turn_to: 9,
        layer_no: 0,
        plain_text: "Latest user question",
        payload_json: JSON.stringify({
          role: "user",
          content: [{ type: "text", text: "Latest user question" }],
          timestamp: Date.now(),
        }),
        token_estimate: 6,
        covered_token_estimate: 6,
        origin_entry_ids_json: "[]",
        vector_blob: null,
        vector_model_id: "",
        vector_size: 0,
        created_at: "",
        updated_at: "",
        meta_json: "{}",
      },
    ]);
    state.promptView.set("session-a", [
      {
        session_id: "session-a",
        slot_no: 0,
        entry_id: "digest-baseline",
        slot_type: "rollup",
        hold_mode: "normal",
        updated_at: "",
      },
      {
        session_id: "session-a",
        slot_no: 1,
        entry_id: "turn-9",
        slot_type: "tail",
        hold_mode: "sticky",
        updated_at: "",
      },
    ]);

    const result = await assembleContext(services, {
      sessionId: "session-a",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Need the relevant prior decision" }],
          timestamp: Date.now(),
        },
      ],
      tokenBudget: 200,
    });

    expect(JSON.stringify(result.messages)).toContain("reply_recall");
    expect(JSON.stringify(result.messages)).toContain("Latest user question");
  });
});
