// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeTurnBatch, readSessionMessagesFromFile } from "../../src/codec/turn-normalizer.js";

describe("turn-normalizer", () => {
  it("normalizes supported messages into stable turn drafts", () => {
    const drafts = normalizeTurnBatch({
      sessionId: "session-a",
      startSeq: 1,
      trimTextChars: 2048,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Need a design summary." }],
          timestamp: Date.now(),
        },
      ],
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.turnFrom).toBe(1);
    expect(drafts[0]!.plainText).toContain("Need a design summary.");
    expect(drafts[0]!.entryId).toMatch(/^turn_/);
  });

  it("loads JSONL transcript messages and skips malformed lines", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lancedb-context-"));
    const sessionFile = path.join(dir, "session.jsonl");
    writeFileSync(
      sessionFile,
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "Hello" }],
            timestamp: Date.now(),
          },
        }),
        "{bad json",
      ].join("\n"),
      "utf8",
    );

    const messages = readSessionMessagesFromFile(sessionFile);
    expect(messages).toHaveLength(1);
  });
});
