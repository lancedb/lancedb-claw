// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getDirtyVectorIds, hasDirtyState } from "../../src/indexing/dirty-state.js";

describe("dirty-state", () => {
  it("extracts vector ids and detects dirty state", () => {
    const row = {
      session_id: "session-a",
      session_file: "session.jsonl",
      imported_turn_count: 2,
      last_turn_seq: 2,
      highest_layer_no: 1,
      startup_probe_text: "",
      dirty_text_index: false,
      dirty_vector_entry_ids_json: JSON.stringify(["digest-a", "digest-b"]),
      created_at: "",
      updated_at: "",
      meta_json: "{}",
    };

    expect(getDirtyVectorIds(row)).toEqual(["digest-a", "digest-b"]);
    expect(hasDirtyState(row)).toBe(true);
  });
});
