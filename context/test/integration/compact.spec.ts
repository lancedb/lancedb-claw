// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { compactContext } from "../../src/lifecycle/compact.js";
import { createFakeServices } from "../helpers/create-fake-services.js";

function makeTurn(sessionId: string, seq: number, text: string) {
  return {
    entry_id: `turn-${seq}`,
    session_id: sessionId,
    entry_kind: "turn" as const,
    render_role: seq % 2 === 0 ? "assistant" : "user",
    turn_from: seq,
    turn_to: seq,
    layer_no: 0,
    plain_text: text,
    payload_json: JSON.stringify({
      role: seq % 2 === 0 ? "assistant" : "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    }),
    token_estimate: 10,
    covered_token_estimate: 10,
    origin_entry_ids_json: "[]",
    vector_blob: null,
    vector_model_id: "",
    vector_size: 0,
    created_at: "",
    updated_at: "",
    meta_json: "{}",
  };
}

describe("compact lifecycle", () => {
  it("creates a digest and replaces the oldest prompt window", async () => {
    const { services, state } = createFakeServices();
    state.entryStore.set(
      "session-a",
      Array.from({ length: 14 }, (_, index) =>
        makeTurn("session-a", index + 1, `Turn ${index + 1}`),
      ),
    );
    state.promptView.set(
      "session-a",
      Array.from({ length: 14 }, (_, index) => ({
        session_id: "session-a",
        slot_no: index,
        entry_id: `turn-${index + 1}`,
        slot_type: "tail" as const,
        hold_mode: "sticky" as const,
        updated_at: "",
      })),
    );
    state.sessionState.set("session-a", {
      session_id: "session-a",
      session_file: "session.jsonl",
      imported_turn_count: 14,
      last_turn_seq: 14,
      highest_layer_no: 0,
      startup_probe_text: "",
      dirty_text_index: false,
      dirty_vector_entry_ids_json: "[]",
      created_at: "",
      updated_at: "",
      meta_json: "{}",
    });

    const result = await compactContext(services, {
      sessionId: "session-a",
      sessionFile: "session.jsonl",
      force: true,
      tokenBudget: 120,
    });

    expect(result.compacted).toBe(true);
    expect(
      (state.entryStore.get("session-a") ?? []).some((entry) => entry.entry_kind === "digest"),
    ).toBe(true);
    expect(
      (state.promptView.get("session-a") ?? []).some((slot) => slot.slot_type === "rollup"),
    ).toBe(true);
  });
});
