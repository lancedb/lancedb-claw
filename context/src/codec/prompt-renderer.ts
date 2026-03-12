// SPDX-License-Identifier: Apache-2.0

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { nowMs } from "../helpers/clock.js";
import type { DigestEntry, TurnEntry } from "../types/domain.js";
import { parseJsonObject } from "../utils/json.js";

function makeTextMessage(role: "user" | "assistant" | "toolResult" | "system", text: string): AgentMessage {
  return {
    role,
    content: [{ type: "text", text }],
    timestamp: nowMs(),
  } as AgentMessage;
}

export function renderTurnEntry(entry: TurnEntry): AgentMessage {
  const payload = parseJsonObject<AgentMessage | null>(entry.payload_json, null);
  if (payload && typeof payload === "object" && "role" in payload) {
    return payload;
  }
  const role =
    entry.render_role === "assistant" ||
    entry.render_role === "toolResult" ||
    entry.render_role === "system"
      ? (entry.render_role as "assistant" | "toolResult" | "system")
      : "user";
  return makeTextMessage(role, entry.plain_text);
}

export function renderDigestEntry(
  entry: DigestEntry,
  source: "history" | "reply_recall",
): AgentMessage {
  const text = [
    `<context_digest source="${source}" id="${entry.entry_id}" layer="${entry.layer_no}" turn_from="${entry.turn_from}" turn_to="${entry.turn_to}">`,
    `  <digest_text>${entry.plain_text}</digest_text>`,
    `</context_digest>`,
  ].join("\n");
  return makeTextMessage("user", text);
}
