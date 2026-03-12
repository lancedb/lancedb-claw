// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { afterTurnContext } from "../../src/lifecycle/after-turn.js";
import { createFakeServices } from "../helpers/create-fake-services.js";

describe("after-turn lifecycle", () => {
  it("ingests only new live messages and syncs text indexes", async () => {
    const { services, state } = createFakeServices();
    state.sessionState.set("session-a", {
      session_id: "session-a",
      session_file: "session.jsonl",
      imported_turn_count: 0,
      last_turn_seq: 0,
      highest_layer_no: 0,
      startup_probe_text: "",
      dirty_text_index: false,
      dirty_vector_entry_ids_json: "[]",
      created_at: "",
      updated_at: "",
      meta_json: "{}",
    });

    await afterTurnContext(services, {
      sessionId: "session-a",
      sessionFile: "session.jsonl",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Existing prompt message" }],
          timestamp: Date.now(),
        },
        {
          role: "user",
          content: [{ type: "text", text: "New request" }],
          timestamp: Date.now(),
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "New response" }],
          timestamp: Date.now(),
        } as any,
      ],
      prePromptMessageCount: 1,
      tokenBudget: 500,
    });

    expect(state.calls.syncAfterTurn).toHaveLength(1);
    expect((state.entryStore.get("session-a") ?? []).length).toBe(2);
  });
});
