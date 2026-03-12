// SPDX-License-Identifier: Apache-2.0

export { default } from "./plugin.js";
export type { LanceDbContextConfig, ResolvedContextConfig } from "./types/config.js";
export type {
  ContextLogger,
  DigestEntry,
  EntryKind,
  PromptSlot,
  RecallCandidate,
  TurnEntry,
} from "./types/domain.js";
