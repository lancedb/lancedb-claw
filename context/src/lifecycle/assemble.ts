// SPDX-License-Identifier: Apache-2.0

import type { AssembleResult } from "openclaw/context-engine/types";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ContextServices, DigestEntry, PromptSlot, TurnEntry } from "../types/domain.js";
import type { EntryStoreRow } from "../types/storage.js";
import { buildReplyRecallQuery } from "../codec/query-extractor.js";
import { renderDigestEntry, renderTurnEntry } from "../codec/prompt-renderer.js";
import { filterRecallCandidates } from "../search/recall-filter.js";
import { estimateMessageBatchTokens } from "../utils/token-estimator.js";

function toMessage(entry: EntryStoreRow, source: "history" | "reply_recall"): AgentMessage {
  if (entry.entry_kind === "digest") {
    return renderDigestEntry(entry as DigestEntry, source);
  }
  return renderTurnEntry(entry as TurnEntry);
}

function buildOrderedEntries(
  promptSlots: PromptSlot[],
  entries: EntryStoreRow[],
): Array<{ slot: PromptSlot; entry: EntryStoreRow }> {
  const entryMap = new Map(entries.map((entry) => [entry.entry_id, entry]));
  return promptSlots
    .map((slot) => {
      const entry = entryMap.get(slot.entry_id);
      return entry ? { slot, entry } : null;
    })
    .filter((item): item is { slot: PromptSlot; entry: EntryStoreRow } => item !== null);
}

function sumEntryTokens(entries: EntryStoreRow[]): number {
  return entries.reduce((sum, entry) => sum + Math.max(entry.token_estimate, 1), 0);
}

function pickEntriesWithinBudget(
  entries: EntryStoreRow[],
  budget: number,
): EntryStoreRow[] {
  if (budget <= 0) {
    return [];
  }
  const accepted: EntryStoreRow[] = [];
  let used = 0;
  for (const entry of [...entries].reverse()) {
    const next = used + Math.max(entry.token_estimate, 1);
    if (accepted.length > 0 && next > budget) {
      continue;
    }
    accepted.push(entry);
    used = next;
  }
  return accepted.reverse();
}

function pickRecallEntriesWithinBudget(
  entries: DigestEntry[],
  budget: number,
): DigestEntry[] {
  if (budget <= 0) {
    return [];
  }
  const accepted: DigestEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const next = used + Math.max(entry.token_estimate, 1);
    if (accepted.length > 0 && next > budget) {
      break;
    }
    accepted.push(entry);
    used = next;
  }
  return accepted;
}

export async function assembleContext(
  services: ContextServices,
  params: {
    sessionId: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  },
): Promise<AssembleResult> {
  try {
    const promptSlots = await services.promptViewReader.list(params.sessionId);
    if (promptSlots.length === 0) {
      return {
        messages: params.messages,
        estimatedTokens: estimateMessageBatchTokens(params.messages),
      };
    }

    const baselineEntries = await services.entryStoreReader.listEntriesByIds(
      params.sessionId,
      promptSlots.map((slot) => slot.entry_id),
    );
    const ordered = buildOrderedEntries(promptSlots, baselineEntries);
    if (ordered.length === 0) {
      return {
        messages: params.messages,
        estimatedTokens: estimateMessageBatchTokens(params.messages),
      };
    }

    const firstTailIndex = ordered.findIndex((item) => item.slot.slot_type === "tail");
    const historyEntries =
      firstTailIndex >= 0 ? ordered.slice(0, firstTailIndex).map((item) => item.entry) : ordered.map((item) => item.entry);
    const tailEntries =
      firstTailIndex >= 0 ? ordered.slice(firstTailIndex).map((item) => item.entry) : [];
    const protectedTailRange =
      tailEntries.length > 0
        ? {
            start: tailEntries[0]!.turn_from,
            end: tailEntries[tailEntries.length - 1]!.turn_to,
          }
        : undefined;

    const recallQuery = buildReplyRecallQuery(params.messages);
    let recallEntries: DigestEntry[] = [];
    if (recallQuery && services.config.replyRecallLimit > 0) {
      const recalled = await services.hybridRecall.recall({
        sessionId: params.sessionId,
        query: recallQuery,
        limit: Math.max(services.config.replyRecallLimit * 4, services.config.replyRecallLimit),
      });
      const filtered = filterRecallCandidates({
        candidates: recalled,
        excludedEntryIds: new Set(promptSlots.map((slot) => slot.entry_id)),
        protectedTailRange,
        floorScore: services.config.internal.recallFloorScore,
        limit: services.config.replyRecallLimit,
      }).map((candidate) => candidate.entry);
      recallEntries = filtered;
    }

    let baselineHistoryEntries = historyEntries;
    let injectedRecallEntries = recallEntries;
    if (params.tokenBudget && params.tokenBudget > 0) {
      const tailTokens = sumEntryTokens(tailEntries);
      const recallBudget = Math.min(
        services.config.internal.replyRecallTokenCap,
        Math.max(0, params.tokenBudget - tailTokens),
      );
      injectedRecallEntries = pickRecallEntriesWithinBudget(recallEntries, recallBudget);
      const usedRecallTokens = sumEntryTokens(injectedRecallEntries);
      const historyBudgetAllowance = Math.max(
        0,
        params.tokenBudget - tailTokens - usedRecallTokens,
      );
      baselineHistoryEntries = pickEntriesWithinBudget(historyEntries, historyBudgetAllowance);
    }

    const renderedMessages = [
      ...baselineHistoryEntries.map((entry) => toMessage(entry, "history")),
      ...injectedRecallEntries.map((entry) => renderDigestEntry(entry, "reply_recall")),
      ...tailEntries.map((entry) => toMessage(entry, "history")),
    ];
    return {
      messages: renderedMessages,
      estimatedTokens:
        sumEntryTokens(baselineHistoryEntries) +
        sumEntryTokens(injectedRecallEntries) +
        sumEntryTokens(tailEntries),
    };
  } catch (error) {
    services.logger.warn("assembly fell back to live messages", {
      sessionId: params.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      messages: params.messages,
      estimatedTokens: estimateMessageBatchTokens(params.messages),
    };
  }
}
