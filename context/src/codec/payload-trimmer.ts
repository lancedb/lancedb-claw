// SPDX-License-Identifier: Apache-2.0

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { isPlainObjectRecord } from "../helpers/errors.js";

function trimString(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n...[trimmed]`;
}

function trimUnknown(value: unknown, limit: number): unknown {
  if (typeof value === "string") {
    return trimString(value, limit);
  }
  if (Array.isArray(value)) {
    return value.map((item) => trimUnknown(item, limit));
  }
  if (!isPlainObjectRecord(value)) {
    return value;
  }
  const trimmedRecord: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "details") {
      continue;
    }
    trimmedRecord[key] = trimUnknown(entry, limit);
  }
  return trimmedRecord;
}

export function trimMessagePayload(message: AgentMessage, limit: number): AgentMessage {
  return trimUnknown(message, limit) as AgentMessage;
}
