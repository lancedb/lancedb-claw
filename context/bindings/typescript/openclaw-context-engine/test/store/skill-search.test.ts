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
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseContextLanceDbConfig } from "../../src/config.js";
import { ContextLanceDbStore } from "../../src/store.js";

const tempDirs: string[] = [];
const openStores: ContextLanceDbStore[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-search-test-"));
  tempDirs.push(dir);
  return dir;
}

async function createStore(withEmbedding = true): Promise<{
  store: ContextLanceDbStore;
  embed: ReturnType<typeof vi.fn>;
  warnings: string[];
}> {
  const dir = await createTempDir();
  const embed = vi.fn(async (text: string) => [text.length, text.length + 1]);
  const warnings: string[] = [];
  const config = parseContextLanceDbConfig({
    skillSearchEnabled: true,
    dbPath: path.join(dir, "db"),
    retry: { attempts: 1, minDelayMs: 0, maxDelayMs: 0, jitter: 0 },
    embedding: {
      provider: "openai",
      dimensions: 2,
    },
  });
  const store = new ContextLanceDbStore(
    config,
    withEmbedding
      ? {
          embed,
        }
      : null,
    {
      info() {},
      warn(message: string) {
        warnings.push(message);
      },
    },
  );
  await store.initialize();
  openStores.push(store);
  return { store, embed, warnings };
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

afterEach(async () => {
  await Promise.all(openStores.splice(0).map((store) => store.dispose()));
  await new Promise((resolve) => setTimeout(resolve, 30));
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
    ),
  );
});

describe("SkillSearchStoreModule", () => {
  it("inserts new skills from the source snapshot", async () => {
    const { store, embed } = await createStore(true);

    await store.syncSkillsFromSnapshot(
      store.buildSkillSyncPayload(
        createSkillsSnapshot([
          {
            name: "weather",
            description: "Find weather forecasts.",
            filePath: "~/skills/weather/SKILL.md",
          },
          {
            name: "maps",
            description: "Find places and routes.",
            filePath: "~/skills/maps/SKILL.md",
          },
        ]),
      ),
    );

    const weather = await store.getSkill("weather");
    const maps = await store.getSkill("maps");
    const skills = await store.listSkills(10);

    expect(embed).toHaveBeenCalledTimes(2);
    expect(skills.map((skill) => skill.name).sort()).toEqual(["maps", "weather"]);
    expect(weather).toMatchObject({
      name: "weather",
      location: "~/skills/weather/SKILL.md",
      desc: "Find weather forecasts.",
    });
    expect(maps).toMatchObject({
      name: "maps",
      location: "~/skills/maps/SKILL.md",
      desc: "Find places and routes.",
    });
  });

  it("updates an existing skill when desc changes and re-embeds it", async () => {
    const { store, embed } = await createStore(true);

    await store.syncSkillsFromSnapshot(
      store.buildSkillSyncPayload(
        createSkillsSnapshot([
          {
            name: "weather",
            description: "Find weather forecasts.",
            filePath: "~/skills/weather/SKILL.md",
          },
        ]),
      ),
    );

    await store.syncSkillsFromSnapshot(
      store.buildSkillSyncPayload(
        createSkillsSnapshot([
          {
            name: "weather",
            description: "Find hourly weather forecasts.",
            filePath: "~/skills/weather/SKILL.md",
          },
        ]),
      ),
    );

    const weather = await store.getSkill("weather");

    expect(embed).toHaveBeenCalledTimes(2);
    expect(weather).toMatchObject({
      name: "weather",
      location: "~/skills/weather/SKILL.md",
      desc: "Find hourly weather forecasts.",
    });
    expect(weather?.desc_vector).toEqual([30, 31]);
  });

  it("reuses existing desc_vector when only location changes", async () => {
    const { store, embed } = await createStore(true);
    const firstPayload = store.buildSkillSyncPayload(
      createSkillsSnapshot([
        {
          name: "weather",
          description: "Find weather forecasts.",
          filePath: "~/skills/weather/SKILL.md",
        },
      ]),
    );
    await store.syncSkillsFromSnapshot(firstPayload);

    const secondPayload = store.buildSkillSyncPayload(
      createSkillsSnapshot([
        {
          name: "weather",
          description: "Find weather forecasts.",
          filePath: "~/skills/weather-v2/SKILL.md",
        },
      ]),
    );
    await store.syncSkillsFromSnapshot(secondPayload);

    const weather = await store.getSkill("weather");
    expect(embed).toHaveBeenCalledTimes(1);
    expect(weather?.location).toBe("~/skills/weather-v2/SKILL.md");
    expect(weather?.desc_vector).toEqual([23, 24]);
  });

  it("deletes stale names through mergeInsert when source snapshot changes", async () => {
    const { store } = await createStore(true);
    await store.syncSkillsFromSnapshot(
      store.buildSkillSyncPayload(
        createSkillsSnapshot([
          {
            name: "weather",
            description: "Find weather forecasts.",
            filePath: "~/skills/weather/SKILL.md",
          },
          {
            name: "maps",
            description: "Find places and routes.",
            filePath: "~/skills/maps/SKILL.md",
          },
        ]),
      ),
    );

    await store.syncSkillsFromSnapshot(
      store.buildSkillSyncPayload(
        createSkillsSnapshot([
          {
            name: "maps",
            description: "Find places and routes.",
            filePath: "~/skills/maps/SKILL.md",
          },
        ]),
      ),
    );

    const weather = await store.getSkill("weather");
    const maps = await store.getSkill("maps");
    const skills = await store.listSkills(10);

    expect(weather).toBeNull();
    expect(maps).toMatchObject({
      name: "maps",
      location: "~/skills/maps/SKILL.md",
      desc: "Find places and routes.",
    });
    expect(skills.map((skill) => skill.name)).toEqual(["maps"]);
  });

  it("skips source-delete when part of the snapshot fails to embed", async () => {
    const { store, embed, warnings } = await createStore(true);
    await store.syncSkillsFromSnapshot(
      store.buildSkillSyncPayload(
        createSkillsSnapshot([
          {
            name: "maps",
            description: "Find places and routes.",
            filePath: "~/skills/maps/SKILL.md",
          },
          {
            name: "calendar",
            description: "Manage calendar events.",
            filePath: "~/skills/calendar/SKILL.md",
          },
        ]),
      ),
    );

    embed.mockImplementation(async (text: string) => {
      if (text === "Manage calendar events with reminders.") {
        throw new Error("embedding boom");
      }
      return [text.length, text.length + 1];
    });

    await store.syncSkillsFromSnapshot(
      store.buildSkillSyncPayload(
        createSkillsSnapshot([
          {
            name: "maps",
            description: "Find places and routes.",
            filePath: "~/skills/maps/SKILL.md",
          },
          {
            name: "calendar",
            description: "Manage calendar events with reminders.",
            filePath: "~/skills/calendar/SKILL.md",
          },
        ]),
      ),
    );

    const maps = await store.getSkill("maps");
    const calendar = await store.getSkill("calendar");
    const skills = await store.listSkills(10);

    expect(skills.map((skill) => skill.name).sort()).toEqual(["calendar", "maps"]);
    expect(maps).toMatchObject({
      name: "maps",
      desc: "Find places and routes.",
    });
    expect(calendar).toMatchObject({
      name: "calendar",
      desc: "Manage calendar events.",
    });
    expect(
      warnings.some(
        (message) =>
          message.includes("skill sync had 1 embedding failures") &&
          message.includes("calendar"),
      ),
    ).toBe(true);
  });

  it("returns no skill search results when embedding is unavailable", async () => {
    const { store } = await createStore(false);
    const results = await store.searchSkills({
      queryText: "weather",
      limit: 5,
    });
    expect(results).toEqual([]);
  });
});
