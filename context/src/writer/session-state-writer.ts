// SPDX-License-Identifier: Apache-2.0

import { nowIso } from "../helpers/clock.js";
import { parseJsonArray, stringifyJson } from "../utils/json.js";
import { LanceDbClient } from "../db/client.js";
import { quoteSqlString } from "../db/schema.js";
import type { SessionStateRow } from "../types/storage.js";

async function readExistingRow(
  db: LanceDbClient,
  sessionId: string,
): Promise<SessionStateRow | null> {
  const table = await db.getSessionStateTable();
  const rows = (await table
    .query()
    .where(`session_id = ${quoteSqlString(sessionId)}`)
    .toArray()) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0]!;
  return {
    session_id: String(row.session_id ?? ""),
    session_file: String(row.session_file ?? ""),
    imported_turn_count: Number(row.imported_turn_count ?? 0),
    last_turn_seq: Number(row.last_turn_seq ?? 0),
    highest_layer_no: Number(row.highest_layer_no ?? 0),
    startup_probe_text: String(row.startup_probe_text ?? ""),
    dirty_text_index: Boolean(row.dirty_text_index),
    dirty_vector_entry_ids_json: String(row.dirty_vector_entry_ids_json ?? "[]"),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    meta_json: String(row.meta_json ?? "{}"),
  };
}

export class SessionStateWriter {
  constructor(private readonly db: LanceDbClient) {}

  async upsert(row: SessionStateRow): Promise<void> {
    const table = await this.db.getSessionStateTable();
    await table
      .mergeInsert("session_id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([row]);
  }

  async markDirtyText(sessionId: string, value: boolean): Promise<void> {
    const table = await this.db.getSessionStateTable();
    const existing = await readExistingRow(this.db, sessionId);
    if (!existing) {
      return;
    }
    await table.update({
      where: `session_id = ${quoteSqlString(sessionId)}`,
      values: {
        dirty_text_index: value,
        updated_at: nowIso(),
      },
    });
  }

  async addDirtyVectorId(sessionId: string, entryId: string): Promise<void> {
    const existing = await readExistingRow(this.db, sessionId);
    if (!existing) {
      return;
    }
    const next = new Set(parseJsonArray(existing.dirty_vector_entry_ids_json));
    next.add(entryId);
    const table = await this.db.getSessionStateTable();
    await table.update({
      where: `session_id = ${quoteSqlString(sessionId)}`,
      values: {
        dirty_vector_entry_ids_json: stringifyJson([...next]),
        updated_at: nowIso(),
      },
    });
  }

  async clearDirtyVectorIds(sessionId: string, entryIds: string[]): Promise<void> {
    const existing = await readExistingRow(this.db, sessionId);
    if (!existing || entryIds.length === 0) {
      return;
    }
    const toRemove = new Set(entryIds);
    const next = parseJsonArray(existing.dirty_vector_entry_ids_json).filter(
      (entryId) => !toRemove.has(entryId),
    );
    const table = await this.db.getSessionStateTable();
    await table.update({
      where: `session_id = ${quoteSqlString(sessionId)}`,
      values: {
        dirty_vector_entry_ids_json: stringifyJson(next),
        updated_at: nowIso(),
      },
    });
  }
}
