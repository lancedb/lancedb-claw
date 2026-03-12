// SPDX-License-Identifier: Apache-2.0

import { LanceDbClient } from "../db/client.js";
import { quoteSqlString } from "../db/schema.js";
import type { DigestEntry, RecallCandidate } from "../types/domain.js";
import { coerceEntryStoreRow } from "../reader/entry-store-reader.js";

export class VectorRecall {
  constructor(
    private readonly db: LanceDbClient,
    private readonly _entryStoreReader: unknown,
  ) {}

  async recall(sessionId: string, vector: number[], limit: number): Promise<RecallCandidate[]> {
    if (vector.length === 0 || limit <= 0) {
      return [];
    }
    const table = await this.db.getEntryStoreTable();
    const rows = (await table
      .vectorSearch(vector)
      .where(
        `session_id = ${quoteSqlString(sessionId)} AND entry_kind = 'digest' AND vector_size > 0`,
      )
      .limit(Math.max(limit * 4, limit))
      .toArray()) as Array<Record<string, unknown>>;

    return rows
      .map((row) => {
        const entry = coerceEntryStoreRow(row) as DigestEntry;
        const distance = Number(row._distance ?? 0);
        const vectorScore = 1 / (1 + Math.max(0, distance));
        return {
          entry,
          score: vectorScore,
          vectorScore,
          textScore: 0,
          source: "vector" as const,
        };
      })
      .filter((recallEntry) => recallEntry.entry.entry_kind === "digest");
  }
}
