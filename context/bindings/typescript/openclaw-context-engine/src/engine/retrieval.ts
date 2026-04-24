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

import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { PluginLogger } from "openclaw/plugin-sdk";
import type { ContextLanceDbConfig } from "../config.js";
import { createMessageRow, createSummaryId, type ContextLanceDbStore } from "../store.js";
import type {
  ContextEngineAfterTurnParams,
  ContextEngineAssembleResult,
  ContextEngineAssembleParams,
  ContextEngineBootstrapResult,
  ContextEngineBootstrapParams,
  ContextEngineCompactResult,
  ContextEngineCompactParams,
  ContextEngineIngestBatchParams,
  ContextEngineIngestBatchResult,
  ContextEngineIngestParams,
  ContextEngineIngestResult,
} from "../types.js";
import {
  buildTranscriptImport,
  estimateMessageTokens,
  estimateTextTokens,
  extractSearchQuery,
  formatRetrievedContext,
  readSessionFileStat,
  resolveStableSessionKey,
  selectMessageTail,
  trimRetrievedContext,
  type TranscriptEntry,
  updateStateCheckpoint,
  type SummaryCandidate,
} from "./helper.js";

export class RetrievalEngineModule {
  constructor(
    private readonly config: ContextLanceDbConfig,
    private readonly deps: {
      logger: PluginLogger;
      store: ContextLanceDbStore;
      legacyCompact: (params: ContextEngineCompactParams) => Promise<ContextEngineCompactResult>;
    },
  ) {}

  isEnabled(): boolean {
    return this.config.retrievalEnabled;
  }

  async bootstrap(params: ContextEngineBootstrapParams): Promise<ContextEngineBootstrapResult> {
    try {
      const stat = await readSessionFileStat(params.sessionFile);
      const latestState = stat ? await this.deps.store.getStateBySessionFile(params.sessionFile) : null;
      if (
        stat &&
        latestState &&
        latestState.session_file_size_bytes === stat.size &&
        latestState.session_file_mtime_ms === stat.mtimeMs
      ) {
        return {
          bootstrapped: true,
          importedMessages: 0,
          reason: "state-checkpoint-fresh",
        };
      }
      const stableSessionKey = resolveStableSessionKey(params.sessionKey, params.sessionId);
      const sessionManager = SessionManager.open(params.sessionFile);
      const entries = sessionManager.getEntries() as TranscriptEntry[];
      const imported = buildTranscriptImport(entries, params.sessionId, stableSessionKey);

      const importedMessages = await this.deps.store.addMessages(imported.messageRows);
      const importedSummaries = await this.deps.store.addSummaries(imported.summaryRows);
      await updateStateCheckpoint({
        store: this.deps.store,
        sessionId: params.sessionId,
        sessionKey: stableSessionKey,
        sessionFile: params.sessionFile,
      });

      return {
        bootstrapped: true,
        importedMessages,
        ...(importedMessages === 0 && importedSummaries === 0 ? { reason: "no-missing-data" } : {}),
      };
    } catch (err) {
      this.deps.logger.warn(
        `context-lancedb: bootstrap failed (${err instanceof Error ? err.message : String(err)})`,
      );
      return {
        bootstrapped: false,
        reason: "bootstrap-failed",
      };
    }
  }

  async assemble(params: ContextEngineAssembleParams): Promise<ContextEngineAssembleResult> {
    try {
      const stableSessionKey = resolveStableSessionKey(params.sessionKey, params.sessionId);
      const queryText = extractSearchQuery(params);
      const searchResults = await this.deps.store.searchSummaries({
        sessionKey: stableSessionKey,
        queryText,
        limit: this.config.summaryRecallLimit,
      });
      const recentSummaries = await this.deps.store.listRecentSummaries(
        stableSessionKey,
        this.config.recentSummaryCount,
      );

      const merged = new Map<string, SummaryCandidate>();
      for (const result of searchResults) {
        merged.set(result.row.summary_id, {
          summary_id: result.row.summary_id,
          session_id: result.row.session_id,
          summary_text: result.row.summary_text,
          compacted_at_ms: result.row.compacted_at_ms,
          first_kept_entry_id: result.row.first_kept_entry_id,
          covered_until_ordinal: result.row.covered_until_ordinal,
          score: result.score,
        });
      }
      for (const result of recentSummaries) {
        if (!merged.has(result.summary_id)) {
          merged.set(result.summary_id, {
            summary_id: result.summary_id,
            session_id: result.session_id,
            summary_text: result.summary_text,
            compacted_at_ms: result.compacted_at_ms,
            first_kept_entry_id: result.first_kept_entry_id,
            covered_until_ordinal: result.covered_until_ordinal,
            score: 0,
          });
        }
      }

      const summaryCandidates = [...merged.values()]
        .sort(
          (left, right) => right.score - left.score || right.compacted_at_ms - left.compacted_at_ms,
        )
        .slice(0, this.config.summaryRecallLimit + this.config.recentSummaryCount);

      const detailLines: string[] = [];
      for (const summary of summaryCandidates) {
        const detailMessages = await this.deps.store.fetchDetailMessages({
          sessionKey: stableSessionKey,
          sessionId: summary.session_id,
          coveredUntilOrdinal: summary.covered_until_ordinal,
          limit: this.config.detailMessagesPerSummary,
        });
        for (const detail of detailMessages) {
          const line = `[${detail.role}] ${detail.content_text}`.trim();
          if (line.length > 0) {
            detailLines.push(line);
          }
        }
      }

      const retrievalBudget =
        typeof params.tokenBudget === "number" && Number.isFinite(params.tokenBudget)
          ? Math.max(0, Math.min(Math.floor(params.tokenBudget), this.config.retrievalTokenReserve))
          : this.config.retrievalTokenReserve;
      const trimmedRetrieved = trimRetrievedContext({
        summaries: summaryCandidates,
        detailLines,
        tokenLimit: retrievalBudget,
      });
      const systemPromptAddition = formatRetrievedContext(trimmedRetrieved);

      const retrievedTokens = systemPromptAddition ? estimateTextTokens(systemPromptAddition) : 0;
      const rawBudget =
        typeof params.tokenBudget === "number" && Number.isFinite(params.tokenBudget)
          ? Math.max(0, Math.floor(params.tokenBudget) - retrievedTokens)
          : undefined;
      const selectedMessages = selectMessageTail({
        messages: params.messages,
        freshTailCount: this.config.freshTailCount,
        rawBudget,
      });
      return {
        messages: selectedMessages,
        estimatedTokens: estimateMessageTokens(selectedMessages) + retrievedTokens,
        ...(systemPromptAddition ? { systemPromptAddition } : {}),
      };
    } catch (err) {
      this.deps.logger.warn(
        `context-lancedb: assemble fallback (${err instanceof Error ? err.message : String(err)})`,
      );
      const selectedMessages = selectMessageTail({
        messages: params.messages,
        freshTailCount: this.config.freshTailCount,
        rawBudget: params.tokenBudget,
      });
      return {
        messages: selectedMessages,
        estimatedTokens: estimateMessageTokens(selectedMessages),
      };
    }
  }

  async ingest(params: ContextEngineIngestParams): Promise<ContextEngineIngestResult> {
    if (params.isHeartbeat) {
      return { ingested: false };
    }
    const stableSessionKey = resolveStableSessionKey(params.sessionKey, params.sessionId);
    const ordinal = (await this.deps.store.getMaxOrdinal(params.sessionId)) + 1;
    const inserted = await this.deps.store.addMessages([
      createMessageRow({
        sessionKey: stableSessionKey,
        sessionId: params.sessionId,
        ordinal,
        message: params.message,
        source: "after_turn",
      }),
    ]);
    return { ingested: inserted > 0 };
  }

  async ingestBatch(params: ContextEngineIngestBatchParams): Promise<ContextEngineIngestBatchResult> {
    if (params.isHeartbeat || params.messages.length === 0) {
      return { ingestedCount: 0 };
    }
    const stableSessionKey = resolveStableSessionKey(params.sessionKey, params.sessionId);
    const startOrdinal = (await this.deps.store.getMaxOrdinal(params.sessionId)) + 1;
    const rows = params.messages.map((message, index) =>
      createMessageRow({
        sessionKey: stableSessionKey,
        sessionId: params.sessionId,
        ordinal: startOrdinal + index,
        message,
        source: "after_turn",
      }),
    );
    const inserted = await this.deps.store.addMessages(rows);
    return { ingestedCount: inserted };
  }

  async afterTurn(params: ContextEngineAfterTurnParams): Promise<void> {
    if (params.isHeartbeat) {
      return;
    }
    try {
      const stableSessionKey = resolveStableSessionKey(params.sessionKey, params.sessionId);
      const newMessages = params.messages.slice(params.prePromptMessageCount);
      if (newMessages.length === 0) {
        return;
      }
      const maxOrdinal = await this.deps.store.getMaxOrdinal(params.sessionId);
      const nextExpectedOrdinal = maxOrdinal + 1;
      const alreadyPersistedNew = Math.max(0, nextExpectedOrdinal - params.prePromptMessageCount);
      const missingMessages = newMessages.slice(alreadyPersistedNew);
      const rows = missingMessages.map((message, index) =>
        createMessageRow({
          sessionKey: stableSessionKey,
          sessionId: params.sessionId,
          ordinal: nextExpectedOrdinal + index,
          message,
          source: "after_turn",
        }),
      );
      await this.deps.store.addMessages(rows);
      await updateStateCheckpoint({
        store: this.deps.store,
        sessionId: params.sessionId,
        sessionKey: stableSessionKey,
        sessionFile: params.sessionFile,
      });
    } catch (err) {
      this.deps.logger.warn(
        `context-lancedb: afterTurn persistence failed (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  async compact(params: ContextEngineCompactParams): Promise<ContextEngineCompactResult> {
    const result = await this.deps.legacyCompact(params);
    if (!result.ok || !result.compacted || !result.result?.summary) {
      return result;
    }
    try {
      const stableSessionKey = resolveStableSessionKey(params.sessionKey, params.sessionId);
      const compactedAtMs = Date.now();
      const summaryId = createSummaryId({
        sessionId: params.sessionId,
        firstKeptEntryId: result.result.firstKeptEntryId,
        summaryText: result.result.summary,
      });
      const sessionManager = SessionManager.open(params.sessionFile);
      const entries = sessionManager.getEntries() as TranscriptEntry[];
      const imported = buildTranscriptImport(entries, params.sessionId, stableSessionKey);
      const coveredUntilOrdinal =
        imported.summaryRows.find(
          (row) => row.first_kept_entry_id === (result.result?.firstKeptEntryId ?? ""),
        )?.covered_until_ordinal ?? -1;
      await this.deps.store.addSummary({
        summary_id: summaryId,
        session_key: stableSessionKey,
        session_id: params.sessionId,
        summary_text: result.result.summary,
        compacted_at_ms: compactedAtMs,
        written_at_ms: compactedAtMs,
        first_kept_entry_id: result.result.firstKeptEntryId ?? "",
        covered_until_ordinal: coveredUntilOrdinal,
        tokens_before: result.result.tokensBefore,
        tokens_after:
          typeof result.result.tokensAfter === "number" &&
          Number.isFinite(result.result.tokensAfter)
            ? Math.floor(result.result.tokensAfter)
            : 0,
        source: "compact",
      });
      await updateStateCheckpoint({
        store: this.deps.store,
        sessionId: params.sessionId,
        sessionKey: stableSessionKey,
        sessionFile: params.sessionFile,
      });
    } catch (err) {
      this.deps.logger.warn(
        `context-lancedb: compact summary persistence failed (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    return result;
  }

  warmup(): void {}
}
