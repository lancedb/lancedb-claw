// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapContext } from "../../src/lifecycle/bootstrap.js";
import { createFakeServices } from "../helpers/create-fake-services.js";

describe("bootstrap lifecycle", () => {
  it("imports transcript turns and rebuilds prompt view", async () => {
    const { services, state } = createFakeServices();
    state.entryStore.set("session-a", [
      {
        entry_id: "digest-existing",
        session_id: "session-a",
        entry_kind: "digest",
        render_role: "digest",
        turn_from: 1,
        turn_to: 2,
        layer_no: 1,
        plain_text: "Existing digest",
        payload_json: "{}",
        token_estimate: 8,
        covered_token_estimate: 16,
        origin_entry_ids_json: JSON.stringify(["turn-1", "turn-2"]),
        vector_blob: [0.1, 0.2, 0.3],
        vector_model_id: "test",
        vector_size: 3,
        created_at: "",
        updated_at: "",
        meta_json: "{}",
      },
    ]);

    const dir = mkdtempSync(path.join(os.tmpdir(), "bootstrap-"));
    const sessionFile = path.join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          message: {
            role: "user",
            content: [{ type: "text", text: "Open the workspace." }],
            timestamp: Date.now(),
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Workspace opened." }],
            timestamp: Date.now(),
          } as any,
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await bootstrapContext(services, {
      sessionId: "session-a",
      sessionFile,
    });

    expect(result.bootstrapped).toBe(true);
    expect(result.importedMessages).toBe(2);
    expect((state.promptView.get("session-a") ?? []).length).toBeGreaterThan(0);
  });
});
