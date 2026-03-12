// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTEXT_ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: CONTEXT_ROOT,
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
  },
});
