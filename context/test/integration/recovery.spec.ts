// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapContext } from "../../src/lifecycle/bootstrap.js";
import { createFakeServices } from "../helpers/create-fake-services.js";

describe("recovery lifecycle", () => {
  it("rebuilds prompt view when stored view is missing", async () => {
    const { services, state } = createFakeServices();
    const dir = mkdtempSync(path.join(os.tmpdir(), "recovery-"));
    const sessionFile = path.join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      JSON.stringify({
        message: {
          role: "user",
          content: [{ type: "text", text: "Recover the session view." }],
          timestamp: Date.now(),
        },
      }),
      "utf8",
    );

    await bootstrapContext(services, {
      sessionId: "session-a",
      sessionFile,
    });

    state.promptView.delete("session-a");

    await bootstrapContext(services, {
      sessionId: "session-a",
      sessionFile,
    });

    expect((state.promptView.get("session-a") ?? []).length).toBeGreaterThan(0);
  });
});
