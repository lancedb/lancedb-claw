// SPDX-License-Identifier: Apache-2.0

import type { OpenClawPluginApi, OpenClawPluginDefinition } from "openclaw/plugin-sdk";
import { createContextLogger } from "./helpers/logger.js";
import { SessionTaskQueue } from "./helpers/queue.js";
import { resolveContextConfig } from "./types/config.js";
import { OpenClawRuntimeBridge } from "./runtime-bridge/openclaw-runtime.js";
import { LanceDbClient } from "./db/client.js";
import { SessionStateReader } from "./reader/session-state-reader.js";
import { EntryStoreReader } from "./reader/entry-store-reader.js";
import { PromptViewReader } from "./reader/prompt-view-reader.js";
import { SessionStateWriter } from "./writer/session-state-writer.js";
import { EntryStoreWriter } from "./writer/entry-store-writer.js";
import { PromptViewWriter } from "./writer/prompt-view-writer.js";
import { VectorWriter } from "./writer/vector-writer.js";
import { IndexMaintainer } from "./indexing/index-maintainer.js";
import { TextRecall } from "./search/text-recall.js";
import { VectorRecall } from "./search/vector-recall.js";
import { HybridRecall } from "./search/hybrid-recall.js";
import { DigestBuilder } from "./summary/digest-builder.js";
import { OpenAICompatibleEmbedder } from "./embedding/openai-compatible-embedder.js";
import { LanceDbContextEngine } from "./engine/lancedb-context-engine.js";

const plugin: OpenClawPluginDefinition = {
  id: "lancedb-claw",
  name: "LanceDB Context Engine",
  description: "LanceDB-backed context engine with digest recall",
  kind: "context-engine",
  register(api: OpenClawPluginApi) {
    api.registerContextEngine("lancedb-claw", () => {
      const config = resolveContextConfig(api.pluginConfig, api.resolvePath);
      const logger = createContextLogger(api.logger, config.logLevel);
      const runtimeBridge = new OpenClawRuntimeBridge(api, logger);
      const queue = new SessionTaskQueue();
      const db = new LanceDbClient(config, logger);
      const sessionStateReader = new SessionStateReader(db);
      const entryStoreReader = new EntryStoreReader(db);
      const promptViewReader = new PromptViewReader(db);
      const sessionStateWriter = new SessionStateWriter(db);
      const entryStoreWriter = new EntryStoreWriter(db);
      const promptViewWriter = new PromptViewWriter(db);
      const vectorWriter = new VectorWriter(db);
      const indexMaintainer = new IndexMaintainer({
        db,
        logger,
        sessionStateReader,
        sessionStateWriter,
        entryStoreReader,
      });
      const textRecall = new TextRecall(db, entryStoreReader);
      const vectorRecall = new VectorRecall(db, entryStoreReader);
      const embedder = new OpenAICompatibleEmbedder(config.semanticIndex);
      const hybridRecall = new HybridRecall({
        config,
        textRecall,
        vectorRecall,
        embedder,
      });
      const digestBuilder = new DigestBuilder({
        config,
        logger,
        runtimeBridge,
      });

      return new LanceDbContextEngine({
        config,
        logger,
        runtimeBridge,
        queue,
        db,
        sessionStateReader,
        entryStoreReader,
        promptViewReader,
        sessionStateWriter,
        entryStoreWriter,
        promptViewWriter,
        vectorWriter,
        indexMaintainer,
        hybridRecall,
        digestBuilder,
        embedder,
      });
    });
  },
};

export default plugin;
