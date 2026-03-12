// SPDX-License-Identifier: Apache-2.0

export type SessionStateRow = {
  session_id: string;
  session_file: string;
  imported_turn_count: number;
  last_turn_seq: number;
  highest_layer_no: number;
  startup_probe_text: string;
  dirty_text_index: boolean;
  dirty_vector_entry_ids_json: string;
  created_at: string;
  updated_at: string;
  meta_json: string;
};

export type EntryStoreRow = {
  entry_id: string;
  session_id: string;
  entry_kind: "turn" | "digest";
  render_role: string;
  turn_from: number;
  turn_to: number;
  layer_no: number;
  plain_text: string;
  payload_json: string;
  token_estimate: number;
  covered_token_estimate: number;
  origin_entry_ids_json: string;
  vector_blob: number[] | null;
  vector_model_id: string;
  vector_size: number;
  created_at: string;
  updated_at: string;
  meta_json: string;
};

export type PromptViewRow = {
  session_id: string;
  slot_no: number;
  entry_id: string;
  slot_type: "anchor" | "rollup" | "tail";
  hold_mode: "sticky" | "normal";
  updated_at: string;
};
