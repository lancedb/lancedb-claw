// SPDX-License-Identifier: Apache-2.0

declare module "vitest/config" {
  export function defineConfig(config: Record<string, unknown>): Record<string, unknown>;
}
