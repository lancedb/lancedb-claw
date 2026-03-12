// SPDX-License-Identifier: Apache-2.0

import type { EntryStoreRow } from "../types/storage.js";

function pickKeyLines(entries: EntryStoreRow[]): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    const text = entry.plain_text.trim();
    if (!text) {
      continue;
    }
    if (entry.render_role === "user") {
      lines.push(`User asked: ${text.slice(0, 240)}`);
      continue;
    }
    if (entry.render_role === "assistant") {
      lines.push(`Assistant response: ${text.slice(0, 240)}`);
      continue;
    }
    if (entry.render_role === "toolResult" || entry.render_role === "tool") {
      lines.push(`Tool output: ${text.slice(0, 240)}`);
      continue;
    }
    lines.push(text.slice(0, 240));
  }
  return lines.slice(0, 8);
}

export function buildFallbackDigest(entries: EntryStoreRow[]): string {
  const coverage = `Covers turns ${entries[0]?.turn_from ?? 0}-${entries[entries.length - 1]?.turn_to ?? 0}.`;
  const highlights = pickKeyLines(entries);
  if (highlights.length === 0) {
    return `${coverage}\nNo durable details were available.`;
  }
  return [coverage, ...highlights.map((line) => `- ${line}`)].join("\n");
}
