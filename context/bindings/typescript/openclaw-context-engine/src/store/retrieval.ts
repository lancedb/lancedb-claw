/*
 * Copyright 2026 The OpenClaw Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ContextLanceDbConfig } from "../config.js";
import {
  createRetryOptions,
  loadLanceDb,
  sqlString,
  type MessageRow,
  type StateRow,
  type StoreCore,
  type SummaryInsertRow,
  type SummaryRow,
  type SummarySearchResult,
} from "./helper.js";
import { retryAsync } from "../retry.js";

export class RetrievalStoreModule {
  constructor(
    private readonly config: ContextLanceDbConfig,
    private readonly core: StoreCore,
  ) {}

  async ensureIndexes(): Promise<void> {
    if (this.core.indexesEnsured) {
      return;
    }
    this.core.indexesEnsured = true;
    try {
      const messageTable = this.core.getMessageTable();
      const messageIndices = await messageTable.listIndices();
      const messageIndexNames = new Set(messageIndices.map((index) => index.name));
      const ensureMessageIndex = async (column: string, name: string) => {
        if (messageIndexNames.has(name)) {
          return;
        }
        await messageTable.createIndex(column, { name, replace: false });
      };
      await ensureMessageIndex("session_key", "context_messages_session_key_idx");
      await ensureMessageIndex("session_id", "context_messages_session_id_idx");
      await ensureMessageIndex("ordinal", "context_messages_ordinal_idx");
      await ensureMessageIndex("message_pk", "context_messages_message_pk_idx");

      const summaryTable = this.core.getSummaryTable();
      const summaryIndices = await summaryTable.listIndices();
      const summaryIndexNames = new Set(summaryIndices.map((index) => index.name));
      const ensureSummaryScalarIndex = async (column: string, name: string) => {
        if (summaryIndexNames.has(name)) {
          return;
        }
        await summaryTable.createIndex(column, { name, replace: false });
      };
      await ensureSummaryScalarIndex("session_key", "context_summaries_session_key_idx");
      await ensureSummaryScalarIndex("session_id", "context_summaries_session_id_idx");
      await ensureSummaryScalarIndex("summary_id", "context_summaries_summary_id_idx");
      await ensureSummaryScalarIndex(
        "covered_until_ordinal",
        "context_summaries_covered_until_ordinal_idx",
      );
      if (this.core.embeddingClient) {
        if (!summaryIndexNames.has("context_summaries_summary_vector_idx")) {
          await summaryTable.createIndex("summary_vector", {
            name: "context_summaries_summary_vector_idx",
            replace: false,
          });
        }
      } else if (!summaryIndexNames.has("context_summaries_summary_text_fts_idx")) {
        const lancedb = await loadLanceDb();
        await summaryTable.createIndex("summary_text", {
          name: "context_summaries_summary_text_fts_idx",
          config: lancedb.Index.fts(),
          replace: false,
        });
      }

      const stateTable = this.core.getStateTable();
      const stateIndices = await stateTable.listIndices();
      const stateIndexNames = new Set(stateIndices.map((index) => index.name));
      const ensureStateIndex = async (column: string, name: string) => {
        if (stateIndexNames.has(name)) {
          return;
        }
        await stateTable.createIndex(column, { name, replace: false });
      };
      await ensureStateIndex("session_file", "context_state_session_file_idx");
      await ensureStateIndex("session_id", "context_state_session_id_idx");
      await ensureStateIndex("written_at_ms", "context_state_written_at_ms_idx");
    } catch (err) {
      this.core.indexesEnsured = false;
      this.core.logger.warn(
        `context-lancedb: failed to ensure indexes (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  async getMaxOrdinal(sessionId: string): Promise<number> {
    const table = this.core.getMessageTable();
    const rowCount = await table.countRows(`session_id = ${sqlString(sessionId)}`);
    if (!Number.isFinite(rowCount) || rowCount <= 0) {
      return -1;
    }
    return Math.max(-1, Math.floor(rowCount) - 1);
  }

  async getStateBySessionFile(sessionFile: string): Promise<StateRow | null> {
    const table = this.core.getStateTable();
    const rows = await table
      .query()
      .where(`session_file = ${sqlString(sessionFile)}`)
      .select([
        "session_key",
        "session_id",
        "session_file",
        "session_file_size_bytes",
        "session_file_mtime_ms",
        "written_at_ms",
      ])
      .toArray();
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      session_key: String(row.session_key),
      session_id: String(row.session_id),
      session_file: String(row.session_file ?? ""),
      session_file_size_bytes: Number(row.session_file_size_bytes ?? 0),
      session_file_mtime_ms: Number(row.session_file_mtime_ms ?? 0),
      written_at_ms: Number(row.written_at_ms ?? 0),
    };
  }

  async addMessages(rows: MessageRow[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const table = this.core.getMessageTable();
    const inserted = await this.core.mergeInsertRows({
      table,
      rows,
      on: "message_pk",
      label: "context-lancedb-merge-messages",
    });
    void this.ensureIndexes();
    return inserted;
  }

  private async prepareSummaryPayloads(rows: SummaryInsertRow[]): Promise<SummaryInsertRow[]> {
    if (!this.core.embeddingClient || rows.length === 0) {
      return rows;
    }
    return await Promise.all(
      rows.map(async (row) => {
        const vector =
          row.summary_vector ??
          (await retryAsync(
            () => this.core.embeddingClient!.embed(row.summary_text),
            createRetryOptions(this.config, "context-lancedb-summary-embed"),
          ));
        return vector && vector.length > 0 ? { ...row, summary_vector: vector } : row;
      }),
    );
  }

  async addSummaries(rows: SummaryInsertRow[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const payloads = await this.prepareSummaryPayloads(rows);
    const table = this.core.getSummaryTable();
    const inserted = await this.core.mergeInsertRows({
      table,
      rows: payloads,
      on: "summary_id",
      label: "context-lancedb-merge-summaries",
    });
    void this.ensureIndexes();
    return inserted;
  }

  async addSummary(row: SummaryInsertRow): Promise<boolean> {
    const inserted = await this.addSummaries([row]);
    return inserted > 0;
  }

  async upsertState(row: StateRow): Promise<boolean> {
    const table = this.core.getStateTable();
    const changed = await this.core.mergeInsertRows({
      table,
      rows: [row],
      on: "session_file",
      label: "context-lancedb-upsert-state",
      updateWhenMatched: true,
    });
    void this.ensureIndexes();
    return changed >= 0;
  }

  async searchSummaries(params: {
    sessionKey: string;
    queryText: string;
    limit: number;
  }): Promise<SummarySearchResult[]> {
    await this.ensureIndexes();
    const table = this.core.getSummaryTable();
    if (!params.queryText.trim()) {
      return [];
    }
    if (this.core.embeddingClient) {
      const vector = await retryAsync(
        () => this.core.embeddingClient!.embed(params.queryText),
        createRetryOptions(this.config, "context-lancedb-search-embed"),
      );
      const results = await table
        .vectorSearch(vector)
        .where(`session_key = ${sqlString(params.sessionKey)}`)
        .limit(params.limit)
        .toArray();
      return results.map((row) => ({
        row: {
          summary_id: String(row.summary_id),
          session_key: String(row.session_key),
          session_id: String(row.session_id),
          summary_text: String(row.summary_text),
          compacted_at_ms: Number(row.compacted_at_ms ?? 0),
          written_at_ms: Number(row.written_at_ms ?? 0),
          first_kept_entry_id: String(row.first_kept_entry_id ?? ""),
          covered_until_ordinal: Number(row.covered_until_ordinal ?? -1),
          tokens_before: Number(row.tokens_before ?? 0),
          tokens_after: Number(row.tokens_after ?? 0),
          source: String(row.source ?? "compact"),
          summary_vector: Array.isArray(row.summary_vector)
            ? row.summary_vector.map((value: unknown) => Number(value))
            : undefined,
        },
        score:
          typeof (row as Record<string, unknown>)._distance === "number" &&
          Number.isFinite((row as Record<string, unknown>)._distance)
            ? 1 / (1 + Number((row as Record<string, unknown>)._distance))
            : 0,
      }));
    }
    const results = await table
      .search(params.queryText, "fts", "summary_text")
      .where(`session_key = ${sqlString(params.sessionKey)}`)
      .limit(params.limit)
      .toArray();
    return results.map((row) => ({
      row: {
        summary_id: String(row.summary_id),
        session_key: String(row.session_key),
        session_id: String(row.session_id),
        summary_text: String(row.summary_text),
        compacted_at_ms: Number(row.compacted_at_ms ?? 0),
        written_at_ms: Number(row.written_at_ms ?? 0),
        first_kept_entry_id: String(row.first_kept_entry_id ?? ""),
        covered_until_ordinal: Number(row.covered_until_ordinal ?? -1),
        tokens_before: Number(row.tokens_before ?? 0),
        tokens_after: Number(row.tokens_after ?? 0),
        source: String(row.source ?? "compact"),
      },
      score:
        typeof (row as Record<string, unknown>)._score === "number" &&
        Number.isFinite((row as Record<string, unknown>)._score)
          ? Number((row as Record<string, unknown>)._score)
          : 0,
    }));
  }

  async listRecentSummaries(sessionKey: string, limit: number): Promise<SummaryRow[]> {
    const table = this.core.getSummaryTable();
    if (limit <= 0) {
      return [];
    }
    const rows = await table
      .query()
      .where(`session_key = ${sqlString(sessionKey)}`)
      .select([
        "summary_id",
        "session_key",
        "session_id",
        "summary_text",
        "compacted_at_ms",
        "written_at_ms",
        "first_kept_entry_id",
        "covered_until_ordinal",
        "tokens_before",
        "tokens_after",
        "source",
      ])
      .toArray();
    return rows
      .map((row) => ({
        summary_id: String(row.summary_id),
        session_key: String(row.session_key),
        session_id: String(row.session_id),
        summary_text: String(row.summary_text),
        compacted_at_ms: Number(row.compacted_at_ms ?? 0),
        written_at_ms: Number(row.written_at_ms ?? 0),
        first_kept_entry_id: String(row.first_kept_entry_id ?? ""),
        covered_until_ordinal: Number(row.covered_until_ordinal ?? -1),
        tokens_before: Number(row.tokens_before ?? 0),
        tokens_after: Number(row.tokens_after ?? 0),
        source: String(row.source ?? "compact"),
      }))
      .sort((left, right) => right.compacted_at_ms - left.compacted_at_ms)
      .slice(0, limit);
  }

  async fetchDetailMessages(params: {
    sessionKey: string;
    sessionId: string;
    coveredUntilOrdinal: number;
    limit: number;
  }): Promise<MessageRow[]> {
    if (params.limit <= 0) {
      return [];
    }
    const table = this.core.getMessageTable();
    const rows = await table
      .query()
      .where(
        `session_key = ${sqlString(params.sessionKey)} AND session_id = ${sqlString(params.sessionId)}`,
      )
      .select([
        "message_pk",
        "session_key",
        "session_id",
        "ordinal",
        "role",
        "content_text",
        "content_json",
        "message_timestamp_ms",
        "written_at_ms",
        "source",
      ])
      .toArray();
    const filtered = rows
      .map((row) => ({
        message_pk: String(row.message_pk),
        session_key: String(row.session_key),
        session_id: String(row.session_id),
        ordinal: Number(row.ordinal ?? -1),
        role: String(row.role ?? "unknown"),
        content_text: String(row.content_text ?? ""),
        content_json: String(row.content_json ?? ""),
        message_timestamp_ms: Number(row.message_timestamp_ms ?? 0),
        written_at_ms: Number(row.written_at_ms ?? 0),
        source: String(row.source ?? "bootstrap"),
      }))
      .filter((row) => row.ordinal <= params.coveredUntilOrdinal)
      .sort((left, right) => left.ordinal - right.ordinal);
    return filtered.slice(Math.max(0, filtered.length - params.limit));
  }
}
