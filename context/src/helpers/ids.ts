// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function makeTurnEntryId(params: {
  sessionId: string;
  turnSeq: number;
  role: string;
  plainText: string;
}): string {
  return `turn_${hashText(
    `${params.sessionId}\u0000${params.turnSeq}\u0000${params.role}\u0000${params.plainText}`,
  )}`;
}

export function makeDigestEntryId(params: {
  sessionId: string;
  layerNo: number;
  turnFrom: number;
  turnTo: number;
  originEntryIds: string[];
  plainText: string;
}): string {
  return `digest_${hashText(
    [
      params.sessionId,
      String(params.layerNo),
      String(params.turnFrom),
      String(params.turnTo),
      params.originEntryIds.join(","),
      params.plainText,
    ].join("\u0000"),
  )}`;
}
