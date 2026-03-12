// SPDX-License-Identifier: Apache-2.0

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TurnEntry } from "../types/domain.js";
import { parseJsonObject } from "../utils/json.js";
import { extractPlainTextFromMessage } from "./turn-normalizer.js";

function readUserText(message: AgentMessage | undefined): string {
  if (!message || typeof message !== "object" || !("role" in message)) {
    return "";
  }
  const role = (message as unknown as Record<string, unknown>).role;
  if (role !== "user") {
    return "";
  }
  return extractPlainTextFromMessage(message).replace(/^user\s*/i, "").trim();
}

export function buildStartupRecallQuery(turns: TurnEntry[], windowSize: number): string {
  const recent = turns.slice(-windowSize);
  return recent.map((turn) => turn.plain_text).join("\n").trim();
}

export function buildReplyRecallQuery(messages: AgentMessage[]): string {
  const userTexts = messages
    .map((message) => readUserText(message))
    .filter((text) => text.trim().length > 0);
  if (userTexts.length === 0) {
    return "";
  }
  const latest = userTexts[userTexts.length - 1] ?? "";
  if (latest.length >= 48) {
    return latest;
  }
  return userTexts.slice(-2).join("\n").trim();
}

export function readTurnMessage(turn: TurnEntry): AgentMessage | null {
  return parseJsonObject<AgentMessage | null>(turn.payload_json, null);
}
