// SPDX-License-Identifier: Apache-2.0

import type { SessionStateRow } from "../types/storage.js";
import { parseJsonArray } from "../utils/json.js";

export function getDirtyVectorIds(row: SessionStateRow | null): string[] {
  return row ? parseJsonArray(row.dirty_vector_entry_ids_json) : [];
}

export function hasDirtyState(row: SessionStateRow | null): boolean {
  if (!row) {
    return false;
  }
  return row.dirty_text_index || getDirtyVectorIds(row).length > 0;
}
