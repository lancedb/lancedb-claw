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
  const shortlistedHits: RecallCandidate[] = [];
  for (const recallHit of params.candidates) {
    if (params.excludedEntryIds.has(recallHit.entry.entry_id)) {
      continue;
    }
    if (recallHit.score < params.floorScore) {
      continue;
    }
    if (
      params.protectedTailRange &&
      recallHit.entry.turn_from <= params.protectedTailRange.end &&
      params.protectedTailRange.start <= recallHit.entry.turn_to
    ) {
      continue;
    }
    if (shortlistedHits.some((keptHit) => overlaps(keptHit.entry, recallHit.entry))) {
      continue;
    }
    shortlistedHits.push(recallHit);
    if (shortlistedHits.length >= params.limit) {
      break;
    }
  }
  return shortlistedHits;
}
