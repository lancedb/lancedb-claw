// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { makeTurnEntryId } from "../helpers/ids.js";
import type { TurnDraft } from "../types/domain.js";
import { estimateMessageTokens, estimateTextTokens } from "../utils/token-estimator.js";
import { trimMessagePayload } from "./payload-trimmer.js";

function normalizeRole(role: unknown): string | null {
  if (typeof role !== "string") {
    return null;
  }
  const trimmed = role.trim();
  return trimmed ? trimmed : null;
}

function flattenContent(content: unknown): string {
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
      const value = block as Record<string, unknown>;
      if (typeof value.text === "string") {
        return value.text;
      }
      if (typeof value.thinking === "string") {
        return value.thinking;
      }
      if (value.type === "toolCall") {
        const toolName = typeof value.name === "string" ? value.name : "tool";
        return `[tool call] ${toolName}`;
      }
      if (value.type === "image") {
        return "[image]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function extractPlainTextFromMessage(message: AgentMessage): string {
  if (!message || typeof message !== "object" || !("role" in message)) {
    return "";
  }
  const record = message as unknown as Record<string, unknown>;
  const role = normalizeRole(record.role) ?? "unknown";
  const content = flattenContent(record.content);
  const toolName = typeof record.toolName === "string" ? record.toolName : "";
  const extra = toolName ? `\n${toolName}` : "";
  return `${role}${extra}\n${content}`.trim();
}

function isSupportedMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object" || !("role" in value)) {
    return false;
  }
  const role = normalizeRole((value as Record<string, unknown>).role);
  return role !== null;
}

export function readSessionMessagesFromFile(sessionFile: string): AgentMessage[] {
  try {
    const raw = readFileSync(sessionFile, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }

    const messages: AgentMessage[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const item = line.trim();
      if (!item) {
        continue;
      }
      try {
        const parsed = JSON.parse(item) as unknown;
        const candidate =
          parsed && typeof parsed === "object" && "message" in (parsed as Record<string, unknown>)
            ? (parsed as { message?: unknown }).message
            : parsed;
        if (isSupportedMessage(candidate)) {
          messages.push(candidate);
        }
      } catch {
        // Skip malformed transcript lines.
      }
    }

    return messages;
  } catch {
    return [];
  }
}

export function normalizeTurnBatch(params: {
  sessionId: string;
  messages: AgentMessage[];
  startSeq: number;
  trimTextChars: number;
}): TurnDraft[] {
  const results: TurnDraft[] = [];
  let seq = params.startSeq;
  for (const message of params.messages) {
    if (!isSupportedMessage(message)) {
      continue;
    }
    const role = normalizeRole((message as unknown as Record<string, unknown>).role) ?? "unknown";
    const plainText = extractPlainTextFromMessage(message);
    const payload = trimMessagePayload(message, params.trimTextChars);
    const tokenEstimate = Math.max(
      estimateTextTokens(plainText),
      estimateMessageTokens(payload),
    );
    results.push({
      entryId: makeTurnEntryId({
        sessionId: params.sessionId,
        turnSeq: seq,
        role,
        plainText,
      }),
      role,
      turnFrom: seq,
      turnTo: seq,
      plainText,
      payload,
      tokenEstimate,
    });
    seq += 1;
  }
  return results;
}
