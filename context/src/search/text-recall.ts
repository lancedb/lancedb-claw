// SPDX-License-Identifier: Apache-2.0

import { LanceDbClient } from "../db/client.js";
import { quoteSqlString } from "../db/schema.js";
import type { DigestEntry, RecallCandidate } from "../types/domain.js";
import { coerceEntryStoreRow } from "../reader/entry-store-reader.js";

export class TextRecall {
  constructor(
    private readonly db: LanceDbClient,
    private readonly _entryStoreReader: unknown,
  ) {}

  async recall(sessionId: string, query: string, limit: number): Promise<RecallCandidate[]> {
    if (!query.trim() || limit <= 0) {
      return [];
    }
    const table = await this.db.getEntryStoreTable();
    const rows = (await table
      .search(query, "fts")
      .where(`session_id = ${quoteSqlString(sessionId)} AND entry_kind = 'digest'`)
      .limit(Math.max(limit * 4, limit))
      .toArray()) as Array<Record<string, unknown>>;

    const maxScore = rows.reduce((max, row) => Math.max(max, Number(row._score ?? 0)), 0) || 1;
    return rows
      .map((row) => {
        const entry = coerceEntryStoreRow(row) as DigestEntry;
        const rawScore = Number(row._score ?? 0);
        const textScore = rawScore / maxScore;
        return {
          entry,
          score: textScore,
          vectorScore: 0,
          textScore,
          source: "text" as const,
        };
      })
      .filter((candidate) => candidate.entry.entry_kind === "digest");
  }
}
