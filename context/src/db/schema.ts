// SPDX-License-Identifier: Apache-2.0

import type { EntryStoreRow, PromptViewRow, SessionStateRow } from "../types/storage.js";

export const SESSION_STATE_TABLE = "session_state";
export const ENTRY_STORE_TABLE = "entry_store";
export const PROMPT_VIEW_TABLE = "prompt_view";

export function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildSessionStateSeedRow(): SessionStateRow {
  return {
    session_id: "__schema__",
    session_file: "",
    imported_turn_count: 0,
    last_turn_seq: 0,
    highest_layer_no: 0,
    startup_probe_text: "",
    dirty_text_index: false,
    dirty_vector_entry_ids_json: "[]",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    meta_json: "{}",
  };
}

export function buildEntryStoreSeedRow(vectorSize: number): EntryStoreRow {
  const vectorBlob: number[] = Array.from({ length: vectorSize }, () => 0);
  return {
    entry_id: "__schema__",
    session_id: "__schema__",
    entry_kind: "digest",
    render_role: "digest",
    turn_from: 0,
    turn_to: 0,
    layer_no: 1,
    plain_text: "",
    payload_json: "{}",
    token_estimate: 0,
    covered_token_estimate: 0,
    origin_entry_ids_json: "[]",
    vector_blob: vectorBlob,
    vector_model_id: "schema",
    vector_size: vectorSize,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    meta_json: "{}",
  };
}

export function buildPromptViewSeedRow(): PromptViewRow {
  return {
    session_id: "__schema__",
    slot_no: 0,
    entry_id: "__schema__",
    slot_type: "tail",
    hold_mode: "normal",
    updated_at: new Date(0).toISOString(),
  };
}
