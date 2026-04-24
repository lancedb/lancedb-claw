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

import type { ContextLanceDbConfig } from "./config.js";
import { RetrievalStoreModule } from "./store/retrieval.js";
import {
  SkillSearchStoreModule,
  type NormalizedSnapshotSkill,
  type SkillSyncPayload,
} from "./store/skill-search.js";
import {
  StoreCore,
  createMessageRow,
  createSkillRow,
  createSummaryId,
  type ContextEmbeddingClient,
  type MessageRow,
  type Skill,
  type SkillInsertRow,
  type SkillSearchResult,
  type StateRow,
  type StoreLogger,
  type SummaryInsertRow,
  type SummaryRow,
  type SummarySearchResult,
} from "./store/helper.js";

export {
  createMessageRow,
  createSkillRow,
  createSummaryId,
};

export type {
  ContextEmbeddingClient,
  MessageRow,
  NormalizedSnapshotSkill,
  Skill,
  SkillInsertRow,
  SkillSearchResult,
  SkillSyncPayload,
  StateRow,
  SummaryInsertRow,
  SummaryRow,
  SummarySearchResult,
};

export class ContextLanceDbStore {
  private readonly core: StoreCore;
  private retrievalStore: RetrievalStoreModule | null = null;
  private skillSearchStore: SkillSearchStoreModule | null = null;

  constructor(
    private readonly config: ContextLanceDbConfig,
    embeddingClient: ContextEmbeddingClient | null,
    logger: StoreLogger,
  ) {
    this.core = new StoreCore(config, embeddingClient, logger);
  }

  private getRetrievalStore(): RetrievalStoreModule {
    if (!this.config.retrievalEnabled) {
      throw new Error("context-lancedb: retrieval store is disabled");
    }
    if (!this.retrievalStore) {
      this.retrievalStore = new RetrievalStoreModule(this.config, this.core);
    }
    return this.retrievalStore;
  }

  private getSkillSearchStore(): SkillSearchStoreModule {
    if (!this.config.skillSearchEnabled) {
      throw new Error("context-lancedb: skill search store is disabled");
    }
    if (!this.skillSearchStore) {
      this.skillSearchStore = new SkillSearchStoreModule(this.config, this.core);
    }
    return this.skillSearchStore;
  }

  async initialize(): Promise<void> {
    await this.core.initializeTables();
  }

  async ensureIndexes(): Promise<void> {
    return this.getRetrievalStore().ensureIndexes();
  }

  async getMaxOrdinal(sessionId: string): Promise<number> {
    return this.getRetrievalStore().getMaxOrdinal(sessionId);
  }

  async getStateBySessionFile(sessionFile: string): Promise<StateRow | null> {
    return this.getRetrievalStore().getStateBySessionFile(sessionFile);
  }

  async addMessages(rows: MessageRow[]): Promise<number> {
    return this.getRetrievalStore().addMessages(rows);
  }

  async addSummaries(rows: SummaryInsertRow[]): Promise<number> {
    return this.getRetrievalStore().addSummaries(rows);
  }

  async addSummary(row: SummaryInsertRow): Promise<boolean> {
    return this.getRetrievalStore().addSummary(row);
  }

  async upsertState(row: StateRow): Promise<boolean> {
    return this.getRetrievalStore().upsertState(row);
  }

  async upsertSkills(rows: SkillInsertRow[]): Promise<number> {
    return this.getSkillSearchStore().upsertSkills(rows);
  }

  async upsertSkill(row: SkillInsertRow): Promise<boolean> {
    return this.getSkillSearchStore().upsertSkill(row);
  }

  async getSkill(name: string): Promise<Skill | null> {
    return this.getSkillSearchStore().getSkill(name);
  }

  async listSkills(limit: number): Promise<Skill[]> {
    return this.getSkillSearchStore().listSkills(limit);
  }

  async searchSkills(params: { queryText: string; limit: number }): Promise<SkillSearchResult[]> {
    return this.getSkillSearchStore().searchSkills(params);
  }

  buildSkillSyncPayload(snapshot: unknown): SkillSyncPayload {
    return this.getSkillSearchStore().buildSkillSyncPayload(snapshot);
  }

  async syncSkillsFromSnapshot(payload: SkillSyncPayload): Promise<number> {
    return this.getSkillSearchStore().syncSkillsFromSnapshot(payload);
  }

  async cleanupSkillsTableIfNeeded(): Promise<boolean> {
    return this.getSkillSearchStore().cleanupSkillsTableIfNeeded();
  }

  async searchSummaries(params: {
    sessionKey: string;
    queryText: string;
    limit: number;
  }): Promise<SummarySearchResult[]> {
    return this.getRetrievalStore().searchSummaries(params);
  }

  async listRecentSummaries(sessionKey: string, limit: number): Promise<SummaryRow[]> {
    return this.getRetrievalStore().listRecentSummaries(sessionKey, limit);
  }

  async fetchDetailMessages(params: {
    sessionKey: string;
    sessionId: string;
    coveredUntilOrdinal: number;
    limit: number;
  }): Promise<MessageRow[]> {
    return this.getRetrievalStore().fetchDetailMessages(params);
  }

  async dispose(): Promise<void> {
  }
}
