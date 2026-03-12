// SPDX-License-Identifier: Apache-2.0

import { makeDigestEntryId } from "../helpers/ids.js";
import { estimateTextTokens } from "../utils/token-estimator.js";
import type { ContextLogger, DigestBuildResult } from "../types/domain.js";
import type { ResolvedContextConfig } from "../types/config.js";
import type { EntryStoreRow } from "../types/storage.js";
import { nowIso } from "../helpers/clock.js";
import { stringifyJson } from "../utils/json.js";
import { buildDigestPrompt } from "./digest-prompts.js";
import { buildFallbackDigest } from "./digest-fallback.js";
import { resolveDigestModel } from "./digest-auth-resolver.js";
import { generateDigestText } from "./completion-adapter.js";

export class DigestBuilder {
  constructor(
    private readonly deps: {
      config: ResolvedContextConfig;
      logger: ContextLogger;
      runtimeBridge: {
        readDefaultModelRef: () => string;
        readProviderApi: (provider: string) => string | undefined;
        resolveApiKeyForModel: (provider: string, model: string) => Promise<string | undefined>;
      };
    },
  ) {}

  async buildDigest(params: {
    sessionId: string;
    sourceEntries: EntryStoreRow[];
    customInstructions?: string;
  }): Promise<DigestBuildResult> {
    const highestLayer = params.sourceEntries.reduce((max, entry) => Math.max(max, entry.layer_no), 0);
    const nextLayer = highestLayer + 1;
    const prompt = buildDigestPrompt({
      sourceEntries: params.sourceEntries,
      nextLayer,
      customInstructions: params.customInstructions,
    });
    const resolution = await resolveDigestModel({
      config: this.deps.config,
      runtimeBridge: this.deps.runtimeBridge,
    });

    let digestText = "";
    let source: "model" | "fallback" = "fallback";
    if (resolution) {
      try {
        digestText = await generateDigestText({
          resolution,
          systemPrompt: prompt.systemPrompt,
          userPrompt: prompt.userPrompt,
          maxTokens: this.deps.config.internal.digestOutputMaxTokens,
        });
        source = "model";
      } catch (error) {
        this.deps.logger.warn("digest generation fell back to rules", {
          error: error instanceof Error ? error.message : String(error),
          provider: resolution.provider,
          model: resolution.model,
        });
      }
    }

    if (!digestText.trim()) {
      digestText = buildFallbackDigest(params.sourceEntries);
    }

    const turnFrom = Math.min(...params.sourceEntries.map((entry) => entry.turn_from));
    const turnTo = Math.max(...params.sourceEntries.map((entry) => entry.turn_to));
    const originEntryIds = params.sourceEntries.map((entry) => entry.entry_id);
    const tokenEstimate = estimateTextTokens(digestText);
    const coveredTokenEstimate = params.sourceEntries.reduce(
      (sum, entry) => sum + Math.max(entry.covered_token_estimate, entry.token_estimate),
      0,
    );
    const timestamp = nowIso();

    return {
      resolution: source === "model" ? resolution ?? undefined : undefined,
      draft: {
        entryId: makeDigestEntryId({
          sessionId: params.sessionId,
          layerNo: nextLayer,
          turnFrom,
          turnTo,
          originEntryIds,
          plainText: digestText,
        }),
        turnFrom,
        turnTo,
        layerNo: nextLayer,
        plainText: digestText,
        payload: {
          text: digestText,
          source,
          promptVersion: "v1",
        },
        tokenEstimate,
        coveredTokenEstimate,
        originEntryIds,
      },
    };
  }

  toDigestRow(sessionId: string, build: DigestBuildResult["draft"]) {
    const timestamp = nowIso();
    return {
      entry_id: build.entryId,
      session_id: sessionId,
      entry_kind: "digest" as const,
      render_role: "digest",
      turn_from: build.turnFrom,
      turn_to: build.turnTo,
      layer_no: build.layerNo,
      plain_text: build.plainText,
      payload_json: stringifyJson(build.payload),
      token_estimate: build.tokenEstimate,
      covered_token_estimate: build.coveredTokenEstimate,
      origin_entry_ids_json: stringifyJson(build.originEntryIds),
      vector_blob: null,
      vector_model_id: "",
      vector_size: 0,
      created_at: timestamp,
      updated_at: timestamp,
      meta_json: "{}",
    };
  }
}
