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

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type * as LanceDB from "@lancedb/lancedb";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Field, FixedSizeList, Float32, Float64, Int32, List, Schema, Utf8 } from "apache-arrow";
import type { ContextLanceDbConfig } from "../config.js";
import { retryAsync, type RetryOptions } from "../retry.js";

export type ContextEmbeddingClient = {
  embed(text: string): Promise<number[]>;
};

export type StoreLogger = {
  warn: (message: string) => void;
  info: (message: string) => void;
};

export type MessageRow = {
  message_pk: string;
  session_key: string;
  session_id: string;
  ordinal: number;
  role: string;
  content_text: string;
  content_json: string;
  message_timestamp_ms: number;
  written_at_ms: number;
  source: string;
};

export type SummaryRow = {
  summary_id: string;
  session_key: string;
  session_id: string;
  summary_text: string;
  compacted_at_ms: number;
  written_at_ms: number;
  first_kept_entry_id: string;
  covered_until_ordinal: number;
  tokens_before: number;
  tokens_after: number;
  source: string;
  summary_vector?: number[];
};

export type SummarySearchResult = {
  row: SummaryRow;
  score: number;
};

export type SummaryInsertRow = Omit<SummaryRow, "summary_vector"> & { summary_vector?: number[] };

type MergeResultLike = {
  num_inserted_rows?: number;
  numInsertedRows?: number;
};

export type StateRow = {
  session_key: string;
  session_id: string;
  session_file: string;
  session_file_size_bytes: number;
  session_file_mtime_ms: number;
  written_at_ms: number;
};

export type Skill = {
  name: string;
  location: string;
  keyworkds: string[];
  desc: string;
  desc_vector: number[];
};

export type SkillInsertRow = Omit<Skill, "desc_vector"> & { desc_vector?: number[] };

export type SkillSearchResult = {
  row: Skill;
  distance?: number;
};

const MESSAGE_TABLE_NAME = "context_messages";
const SUMMARY_TABLE_NAME = "context_summaries";
const STATE_TABLE_NAME = "context_state";
const SKILLS_TABLE_NAME = "skills";

let lancedbImportPromise: Promise<typeof import("@lancedb/lancedb")> | null = null;
export const execFileAsync = promisify(execFile);

export async function loadLanceDb(): Promise<typeof import("@lancedb/lancedb")> {
  if (!lancedbImportPromise) {
    lancedbImportPromise = import("@lancedb/lancedb");
  }
  try {
    return await lancedbImportPromise;
  } catch (err) {
    throw new Error(`lancedb: failed to load LanceDB. ${String(err)}`, { cause: err });
  }
}

export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function stableHash(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 24);
}

function getMessageTimestampMs(message: AgentMessage): number {
  return typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
    ? Math.floor(message.timestamp)
    : Date.now();
}

function getMessageContent(message: AgentMessage): unknown {
  return "content" in message ? message.content : undefined;
}

function serializeMessageContent(content: unknown): string {
  try {
    return JSON.stringify(content);
  } catch {
    return "null";
  }
}

function messageTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const blockValue = block as Record<string, unknown>;
    if (typeof blockValue.text === "string" && blockValue.text.trim().length > 0) {
      parts.push(blockValue.text.trim());
      continue;
    }
    parts.push(JSON.stringify(blockValue));
  }
  return parts.join("\n");
}

export function createRetryOptions(config: ContextLanceDbConfig, label: string): RetryOptions {
  return {
    label,
    attempts: config.retry.attempts,
    minDelayMs: config.retry.minDelayMs,
    maxDelayMs: config.retry.maxDelayMs,
    jitter: config.retry.jitter,
  };
}

export function parseRegisteredSkillsPayload(payload: unknown): {
  skills: Array<Record<string, unknown>>;
  workspaceDir?: string;
  managedSkillsDir?: string;
} | null {
  const normalizeSkills = (value: unknown): Array<Record<string, unknown>> | null => {
    if (!Array.isArray(value)) {
      return null;
    }
    return value.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
    );
  };

  if (Array.isArray(payload)) {
    return {
      skills: normalizeSkills(payload) ?? [],
    };
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const payloadValue = payload as Record<string, unknown>;
  const skills = normalizeSkills(payloadValue.skills);
  if (!skills) {
    return null;
  }

  const workspaceDir =
    typeof payloadValue.workspaceDir === "string" && payloadValue.workspaceDir.trim().length > 0
      ? payloadValue.workspaceDir.trim()
      : undefined;
  const managedSkillsDir =
    typeof payloadValue.managedSkillsDir === "string" &&
    payloadValue.managedSkillsDir.trim().length > 0
      ? payloadValue.managedSkillsDir.trim()
      : undefined;

  return {
    skills,
    workspaceDir,
    managedSkillsDir,
  };
}

function createMessageTableSchema(): Schema {
  return new Schema([
    new Field("message_pk", new Utf8(), false),
    new Field("session_key", new Utf8(), false),
    new Field("session_id", new Utf8(), false),
    new Field("ordinal", new Int32(), false),
    new Field("role", new Utf8(), false),
    new Field("content_text", new Utf8(), false),
    new Field("content_json", new Utf8(), false),
    new Field("message_timestamp_ms", new Float64(), false),
    new Field("written_at_ms", new Float64(), false),
    new Field("source", new Utf8(), false),
  ]);
}

function createSummaryTableSchema(vectorDimension?: number): Schema {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: Field<any>[] = [
    new Field("summary_id", new Utf8(), false),
    new Field("session_key", new Utf8(), false),
    new Field("session_id", new Utf8(), false),
    new Field("summary_text", new Utf8(), false),
    new Field("compacted_at_ms", new Float64(), false),
    new Field("written_at_ms", new Float64(), false),
    new Field("first_kept_entry_id", new Utf8(), false),
    new Field("covered_until_ordinal", new Int32(), false),
    new Field("tokens_before", new Int32(), false),
    new Field("tokens_after", new Int32(), false),
    new Field("source", new Utf8(), false),
  ];
  if (vectorDimension && vectorDimension > 0) {
    fields.push(
      new Field(
        "summary_vector",
        new FixedSizeList(vectorDimension, new Field("item", new Float32(), true)),
        true,
      ),
    );
  }
  return new Schema(fields);
}

function createStateTableSchema(): Schema {
  return new Schema([
    new Field("session_key", new Utf8(), false),
    new Field("session_id", new Utf8(), false),
    new Field("session_file", new Utf8(), false),
    new Field("session_file_size_bytes", new Float64(), false),
    new Field("session_file_mtime_ms", new Float64(), false),
    new Field("written_at_ms", new Float64(), false),
  ]);
}

function createSkillsTableSchema(vectorDimension?: number): Schema {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fields: Field<any>[] = [
    new Field("name", new Utf8(), false),
    new Field("location", new Utf8(), false),
    new Field("keyworkds", new List(new Field("item", new Utf8(), true)), false),
    new Field("desc", new Utf8(), false),
  ];
  if (vectorDimension && vectorDimension > 0) {
    fields.push(
      new Field(
        "desc_vector",
        new FixedSizeList(vectorDimension, new Field("item", new Float32(), true)),
        false,
      ),
    );
  } else {
    fields.push(new Field("desc_vector", new List(new Field("item", new Float32(), true)), false));
  }
  return new Schema(fields);
}

export function createMessageRow(params: {
  sessionKey: string;
  sessionId: string;
  ordinal: number;
  message: AgentMessage;
  source: "bootstrap" | "after_turn";
}): MessageRow {
  return {
    message_pk: `${params.sessionId}:${params.ordinal}`,
    session_key: params.sessionKey,
    session_id: params.sessionId,
    ordinal: params.ordinal,
    role: typeof params.message.role === "string" ? params.message.role : "unknown",
    content_text: messageTextFromContent(getMessageContent(params.message)),
    content_json: serializeMessageContent(getMessageContent(params.message)),
    message_timestamp_ms: getMessageTimestampMs(params.message),
    written_at_ms: Date.now(),
    source: params.source,
  };
}

export function createSkillRow(params: {
  name: string;
  location?: string;
  keyworkds?: string[];
  desc: string;
  descVector?: number[];
}): SkillInsertRow {
  return {
    name: params.name,
    location: params.location ?? "",
    keyworkds: params.keyworkds ?? [],
    desc: params.desc,
    ...(params.descVector ? { desc_vector: params.descVector } : {}),
  };
}

export function createSummaryId(params: {
  sessionId: string;
  firstKeptEntryId?: string;
  summaryText: string;
}): string {
  return stableHash([params.sessionId, params.firstKeptEntryId ?? "", params.summaryText]);
}

export class StoreCore {
  connection: LanceDB.Connection | null = null;
  messageTable: LanceDB.Table | null = null;
  summaryTable: LanceDB.Table | null = null;
  stateTable: LanceDB.Table | null = null;
  skillsTable: LanceDB.Table | null = null;
  indexesEnsured = false;

  constructor(
    readonly config: ContextLanceDbConfig,
    readonly embeddingClient: ContextEmbeddingClient | null,
    readonly logger: StoreLogger,
  ) {}

  async getConnection(): Promise<LanceDB.Connection> {
    if (this.connection?.isOpen()) {
      return this.connection;
    }
    const connection = await retryAsync(
      async () => {
        const lancedb = await loadLanceDb();
        return lancedb.connect(this.config.dbPath);
      },
      createRetryOptions(this.config, "context-lancedb-connect"),
    );
    this.connection = connection;
    return connection;
  }

  private async openOrCreateTable(
    connection: LanceDB.Connection,
    existingTableNames: Set<string>,
    tableName: string,
    schema: Schema,
  ): Promise<LanceDB.Table> {
    if (existingTableNames.has(tableName)) {
      return await connection.openTable(tableName);
    }
    const table = await connection.createEmptyTable(tableName, schema);
    existingTableNames.add(tableName);
    return table;
  }

  async initializeTables(): Promise<void> {
    await retryAsync(
      () => this.doInitializeTables(),
      createRetryOptions(this.config, "context-lancedb-initialize-tables"),
    );
  }

  private async doInitializeTables(): Promise<void> {
    if (!this.config.retrievalEnabled && !this.config.skillSearchEnabled) {
      return;
    }
    const connection = await this.getConnection();
    const existingTableNames = new Set(await connection.tableNames());

    if (this.config.retrievalEnabled) {
      this.messageTable = await this.openOrCreateTable(
        connection,
        existingTableNames,
        MESSAGE_TABLE_NAME,
        createMessageTableSchema(),
      );
      const summaryVectorDimension = this.embeddingClient
        ? this.config.embedding?.dimensions
        : undefined;
      this.summaryTable = await this.openOrCreateTable(
        connection,
        existingTableNames,
        SUMMARY_TABLE_NAME,
        createSummaryTableSchema(summaryVectorDimension),
      );
      this.stateTable = await this.openOrCreateTable(
        connection,
        existingTableNames,
        STATE_TABLE_NAME,
        createStateTableSchema(),
      );
    }

    if (this.config.skillSearchEnabled) {
      const skillsVectorDimension = this.embeddingClient
        ? this.config.embedding?.dimensions
        : undefined;
      this.skillsTable = await this.openOrCreateTable(
        connection,
        existingTableNames,
        SKILLS_TABLE_NAME,
        createSkillsTableSchema(skillsVectorDimension),
      );
    }
  }

  getMessageTable(): LanceDB.Table {
    if (!this.messageTable) {
      throw new Error("context-lancedb: message table is not initialized");
    }
    return this.messageTable;
  }

  getSummaryTable(): LanceDB.Table {
    if (!this.summaryTable) {
      throw new Error("context-lancedb: summary table is not initialized");
    }
    return this.summaryTable;
  }

  getStateTable(): LanceDB.Table {
    if (!this.stateTable) {
      throw new Error("context-lancedb: state table is not initialized");
    }
    return this.stateTable;
  }

  getSkillsTable(): LanceDB.Table {
    if (!this.skillsTable) {
      throw new Error("context-lancedb: skills table is not initialized");
    }
    return this.skillsTable;
  }

  async mergeInsertRows<T extends Record<string, unknown>>(params: {
    table: LanceDB.Table;
    rows: T[];
    on: string | string[];
    label: string;
    updateWhenMatched?: boolean;
  }): Promise<number> {
    if (params.rows.length === 0) {
      return 0;
    }
    const result = (await retryAsync(
      () => {
        const mergeBuilder = params.table.mergeInsert(params.on);
        if (params.updateWhenMatched) {
          mergeBuilder.whenMatchedUpdateAll();
        }
        return mergeBuilder.whenNotMatchedInsertAll().execute(params.rows);
      },
      createRetryOptions(this.config, params.label),
    )) as MergeResultLike;
    const insertedRows =
      typeof result.numInsertedRows === "number" && Number.isFinite(result.numInsertedRows)
        ? result.numInsertedRows
        : result.num_inserted_rows;
    return typeof insertedRows === "number" && Number.isFinite(insertedRows)
      ? Math.max(0, Math.floor(insertedRows))
      : 0;
  }
}
