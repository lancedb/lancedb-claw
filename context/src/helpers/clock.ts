// SPDX-License-Identifier: Apache-2.0

export function nowIso(): string {
  return new Date().toISOString();
}

export function nowMs(): number {
  return Date.now();
}
