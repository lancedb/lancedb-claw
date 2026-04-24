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

import { inspect } from "node:util";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { PluginLogger } from "openclaw/plugin-sdk";
import type { ContextLanceDbConfig } from "../config.js";
import { type ContextLanceDbStore, type SkillSearchResult } from "../store.js";
import type {
  ContextEngineAfterTurnParams,
  ContextEngineAssembleParams,
  ContextEngineAssembleResult,
  ContextEngineBootstrapParams,
  ContextEngineBootstrapResult,
} from "../types.js";
import {
  estimateTextTokens,
  extractRecentSkillSearchQueries,
  filterDynamicSkillResultsByDistance,
  formatDynamicSkillDiscovery,
  mergeSkillSearchResults,
} from "./helper.js";

type SessionStoreEntryLike = {
  skillsSnapshot?: unknown;
};

type SessionStoreLike = Record<string, unknown>;

export type SkillSyncState = {
  initialized: boolean;
  lastSnapshotHash?: string;
};

const MAX_SKILL_SEARCH_QUERY_CHARS = 150;

export class SkillSearchEngineModule {
  private readonly skillSearchCache = new Map<string, SkillSearchResult>();
  private readonly skillSyncState: SkillSyncState = {
    initialized: false,
  };

  constructor(
    private readonly config: ContextLanceDbConfig,
    private readonly deps: {
      logger: PluginLogger;
      store: ContextLanceDbStore;
      loadSessionStore?: (storePath: string) => SessionStoreLike;
    },
  ) {}

  warmup(): void {}

  isEnabled(): boolean {
    return this.config.skillSearchEnabled;
  }

  private readSkillsSnapshot(params: {
    sessionFile: ContextEngineBootstrapParams["sessionFile"];
    sessionKey?: ContextEngineBootstrapParams["sessionKey"];
  }): unknown {
    const sessionKey = params.sessionKey?.trim();
    if (!sessionKey || !this.deps.loadSessionStore) {
      return undefined;
    }
    const storePath = path.join(path.dirname(params.sessionFile), "sessions.json");
    const store = this.deps.loadSessionStore(storePath);
    const entry =
      store[sessionKey] ??
      store[sessionKey.toLowerCase()] ??
      Object.entries(store).find(([key]) => key.toLowerCase() === sessionKey.toLowerCase())?.[1];
    return (entry as SessionStoreEntryLike | undefined)?.skillsSnapshot;
  }

  private getSkillSearchDistanceThreshold(): number {
    return Math.max(0, this.config.skillSearchMaxDistance);
  }

  private updateSkillSearchCache(results: SkillSearchResult[]): void {
    for (const result of results) {
      const name = result.row.name.trim();
      if (!name) {
        continue;
      }
      if (this.skillSearchCache.has(name)) {
        this.skillSearchCache.delete(name);
      }
      this.skillSearchCache.set(name, result);
      while (this.skillSearchCache.size > this.config.skillSearchCacheSize) {
        const oldestKey = this.skillSearchCache.keys().next().value;
        if (!oldestKey) {
          break;
        }
        this.skillSearchCache.delete(oldestKey);
      }
    }
  }

  private getCachedSkillSearchResults(): SkillSearchResult[] {
    return Array.from(this.skillSearchCache.values()).reverse();
  }

  private resetSkillSyncState(): void {
    this.skillSyncState.initialized = false;
    delete this.skillSyncState.lastSnapshotHash;
  }

  async bootstrap(params: ContextEngineBootstrapParams): Promise<ContextEngineBootstrapResult> {
    try {
      const snapshot = this.readSkillsSnapshot(params);
      if (!snapshot) {
        return {
          bootstrapped: true,
          reason: "skill-snapshot-missing",
        };
      }
      const payload = this.deps.store.buildSkillSyncPayload(snapshot);
      if (
        this.skillSyncState.initialized &&
        payload.snapshotHash === this.skillSyncState.lastSnapshotHash
      ) {
        return {
          bootstrapped: true,
          reason: "skill-snapshot-unchanged",
        };
      }

      const syncedCount = await this.deps.store.syncSkillsFromSnapshot(payload);
      if (syncedCount < payload.rows.length) {
        this.resetSkillSyncState();
        this.deps.logger.warn(
          `context-lancedb: skill sync bootstrap incomplete (${syncedCount}/${payload.rows.length}); snapshot will be retried`,
        );
        return {
          bootstrapped: true,
          reason: "skill-sync-failed",
        };
      }

      this.skillSearchCache.clear();
      this.skillSyncState.initialized = true;
      this.skillSyncState.lastSnapshotHash = payload.snapshotHash;
      return {
        bootstrapped: true,
        reason: payload.rows.length > 0 ? "skill-sync-complete" : "skill-sync-empty",
      };
    } catch (err) {
      this.resetSkillSyncState();
      this.deps.logger.warn(
        `context-lancedb: skill sync bootstrap skipped (${err instanceof Error ? err.message : String(err)})`,
      );
      return {
        bootstrapped: true,
        reason: "skill-sync-failed",
      };
    }
  }

  async assemble(params: {
    sessionId: ContextEngineAssembleParams["sessionId"];
    sessionKey?: ContextEngineAssembleParams["sessionKey"];
    messages: AgentMessage[];
    tokenBudget?: ContextEngineAssembleParams["tokenBudget"];
    prompt?: ContextEngineAssembleParams["prompt"];
    baseResult: ContextEngineAssembleResult;
  }): Promise<ContextEngineAssembleResult> {
    void params.sessionId;
    void params.sessionKey;
    void params.tokenBudget;
    try {
      const queryTexts = extractRecentSkillSearchQueries(
        params.messages,
        this.config.skillSearchRecentMessageCount,
        params.prompt,
      ).filter((queryText) => queryText.trim().length > 0 && queryText.trim().length <= MAX_SKILL_SEARCH_QUERY_CHARS);
      if (queryTexts.length > 0) {
        const searchResults = await Promise.all(
          queryTexts.map((queryText) =>
            this.deps.store.searchSkills({
              queryText,
              limit: Math.max(
                this.config.skillSearchCandidateLimit,
                this.config.skillSearchMinResults,
              ),
            }),
          ),
        );
        const mergedResults = mergeSkillSearchResults(searchResults.flat());
        const selectedResults = filterDynamicSkillResultsByDistance(
          mergedResults,
          this.getSkillSearchDistanceThreshold(),
        );
        this.updateSkillSearchCache(selectedResults);
      }
      const dynamicSkillDiscovery = formatDynamicSkillDiscovery(this.getCachedSkillSearchResults());
      if (!dynamicSkillDiscovery) {
        return params.baseResult;
      }
      const systemPromptAddition = params.baseResult.systemPromptAddition
        ? `${params.baseResult.systemPromptAddition}\n\n${dynamicSkillDiscovery}`
        : dynamicSkillDiscovery;
      return {
        ...params.baseResult,
        systemPromptAddition,
        estimatedTokens: params.baseResult.estimatedTokens + estimateTextTokens(dynamicSkillDiscovery),
      };
    } catch (err) {
      this.deps.logger.warn(
        `context-lancedb: skill search assemble fallback (${err instanceof Error ? err.message : String(err)})`,
      );
      return params.baseResult;
    }
  }

  async afterTurn(params: ContextEngineAfterTurnParams): Promise<void> {
    void params;
  }
}
