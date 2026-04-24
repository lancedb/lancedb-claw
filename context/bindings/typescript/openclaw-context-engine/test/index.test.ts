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

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { connect } from "@lancedb/lancedb";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseContextLanceDbConfig } from "../src/config.js";
import type { ContextLanceDbConfig } from "../src/config.js";
import { LanceDBContextEngine } from "../src/engine.js";
import contextLanceDbPlugin from "../src/index.js";
import { ContextLanceDbStore } from "../src/store.js";

const tempDirs: string[] = [];
const disposableEngines: LanceDBContextEngine[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-context-lancedb-"));
  tempDirs.push(dir);
  return dir;
}

async function createEngine(
  overrides: Partial<ContextLanceDbConfig> = {},
  depsOverrides: Partial<ConstructorParameters<typeof LanceDBContextEngine>[1]> = {},
) {
  const dir = await createTempDir();
  const config: ContextLanceDbConfig = {
    retrievalEnabled: true,
    skillSearchEnabled: false,
    skillSearchRecentMessageCount: 2,
    skillSearchCandidateLimit: 12,
    skillSearchMinResults: 5,
    skillSearchCacheSize: 50,
    skillSearchCleanupOlderThanDays: 3,
    skillSearchMaxDistance: 10,
    skillSyncIntervalSeconds: 60,
    dbPath: path.join(dir, "db"),
    freshTailCount: 6,
    summaryRecallLimit: 3,
    recentSummaryCount: 2,
    detailMessagesPerSummary: 2,
    retrievalTokenReserve: 1200,
    retry: {
      attempts: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
      jitter: 0,
    },
    ...overrides,
  };
  const warnings: string[] = [];
  const engine = new LanceDBContextEngine(config, {
    logger: {
      info() {},
      warn(message: string) {
        warnings.push(message);
      },
      error() {},
    },
    embeddingClient: null,
    ...depsOverrides,
  });
  await engine.initialize();
  engine.warmup();
  disposableEngines.push(engine);
  return { dir, config, engine, warnings };
}

function getStore(engine: LanceDBContextEngine): ContextLanceDbStore {
  return (engine as unknown as { getStore: () => ContextLanceDbStore }).getStore();
}

function createUserMessage(text: string, timestamp: number): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp,
  } as AgentMessage;
}

function createAssistantMessage(text: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openclaw",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp,
  } as AgentMessage;
}

function createSkillsSnapshot(skills: Array<{ name: string; description: string; filePath: string }>) {
  return {
    prompt: "",
    skills: skills.map((skill) => ({ name: skill.name })),
    resolvedSkills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
    })),
  };
}

async function readTableRows(
  dbPath: string,
  tableName: string,
): Promise<Record<string, unknown>[]> {
  const db = await connect(dbPath);
  try {
    const table = await db.openTable(tableName);
    try {
      return await table.query().toArray();
    } finally {
      table.close();
    }
  } finally {
    db.close();
  }
}

afterEach(async () => {
  await Promise.all(disposableEngines.splice(0).map((engine) => engine.dispose()));
  await new Promise((resolve) => setTimeout(resolve, 30));
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  );
});

describe("context-lancedb", () => {
  it("parses skillSearchEnabled and embedding dimensions", () => {
    expect(parseContextLanceDbConfig(undefined).skillSearchEnabled).toBe(false);
    expect(
      parseContextLanceDbConfig({
        embedding: {
          provider: "local",
        },
      }).embedding?.dimensions,
    ).toBe(512);
    expect(
      parseContextLanceDbConfig({
        embedding: {
          provider: "openai",
        },
      }).embedding?.dimensions,
    ).toBe(2048);
  });

  it("registers a singleton engine instance for repeated factory resolution", async () => {
    const dir = await createTempDir();
    const dbPath = path.join(dir, "db");
    let factory: (() => Promise<LanceDBContextEngine>) | undefined;
    const api = {
      pluginConfig: {
        retrievalEnabled: true,
        dbPath,
      },
      config: {},
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolvePath(value: string) {
        return value;
      },
      runtime: {
        agent: {
          session: {
            loadSessionStore() {
              return {};
            },
          },
        },
      },
      registerContextEngine(_id: string, registeredFactory: () => Promise<LanceDBContextEngine>) {
        factory = registeredFactory;
      },
    };

    contextLanceDbPlugin.register(api as never);
    const first = await factory!();
    const second = await factory!();

    expect(second).toBe(first);
    disposableEngines.push(first);
  });

  it("creates only the skills table when only skill search is enabled", async () => {
    const { config } = await createEngine({
      retrievalEnabled: false,
      skillSearchEnabled: true,
    });
    await expect(readTableRows(config.dbPath, "skills")).resolves.toEqual([]);
  });

  it("bootstraps transcript messages idempotently for retrieval", async () => {
    const { dir, config, engine, warnings } = await createEngine();
    const sessionFile = path.join(dir, "session.jsonl");
    const sessionManager = SessionManager.open(sessionFile);
    sessionManager.appendMessage(createUserMessage("hello", 1));
    sessionManager.appendMessage(createAssistantMessage("world", 2));

    const first = await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey: "agent:test:main",
      sessionFile,
    });
    const second = await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey: "agent:test:main",
      sessionFile,
    });

    const messageRows = await readTableRows(config.dbPath, "context_messages");
    expect(warnings).toEqual([]);
    expect(first.importedMessages).toBe(2);
    expect(second.reason).toBe("state-checkpoint-fresh");
    expect(messageRows).toHaveLength(2);
  });

  it("syncs skills from session snapshots on first bootstrap and skips unchanged snapshots", async () => {
    const sessionKey = "agent:test:main";
    const snapshot = createSkillsSnapshot([
      {
        name: "weather",
        description: "Find weather forecasts.",
        filePath: "~/skills/weather/SKILL.md",
      },
    ]);
    const loadSessionStore = vi.fn(() => ({
      [sessionKey.toLowerCase()]: {
        sessionId: "sess-1",
        updatedAt: Date.now(),
        skillsSnapshot: snapshot,
      },
    }));
    const embed = vi.fn(async () => [0.1, 0.2]);
    const { dir, config, engine } = await createEngine(
      {
        retrievalEnabled: false,
        skillSearchEnabled: true,
        embedding: {
          provider: "openai",
          dimensions: 2,
        },
      },
      {
        loadSessionStore,
        embeddingClient: {
          embed,
        },
      },
    );
    const store = getStore(engine);
    const syncSpy = vi.spyOn(store, "syncSkillsFromSnapshot");
    const sessionFile = path.join(dir, "session.jsonl");

    await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey,
      sessionFile,
    });
    await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey,
      sessionFile,
    });

    const rows = await readTableRows(config.dbPath, "skills");
    expect(loadSessionStore).toHaveBeenCalledTimes(2);
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("weather");
  });

  it("resyncs skills when the snapshot changes and removes stale names", async () => {
    const sessionKey = "agent:test:main";
    let snapshot = createSkillsSnapshot([
      {
        name: "weather",
        description: "Find weather forecasts.",
        filePath: "~/skills/weather/SKILL.md",
      },
    ]);
    const loadSessionStore = vi.fn(() => ({
      [sessionKey.toLowerCase()]: {
        sessionId: "sess-1",
        updatedAt: Date.now(),
        skillsSnapshot: snapshot,
      },
    }));
    const embed = vi.fn(async (text: string) => [text.length, text.length + 1]);
    const { dir, config, engine } = await createEngine(
      {
        retrievalEnabled: false,
        skillSearchEnabled: true,
        embedding: {
          provider: "openai",
          dimensions: 2,
        },
      },
      {
        loadSessionStore,
        embeddingClient: {
          embed,
        },
      },
    );
    const store = getStore(engine);
    const syncSpy = vi.spyOn(store, "syncSkillsFromSnapshot");
    const sessionFile = path.join(dir, "session.jsonl");

    await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey,
      sessionFile,
    });

    snapshot = createSkillsSnapshot([
      {
        name: "maps",
        description: "Find places and routes.",
        filePath: "~/skills/maps/SKILL.md",
      },
    ]);

    await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey,
      sessionFile,
    });

    const rows = await readTableRows(config.dbPath, "skills");
    expect(syncSpy).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("maps");
  });

  it("retries the same snapshot after an incomplete skill sync", async () => {
    const sessionKey = "agent:test:main";
    let snapshot = createSkillsSnapshot([
      {
        name: "weather",
        description: "Find weather forecasts.",
        filePath: "~/skills/weather/SKILL.md",
      },
    ]);
    const loadSessionStore = vi.fn(() => ({
      [sessionKey.toLowerCase()]: {
        sessionId: "sess-1",
        updatedAt: Date.now(),
        skillsSnapshot: snapshot,
      },
    }));
    const embed = vi.fn(async (text: string) => {
      if (text === "Manage calendar events.") {
        throw new Error("embedding boom");
      }
      return [text.length, text.length + 1];
    });
    const { dir, config, engine, warnings } = await createEngine(
      {
        retrievalEnabled: false,
        skillSearchEnabled: true,
        embedding: {
          provider: "openai",
          dimensions: 2,
        },
      },
      {
        loadSessionStore,
        embeddingClient: {
          embed,
        },
      },
    );
    const store = getStore(engine);
    const syncSpy = vi.spyOn(store, "syncSkillsFromSnapshot");
    const sessionFile = path.join(dir, "session.jsonl");

    await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey,
      sessionFile,
    });

    snapshot = createSkillsSnapshot([
      {
        name: "calendar",
        description: "Manage calendar events.",
        filePath: "~/skills/calendar/SKILL.md",
      },
    ]);

    await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey,
      sessionFile,
    });

    embed.mockImplementation(async (text: string) => [text.length, text.length + 1]);

    await engine.bootstrap({
      sessionId: "sess-1",
      sessionKey,
      sessionFile,
    });

    const rows = await readTableRows(config.dbPath, "skills");
    expect(syncSpy).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("calendar");
    expect(
      warnings.some((message) =>
        message.includes("skill sync bootstrap incomplete (0/1); snapshot will be retried"),
      ),
    ).toBe(true);
  });

  it("adds dynamic skill discovery from searched skills", async () => {
    const { engine } = await createEngine({
      retrievalEnabled: false,
      skillSearchEnabled: true,
      skillSearchCandidateLimit: 6,
      skillSearchMinResults: 5,
    });
    vi.spyOn(getStore(engine), "searchSkills").mockResolvedValue([
      {
        row: {
          name: "weather",
          keyworkds: [],
          desc: "Find weather forecasts.",
          location: "~/skills/weather/SKILL.md",
          desc_vector: [0.1, 0.2],
        },
        distance: 0.08,
      },
    ]);

    const assembled = await engine.assemble({
      sessionId: "sess-skill-assemble",
      messages: [
        createUserMessage("hello", 1),
        createAssistantMessage("What do you need?", 2),
        createUserMessage("find a weather skill for beijing", 3),
      ],
    });

    expect(assembled.systemPromptAddition).toContain("<dynamic_skill_discovery>");
    expect(assembled.systemPromptAddition).toContain("<name>weather</name>");
    expect(assembled.systemPromptAddition).toContain(
      "<location>~/skills/weather/SKILL.md</location>",
    );
  });

  it("skips skill search when the extracted query is longer than 150 characters", async () => {
    const { engine } = await createEngine({
      retrievalEnabled: false,
      skillSearchEnabled: true,
      skillSearchCandidateLimit: 6,
      skillSearchMinResults: 5,
    });
    const searchSkillsSpy = vi.spyOn(getStore(engine), "searchSkills").mockResolvedValue([]);

    const longQuery =
      "这是一个非常长的技能检索请求，用来验证在 assemble 阶段超过一百个字符的消息会被直接跳过，不再进入 embedding 检索路径，避免无意义的大文本查询成本。".repeat(
        2,
      );

    const assembled = await engine.assemble({
      sessionId: "sess-skill-long-query",
      messages: [
        createUserMessage(longQuery, 1),
      ],
    });

    expect(searchSkillsSpy).not.toHaveBeenCalled();
    expect(assembled.systemPromptAddition).toBeUndefined();
  });
});
