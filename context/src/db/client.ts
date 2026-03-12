// SPDX-License-Identifier: Apache-2.0

import type * as LanceDB from "@lancedb/lancedb";
import type { ResolvedContextConfig } from "../types/config.js";
import type { ContextLogger } from "../types/domain.js";
import { ensureContextTables, type ContextTables } from "./ensure.js";

let lanceDbPromise: Promise<typeof import("@lancedb/lancedb")> | null = null;

async function loadLanceDb(): Promise<typeof import("@lancedb/lancedb")> {
  if (!lanceDbPromise) {
    lanceDbPromise = import("@lancedb/lancedb");
  }
  return lanceDbPromise;
}

export class LanceDbClient {
  private module: typeof import("@lancedb/lancedb") | null = null;
  private connection: LanceDB.Connection | null = null;
  private tables: ContextTables | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly config: ResolvedContextConfig,
    private readonly logger: ContextLogger,
  ) {}

  async ensureInitialized(): Promise<void> {
    if (this.tables) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    this.module = await loadLanceDb();
    this.connection = await this.module.connect(this.config.storePath);
    this.tables = await ensureContextTables({
      lancedb: this.module,
      connection: this.connection,
      config: this.config,
      logger: this.logger,
    });
  }

  async getLanceDb(): Promise<typeof import("@lancedb/lancedb")> {
    await this.ensureInitialized();
    return this.module as typeof import("@lancedb/lancedb");
  }

  async getConnection(): Promise<LanceDB.Connection> {
    await this.ensureInitialized();
    return this.connection as LanceDB.Connection;
  }

  async getSessionStateTable(): Promise<LanceDB.Table> {
    await this.ensureInitialized();
    return this.tables!.sessionState;
  }

  async getEntryStoreTable(): Promise<LanceDB.Table> {
    await this.ensureInitialized();
    return this.tables!.entryStore;
  }

  async getPromptViewTable(): Promise<LanceDB.Table> {
    await this.ensureInitialized();
    return this.tables!.promptView;
  }

  async dispose(): Promise<void> {
    if (this.tables) {
      try {
        this.tables.sessionState.close();
        this.tables.entryStore.close();
        this.tables.promptView.close();
      } catch {
        // Best-effort close.
      }
    }
    try {
      this.connection?.close();
    } catch {
      // Best-effort close.
    }
    this.tables = null;
    this.connection = null;
    this.initPromise = null;
  }
}
