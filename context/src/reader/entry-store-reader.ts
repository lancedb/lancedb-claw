// SPDX-License-Identifier: Apache-2.0

import { LanceDbClient } from "../db/client.js";
import { quoteSqlString } from "../db/schema.js";
import type { DigestEntry, TurnEntry } from "../types/domain.js";
import type { EntryStoreRow } from "../types/storage.js";

export function coerceEntryStoreRow(value: Record<string, unknown>): EntryStoreRow {
  return {
    entry_id: String(value.entry_id ?? ""),
    session_id: String(value.session_id ?? ""),
    entry_kind: (value.entry_kind === "digest" ? "digest" : "turn") as "turn" | "digest",
    render_role: String(value.render_role ?? "user"),
    turn_from: Number(value.turn_from ?? 0),
    turn_to: Number(value.turn_to ?? 0),
    layer_no: Number(value.layer_no ?? 0),
    plain_text: String(value.plain_text ?? ""),
    payload_json: String(value.payload_json ?? "{}"),
    token_estimate: Number(value.token_estimate ?? 0),
    covered_token_estimate: Number(value.covered_token_estimate ?? 0),
    origin_entry_ids_json: String(value.origin_entry_ids_json ?? "[]"),
    vector_blob: Array.isArray(value.vector_blob)
      ? value.vector_blob.map((item) => Number(item))
      : null,
    vector_model_id: String(value.vector_model_id ?? ""),
    vector_size: Number(value.vector_size ?? 0),
    created_at: String(value.created_at ?? ""),
    updated_at: String(value.updated_at ?? ""),
    meta_json: String(value.meta_json ?? "{}"),
  };
}

function compareEntries(a: EntryStoreRow, b: EntryStoreRow): number {
  if (a.turn_from !== b.turn_from) {
    return a.turn_from - b.turn_from;
  }
  if (a.layer_no !== b.layer_no) {
    return a.layer_no - b.layer_no;
  }
  return a.entry_id.localeCompare(b.entry_id);
}

export class EntryStoreReader {
  constructor(private readonly db: LanceDbClient) {}

  private async queryWhere(where: string): Promise<EntryStoreRow[]> {
    const table = await this.db.getEntryStoreTable();
    const rows = (await table.query().where(where).toArray()) as Array<Record<string, unknown>>;
    return rows.map(coerceEntryStoreRow);
  }

  async getTurnCount(sessionId: string): Promise<number> {
    const table = await this.db.getEntryStoreTable();
    return table.countRows(
      `session_id = ${quoteSqlString(sessionId)} AND entry_kind = 'turn'`,
    );
  }

  async getMaxTurnSeq(sessionId: string): Promise<number> {
    const turns = await this.listTurns(sessionId);
    return turns.length === 0 ? 0 : turns[turns.length - 1]!.turn_to;
  }

  async listTurns(sessionId: string): Promise<TurnEntry[]> {
    return (await this.queryWhere(
      `session_id = ${quoteSqlString(sessionId)} AND entry_kind = 'turn'`,
    ))
      .sort(compareEntries)
      .filter((row): row is TurnEntry => row.entry_kind === "turn");
  }

  async listDigests(sessionId: string): Promise<DigestEntry[]> {
    return (await this.queryWhere(
      `session_id = ${quoteSqlString(sessionId)} AND entry_kind = 'digest'`,
    ))
      .sort(compareEntries)
      .filter((row): row is DigestEntry => row.entry_kind === "digest");
  }

  async listPendingDigestVectors(sessionId: string): Promise<DigestEntry[]> {
    const digests = await this.listDigests(sessionId);
    return digests.filter((digest) => !digest.vector_blob || digest.vector_size <= 0);
  }

  async listEntriesByIds(sessionId: string, entryIds: string[]): Promise<EntryStoreRow[]> {
    if (entryIds.length === 0) {
      return [];
    }
    const rows = await this.queryWhere(`session_id = ${quoteSqlString(sessionId)}`);
    const wanted = new Set(entryIds);
    return rows.filter((row) => wanted.has(row.entry_id)).sort(compareEntries);
  }

  async getById(sessionId: string, entryId: string): Promise<EntryStoreRow | null> {
    const rows = await this.queryWhere(
      `session_id = ${quoteSqlString(sessionId)} AND entry_id = ${quoteSqlString(entryId)}`,
    );
    return rows[0] ?? null;
  }
}
