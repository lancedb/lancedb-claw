// SPDX-License-Identifier: Apache-2.0

import { LanceDbClient } from "../db/client.js";
import { quoteSqlString } from "../db/schema.js";
import type { PromptSlot } from "../types/domain.js";

function coercePromptViewRow(value: Record<string, unknown>): PromptSlot {
  return {
    session_id: String(value.session_id ?? ""),
    slot_no: Number(value.slot_no ?? 0),
    entry_id: String(value.entry_id ?? ""),
    slot_type: (value.slot_type === "anchor" || value.slot_type === "rollup"
      ? value.slot_type
      : "tail") as "anchor" | "rollup" | "tail",
    hold_mode: (value.hold_mode === "sticky" ? "sticky" : "normal") as "sticky" | "normal",
    updated_at: String(value.updated_at ?? ""),
  };
}

export class PromptViewReader {
  constructor(private readonly db: LanceDbClient) {}

  async list(sessionId: string): Promise<PromptSlot[]> {
    const table = await this.db.getPromptViewTable();
    const rows = (await table
      .query()
      .where(`session_id = ${quoteSqlString(sessionId)}`)
      .toArray()) as Array<Record<string, unknown>>;
    return rows.map(coercePromptViewRow).sort((a, b) => a.slot_no - b.slot_no);
  }
}
