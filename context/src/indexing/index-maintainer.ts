// SPDX-License-Identifier: Apache-2.0

import type { ContextLogger } from "../types/domain.js";
import { getDirtyVectorIds } from "./dirty-state.js";
import { SessionStateReader } from "../reader/session-state-reader.js";
import { SessionStateWriter } from "../writer/session-state-writer.js";
import { EntryStoreReader } from "../reader/entry-store-reader.js";

export class IndexMaintainer {
  constructor(
    private readonly deps: {
      db: { ensureInitialized: () => Promise<void> };
      logger: ContextLogger;
      sessionStateReader: SessionStateReader;
      sessionStateWriter: SessionStateWriter;
      entryStoreReader: EntryStoreReader;
    },
  ) {}

  async ensureBaseIndexes(): Promise<void> {
    await this.deps.db.ensureInitialized();
  }

  async retryDirtyState(sessionId: string): Promise<void> {
    await this.ensureBaseIndexes();
    const row = await this.deps.sessionStateReader.get(sessionId);
    if (!row) {
      return;
    }
    if (row.dirty_text_index) {
      await this.deps.sessionStateWriter.markDirtyText(sessionId, false);
    }
    const dirtyIds = getDirtyVectorIds(row);
    if (dirtyIds.length === 0) {
      return;
    }
    const unresolved: string[] = [];
    for (const entryId of dirtyIds) {
      const entry = await this.deps.entryStoreReader.getById(sessionId, entryId);
      if (!entry || !entry.vector_blob || entry.vector_size <= 0) {
        unresolved.push(entryId);
      }
    }
    const cleared = dirtyIds.filter((entryId) => !unresolved.includes(entryId));
    if (cleared.length > 0) {
      await this.deps.sessionStateWriter.clearDirtyVectorIds(sessionId, cleared);
    }
  }

  async syncAfterTurn(sessionId: string, _newTurnIds: string[]): Promise<void> {
    await this.ensureBaseIndexes();
    await this.retryDirtyState(sessionId);
  }

  async syncAfterShrink(sessionId: string, newDigestId: string): Promise<void> {
    await this.ensureBaseIndexes();
    const entry = await this.deps.entryStoreReader.getById(sessionId, newDigestId);
    if (entry?.vector_blob && entry.vector_size > 0) {
      await this.deps.sessionStateWriter.clearDirtyVectorIds(sessionId, [newDigestId]);
    }
    await this.deps.sessionStateWriter.markDirtyText(sessionId, false);
  }
}
