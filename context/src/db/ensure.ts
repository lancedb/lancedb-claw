// SPDX-License-Identifier: Apache-2.0

import type * as LanceDB from "@lancedb/lancedb";
import { resolveEmbeddingDimensions, type ResolvedContextConfig } from "../types/config.js";
import type { ContextLogger } from "../types/domain.js";
import {
  buildEntryStoreSeedRow,
  buildPromptViewSeedRow,
  buildSessionStateSeedRow,
  ENTRY_STORE_TABLE,
  PROMPT_VIEW_TABLE,
  SESSION_STATE_TABLE,
} from "./schema.js";

export type ContextTables = {
  sessionState: LanceDB.Table;
  entryStore: LanceDB.Table;
  promptView: LanceDB.Table;
};

async function ensureTable(
  connection: LanceDB.Connection,
  tableName: string,
  seedData: Record<string, unknown>[],
): Promise<LanceDB.Table> {
  const names = await connection.tableNames();
  if (names.includes(tableName)) {
    return connection.openTable(tableName);
  }
  return connection.createTable(tableName, seedData);
}

async function deleteSeedRows(tables: ContextTables): Promise<void> {
  await tables.sessionState.delete(`session_id = '__schema__'`);
  await tables.entryStore.delete(`entry_id = '__schema__'`);
  await tables.promptView.delete(`session_id = '__schema__'`);
}

async function createIndexes(
  lancedb: typeof import("@lancedb/lancedb"),
  tables: ContextTables,
  logger: ContextLogger,
): Promise<void> {
  try {
    await tables.entryStore.createIndex("plain_text", {
      config: lancedb.Index.fts(),
      replace: false,
    });
  } catch (error) {
    logger.warn("entry_store plain_text FTS index unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await tables.entryStore.createIndex("vector_blob", { replace: false });
  } catch (error) {
    logger.warn("entry_store vector index unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const scalarTargets: Array<[LanceDB.Table, string]> = [
    [tables.entryStore, "session_id"],
    [tables.entryStore, "turn_from"],
    [tables.entryStore, "created_at"],
    [tables.promptView, "session_id"],
    [tables.promptView, "slot_no"],
  ];

  for (const [table, column] of scalarTargets) {
    try {
      await table.createIndex(column, { replace: false });
    } catch (error) {
      logger.debug("scalar index unavailable", {
        column,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function ensureContextTables(params: {
  lancedb: typeof import("@lancedb/lancedb");
  connection: LanceDB.Connection;
  config: ResolvedContextConfig;
  logger: ContextLogger;
}): Promise<ContextTables> {
  const vectorSize = resolveEmbeddingDimensions(params.config.semanticIndex);
  const sessionState = await ensureTable(params.connection, SESSION_STATE_TABLE, [
    buildSessionStateSeedRow(),
  ]);
  const entryStore = await ensureTable(params.connection, ENTRY_STORE_TABLE, [
    buildEntryStoreSeedRow(vectorSize),
  ]);
  const promptView = await ensureTable(params.connection, PROMPT_VIEW_TABLE, [
    buildPromptViewSeedRow(),
  ]);

  const tables = { sessionState, entryStore, promptView };
  await deleteSeedRows(tables);
  await createIndexes(params.lancedb, tables, params.logger);
  return tables;
}
