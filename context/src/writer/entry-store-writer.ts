// SPDX-License-Identifier: Apache-2.0

import { nowIso } from "../helpers/clock.js";
import type { DigestEntry, TurnDraft, TurnEntry } from "../types/domain.js";
import { stringifyJson } from "../utils/json.js";
import { LanceDbClient } from "../db/client.js";

function toTurnRow(draft: TurnDraft): TurnEntry {
  const timestamp = nowIso();
  return {
    entry_id: draft.entryId,
    session_id: "",
    entry_kind: "turn",
    render_role: draft.role,
    turn_from: draft.turnFrom,
    turn_to: draft.turnTo,
    layer_no: 0,
    plain_text: draft.plainText,
    payload_json: stringifyJson(draft.payload),
    token_estimate: draft.tokenEstimate,
    covered_token_estimate: draft.tokenEstimate,
    origin_entry_ids_json: "[]",
    vector_blob: null,
    vector_model_id: "",
    vector_size: 0,
    created_at: timestamp,
    updated_at: timestamp,
    meta_json: "{}",
  };
}

export class EntryStoreWriter {
  constructor(private readonly db: LanceDbClient) {}

  async writeTurns(rows: TurnEntry[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const table = await this.db.getEntryStoreTable();
    await table.mergeInsert("entry_id").whenNotMatchedInsertAll().execute(rows);
  }

  async writeTurnDrafts(sessionId: string, drafts: TurnDraft[]): Promise<TurnEntry[]> {
    const rows = drafts.map((draft) => {
      const row = toTurnRow(draft);
      row.session_id = sessionId;
      return row;
    });
    await this.writeTurns(rows);
    return rows;
  }

  async writeDigest(row: DigestEntry): Promise<void> {
    const table = await this.db.getEntryStoreTable();
    await table.mergeInsert("entry_id").whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([row]);
  }
}
