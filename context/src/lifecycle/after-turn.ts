// SPDX-License-Identifier: Apache-2.0

import type { ContextServices } from "../types/domain.js";
import { appendTurnMessages } from "./ingest.js";
import { compactContext } from "./compact.js";

function sumTokenEstimates(values: Array<{ token_estimate: number }>): number {
  return values.reduce((sum, value) => sum + Math.max(value.token_estimate, 1), 0);
}

export async function afterTurnContext(
  services: ContextServices,
  params: {
    sessionId: string;
    sessionFile: string;
    messages: Array<import("@mariozechner/pi-agent-core").AgentMessage>;
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    runtimeContext?: Record<string, unknown>;
  },
): Promise<void> {
  const newMessages = params.messages.slice(params.prePromptMessageCount);
  if (newMessages.length === 0) {
    return;
  }

  const appendResult = await appendTurnMessages(services, {
    sessionId: params.sessionId,
    sessionFile: params.sessionFile,
    messages: newMessages,
  });
  if (appendResult.rows.length === 0) {
    return;
  }

  await services.indexMaintainer.syncAfterTurn(
    params.sessionId,
    appendResult.rows.map((row) => row.entry_id),
  );

  if (!params.tokenBudget || params.tokenBudget <= 0) {
    return;
  }

  const promptSlots = await services.promptViewReader.list(params.sessionId);
  const promptEntries = await services.entryStoreReader.listEntriesByIds(
    params.sessionId,
    promptSlots.map((slot) => slot.entry_id),
  );
  const currentTokenCount = sumTokenEstimates(promptEntries);
  if (currentTokenCount < params.tokenBudget * services.config.shrinkStartRatio) {
    return;
  }

  await compactContext(services, {
    sessionId: params.sessionId,
    sessionFile: params.sessionFile,
    tokenBudget: params.tokenBudget,
    currentTokenCount,
    compactionTarget: "threshold",
    customInstructions: params.autoCompactionSummary,
    runtimeContext: params.runtimeContext,
  });
}
