// SPDX-License-Identifier: Apache-2.0

import type { EntryStoreRow } from "../types/storage.js";

function renderSourceEntry(entry: EntryStoreRow): string {
  if (entry.entry_kind === "turn") {
    return [
      `<turn seq="${entry.turn_from}" role="${entry.render_role}">`,
      entry.plain_text,
      `</turn>`,
    ].join("\n");
  }
  return [
    `<digest layer="${entry.layer_no}" turn_from="${entry.turn_from}" turn_to="${entry.turn_to}">`,
    entry.plain_text,
    `</digest>`,
  ].join("\n");
}

export function buildDigestPrompt(params: {
  sourceEntries: EntryStoreRow[];
  nextLayer: number;
  customInstructions?: string;
}): { instructionText: string; sourceBundleText: string } {
  const digestInstruction = [
    "You compress prior context for an autonomous coding agent.",
    "Write a concise factual digest in English.",
    "Keep decisions, errors, tool outcomes, file paths, and unresolved work.",
    "Do not invent details that are not present in the source entries.",
  ].join(" ");

  const bundleHeader = `Target layer: ${params.nextLayer}`;
  const customNote = params.customInstructions?.trim()
    ? `Additional instructions: ${params.customInstructions.trim()}`
    : "";
  const sourceBundle = params.sourceEntries.map(renderSourceEntry).join("\n\n");
  return {
    instructionText: digestInstruction,
    sourceBundleText: [bundleHeader, customNote, sourceBundle].filter(Boolean).join("\n\n"),
  };
}
