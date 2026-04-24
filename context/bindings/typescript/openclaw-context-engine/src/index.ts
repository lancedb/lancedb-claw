/*
 * Copyright 2026 The OpenClaw Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { contextLanceDbConfigSchema, parseContextLanceDbConfig } from "./config.js";
import { Embedder, type EmbedderConfig } from "./embeddings/index.js";
import { LanceDBContextEngine } from "./engine.js";

export interface ContextEmbeddingClient {
  embed(text: string): Promise<number[]>;
}

// 此处会设置local embedding model的路径，考虑和memory插件复用model cache，而不是单独下载
// ~/.node-llama-cpp/models/
function resolveEmbeddingConfigPaths(
  api: Pick<OpenClawPluginApi, "resolvePath">,
  embedding: EmbedderConfig | undefined,
): EmbedderConfig | undefined {
  if (!embedding || embedding.provider !== "local") {
    return embedding;
  }

  const resolved: EmbedderConfig = { ...embedding };

  if (embedding.localModelCacheDir) {
    resolved.localModelCacheDir = api.resolvePath(embedding.localModelCacheDir);
  }

  if (embedding.localModelPath && !/^[a-z][a-z0-9+.-]*:/i.test(embedding.localModelPath)) {
    resolved.localModelPath = api.resolvePath(embedding.localModelPath);
  }

  return resolved;
}

// enginePromise 声明在模块作用域，确保跨多次 register 调用时引擎实例保持单例
let enginePromise: Promise<LanceDBContextEngine> | null = null;

const contextLanceDbPlugin = {
  id: "context-lancedb",
  name: "Context Engine (LanceDB)",
  description: "LanceDB-backed context engine for session summaries and detail recall",
  kind: "context-engine" as const,
  configSchema: contextLanceDbConfigSchema,
  register(api: OpenClawPluginApi) {
    const pluginConfig = parseContextLanceDbConfig(api.pluginConfig);
    const resolvedDbPath = api.resolvePath(pluginConfig.dbPath);
    api.registerContextEngine("context-lancedb", () => {
      enginePromise ??= Promise.resolve().then(async () => {
        const resolvedConfig = {
          ...pluginConfig,
          dbPath: resolvedDbPath,
        };

        let embeddingClient: ContextEmbeddingClient | null = null;
        const featuresEnabled =
          resolvedConfig.retrievalEnabled || resolvedConfig.skillSearchEnabled;
        const embeddingCfg = featuresEnabled
          ? resolveEmbeddingConfigPaths(api, resolvedConfig.embedding)
          : undefined;

        if (embeddingCfg) {
          try {
            const embedder = Embedder.create(embeddingCfg, {
              info: (msg: string) => api.logger.info(msg),
              warn: (msg: string) => api.logger.warn(msg),
            });

            embeddingClient = {
              embed(text: string) {
                return embedder.embed(text);
              },
            };
          } catch (err) {
            api.logger.warn(
              `context-lancedb: failed to initialize embedding provider; vector skill search will be disabled (${err instanceof Error ? err.message : String(err)})`,
            );
          }
        }

        const engine = new LanceDBContextEngine(resolvedConfig, {
          logger: api.logger,
          openClawConfig: api.config,
          embeddingClient,
          loadSessionStore: api.runtime?.agent?.session?.loadSessionStore,
        });
        await engine.initialize();
        engine.warmup();
        return engine;
      });
      return enginePromise;
    });
  },
};

export default contextLanceDbPlugin;
