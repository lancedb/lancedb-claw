// SPDX-License-Identifier: Apache-2.0

declare module "@lancedb/lancedb" {
  export type QueryLike = {
    where: (clause: string) => QueryLike;
    limit: (count: number) => QueryLike;
    toArray: () => Promise<Array<Record<string, unknown>>>;
  };

  export type MergeInsertBuilder = {
    whenMatchedUpdateAll: () => MergeInsertBuilder;
    whenNotMatchedInsertAll: () => MergeInsertBuilder;
    execute: (rows: Array<Record<string, unknown>>) => Promise<void>;
  };

  export type Table = {
    add: (rows: Array<Record<string, unknown>>) => Promise<void>;
    delete: (where: string) => Promise<void>;
    update: (params: { where: string; values: Record<string, unknown> }) => Promise<void>;
    countRows: (where?: string) => Promise<number>;
    query: () => QueryLike;
    search: (query: string, indexType?: string) => QueryLike;
    vectorSearch: (vector: number[]) => QueryLike;
    mergeInsert: (key: string) => MergeInsertBuilder;
    createIndex: (column: string, options?: Record<string, unknown>) => Promise<void>;
    close: () => void;
  };

  export type Connection = {
    tableNames: () => Promise<string[]>;
    openTable: (name: string) => Promise<Table>;
    createTable: (name: string, rows: Array<Record<string, unknown>>) => Promise<Table>;
    close: () => void;
  };

  export const Index: {
    fts: () => Record<string, unknown>;
  };

  export function connect(path: string): Promise<Connection>;
}
