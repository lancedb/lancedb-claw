// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "../../openclaw/node_modules/vitest/dist/config.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTEXT_ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: CONTEXT_ROOT,
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
  },
  resolve: {
    alias: {
      vitest: path.resolve(
        CONTEXT_ROOT,
        "../../openclaw/node_modules/vitest/dist/index.js",
      ),
      "vitest/config": path.resolve(
        CONTEXT_ROOT,
        "../../openclaw/node_modules/vitest/dist/config.js",
      ),
      "@mariozechner/pi-agent-core": path.resolve(
        CONTEXT_ROOT,
        "../../openclaw/node_modules/@mariozechner/pi-agent-core/dist/index.js",
      ),
      "@mariozechner/pi-ai": path.resolve(
        CONTEXT_ROOT,
        "../../openclaw/node_modules/@mariozechner/pi-ai/dist/index.js",
      ),
      "@lancedb/lancedb": path.resolve(CONTEXT_ROOT, "../../lancedb/nodejs/lancedb/index.ts"),
    },
  },
});
