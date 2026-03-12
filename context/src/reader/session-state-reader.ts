// SPDX-License-Identifier: Apache-2.0

import type { SessionStateRow } from "../types/storage.js";
import { LanceDbClient } from "../db/client.js";
import { quoteSqlString } from "../db/schema.js";

function coerceSessionStateRow(value: Record<string, unknown>): SessionStateRow {
  return {
    session_id: String(value.session_id ?? ""),
    session_file: String(value.session_file ?? ""),
    imported_turn_count: Number(value.imported_turn_count ?? 0),
    last_turn_seq: Number(value.last_turn_seq ?? 0),
    highest_layer_no: Number(value.highest_layer_no ?? 0),
    startup_probe_text: String(value.startup_probe_text ?? ""),
    dirty_text_index: Boolean(value.dirty_text_index),
    dirty_vector_entry_ids_json: String(value.dirty_vector_entry_ids_json ?? "[]"),
    created_at: String(value.created_at ?? ""),
    updated_at: String(value.updated_at ?? ""),
    meta_json: String(value.meta_json ?? "{}"),
  };
}

export class SessionStateReader {
  constructor(private readonly db: LanceDbClient) {}

  async get(sessionId: string): Promise<SessionStateRow | null> {
    const table = await this.db.getSessionStateTable();
    const rows = (await table
      .query()
      .where(`session_id = ${quoteSqlString(sessionId)}`)
      .toArray()) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return null;
    }
    return coerceSessionStateRow(rows[0]!);
  }
}
