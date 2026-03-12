// SPDX-License-Identifier: Apache-2.0

import type { AgentMessage } from "@mariozechner/pi-agent-core";

function flattenTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") {
        return record.text;
      }
      if (typeof record.thinking === "string") {
        return record.thinking;
      }
      if (typeof record.name === "string") {
        return record.name;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function estimateTextTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function estimateMessageTokens(message: AgentMessage): number {
  if (!message || typeof message !== "object" || !("role" in message)) {
    return 0;
  }
  const record = message as unknown as Record<string, unknown>;
  const content = flattenTextContent(record.content);
  const role = typeof record.role === "string" ? record.role : "unknown";
  return estimateTextTokens(`${role}\n${content}`);
}

export function estimateMessageBatchTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}
