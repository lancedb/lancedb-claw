// SPDX-License-Identifier: Apache-2.0

import type { DigestEntry, RecallCandidate } from "../types/domain.js";

function overlaps(a: DigestEntry, b: DigestEntry): boolean {
  return a.turn_from <= b.turn_to && b.turn_from <= a.turn_to;
}

export function filterRecallCandidates(params: {
  candidates: RecallCandidate[];
  excludedEntryIds: Set<string>;
  protectedTailRange?: { start: number; end: number };
  floorScore: number;
  limit: number;
}): RecallCandidate[] {
  const accepted: RecallCandidate[] = [];
  for (const candidate of params.candidates) {
    if (params.excludedEntryIds.has(candidate.entry.entry_id)) {
      continue;
    }
    if (candidate.score < params.floorScore) {
      continue;
    }
    if (
      params.protectedTailRange &&
      candidate.entry.turn_from <= params.protectedTailRange.end &&
      params.protectedTailRange.start <= candidate.entry.turn_to
    ) {
      continue;
    }
    if (accepted.some((existing) => overlaps(existing.entry, candidate.entry))) {
      continue;
    }
    accepted.push(candidate);
    if (accepted.length >= params.limit) {
      break;
    }
  }
  return accepted;
}
