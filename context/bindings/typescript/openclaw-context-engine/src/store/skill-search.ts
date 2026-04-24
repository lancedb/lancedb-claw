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

import { createHash } from "node:crypto";
import type { ContextLanceDbConfig } from "../config.js";
import { retryAsync } from "../retry.js";
import {
  createRetryOptions,
  createSkillRow,
  sqlString,
  type Skill,
  type SkillInsertRow,
  type SkillSearchResult,
  type StoreCore,
} from "./helper.js";

type SnapshotResolvedSkill = {
  name?: unknown;
  description?: unknown;
  filePath?: unknown;
};

type SkillsSnapshotLike = {
  resolvedSkills?: unknown;
};

export type NormalizedSnapshotSkill = {
  name: string;
  location: string;
  keyworkds: string[];
  desc: string;
};

export type SkillSyncPayload = {
  snapshotHash: string;
  rows: SkillInsertRow[];
};

type BuiltSkillSyncRows = {
  rows: Skill[];
  failedNames: string[];
};

export class SkillSearchStoreModule {
  constructor(
    private readonly config: ContextLanceDbConfig,
    private readonly core: StoreCore,
  ) {}

  private normalizeSkillRecord(row: Record<string, unknown>): Skill {
    const descVectorValue = row.desc_vector;
    const normalizedVector =
      Array.isArray(descVectorValue)
        ? descVectorValue.map((value: unknown) => Number(value))
        : descVectorValue &&
            typeof descVectorValue === "object" &&
            "toArray" in descVectorValue &&
            typeof (descVectorValue as { toArray: () => unknown }).toArray === "function"
          ? Array.from(
              (descVectorValue as { toArray: () => Iterable<unknown> }).toArray(),
              (value) => Number(value),
            )
          : descVectorValue &&
              typeof descVectorValue === "object" &&
              Symbol.iterator in descVectorValue
            ? Array.from(descVectorValue as Iterable<unknown>, (value) => Number(value))
            : [];
    return {
      name: String(row.name ?? ""),
      location: String(row.location ?? ""),
      keyworkds: Array.isArray(row.keyworkds)
        ? row.keyworkds.map((value: unknown) => String(value))
        : [],
      desc: String(row.desc ?? ""),
      desc_vector: normalizedVector,
    };
  }

  private normalizeResolvedSkill(skill: SnapshotResolvedSkill): NormalizedSnapshotSkill | null {
    const name = typeof skill.name === "string" ? skill.name.trim() : "";
    if (!name) {
      return null;
    }
    const location = typeof skill.filePath === "string" ? skill.filePath.trim() : "";
    const descValue = skill.description;
    const desc =
      typeof descValue === "string"
        ? descValue.trim()
        : typeof descValue === "undefined"
          ? ""
          : String(descValue);
    return {
      name,
      location,
      keyworkds: [],
      desc,
    };
  }

  buildSkillSyncPayload(snapshot: unknown): SkillSyncPayload {
    const normalized = new Map<string, NormalizedSnapshotSkill>();
    const resolvedSkills = (snapshot as SkillsSnapshotLike | null | undefined)?.resolvedSkills;
    if (Array.isArray(resolvedSkills)) {
      for (const value of resolvedSkills) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const normalizedSkill = this.normalizeResolvedSkill(value as SnapshotResolvedSkill);
        if (!normalizedSkill) {
          continue;
        }
        normalized.set(normalizedSkill.name, normalizedSkill);
      }
    }

    const rows = [...normalized.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((skill) =>
        createSkillRow({
          name: skill.name,
          location: skill.location,
          keyworkds: skill.keyworkds,
          desc: skill.desc,
        }),
      );
    const hash = createHash("sha256");
    hash.update(JSON.stringify(rows));
    return {
      snapshotHash: hash.digest("hex"),
      rows,
    };
  }

  private async buildSkillSyncRows(rows: SkillInsertRow[]): Promise<BuiltSkillSyncRows> {
    if (rows.length === 0) {
      return {
        rows: [],
        failedNames: [],
      };
    }

    const table = this.core.getSkillsTable();
    const existingRows = (await table
      .query()
      .select(["name", "location", "keyworkds", "desc", "desc_vector"])
      .toArray()) as Array<Record<string, unknown>>;
    const existingByName = new Map<string, Skill>();
    for (const existing of existingRows) {
      const normalized = this.normalizeSkillRecord(existing);
      existingByName.set(normalized.name, normalized);
    }

    const embeddingClient = this.core.embeddingClient;
    if (!embeddingClient) {
      this.core.logger.warn(
        "context-lancedb: skill sync skipped because embedding client is unavailable",
      );
      return {
        rows: [],
        failedNames: rows.map((row) => row.name),
      };
    }

    const payloads: Skill[] = [];
    const failedNames: string[] = [];
    for (const row of rows) {
      const existing = existingByName.get(row.name);
      const normalizedKeywords = row.keyworkds ?? [];
      let descVector: number[] | undefined;

      if (
        existing &&
        existing.desc === row.desc &&
        Array.isArray(existing.desc_vector) &&
        existing.desc_vector.length > 0
      ) {
        descVector = existing.desc_vector;
      } else {
        try {
          const vector =
            row.desc_vector ??
            (await retryAsync(
              () => embeddingClient.embed(row.desc),
              createRetryOptions(this.config, "context-lancedb-skill-embed"),
            ));
          descVector = vector && vector.length > 0 ? vector : [];
        } catch (err) {
          this.core.logger.warn(
            `context-lancedb: failed to embed skill ${row.name} (${err instanceof Error ? err.message : String(err)})`,
          );
          failedNames.push(row.name);
          continue;
        }
      }

      payloads.push({
        name: row.name,
        location: row.location ?? existing?.location ?? "",
        keyworkds: normalizedKeywords,
        desc: row.desc,
        desc_vector: descVector ?? [],
      });
    }

    return {
      rows: payloads,
      failedNames,
    };
  }

  async syncSkillsFromSnapshot(payload: SkillSyncPayload): Promise<number> {
    const table = this.core.getSkillsTable();
    const built = await this.buildSkillSyncRows(payload.rows);
    if (payload.rows.length > 0 && built.rows.length === 0) {
      return 0;
    }

    const mergeBuilder = table
      .mergeInsert(["name"])
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll();

    if (built.failedNames.length === 0) {
      await mergeBuilder.whenNotMatchedBySourceDelete().execute(built.rows);
    } else {
      this.core.logger.warn(
        `context-lancedb: skill sync had ${built.failedNames.length} embedding failures, skipping source-delete for ${built.failedNames.join(", ")}`,
      );
      await mergeBuilder.execute(built.rows);
    }
    return built.rows.length;
  }

  async upsertSkills(rows: SkillInsertRow[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const built = await this.buildSkillSyncRows(rows);
    if (built.rows.length === 0) {
      return 0;
    }
    const table = this.core.getSkillsTable();
    return await this.core.mergeInsertRows({
      table,
      rows: built.rows,
      on: "name",
      label: "context-lancedb-upsert-skills",
      updateWhenMatched: true,
    });
  }

  async upsertSkill(row: SkillInsertRow): Promise<boolean> {
    const changed = await this.upsertSkills([row]);
    return changed >= 0;
  }

  async getSkill(name: string): Promise<Skill | null> {
    const table = this.core.getSkillsTable();
    const rows = await table
      .query()
      .where(`name = ${sqlString(name)}`)
      .select(["name", "location", "keyworkds", "desc", "desc_vector"])
      .toArray();
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? this.normalizeSkillRecord(row) : null;
  }

  async listSkills(limit: number): Promise<Skill[]> {
    if (limit <= 0) {
      return [];
    }
    const table = this.core.getSkillsTable();
    const rows = (await table
      .query()
      .select(["name", "location", "keyworkds", "desc", "desc_vector"])
      .toArray()) as Array<Record<string, unknown>>;
    return rows.slice(0, limit).map((row) => this.normalizeSkillRecord(row));
  }

  async searchSkills(params: { queryText: string; limit: number }): Promise<SkillSearchResult[]> {
    if (params.limit <= 0 || !params.queryText.trim()) {
      return [];
    }
    if (!this.core.embeddingClient) {
      return [];
    }
    const table = this.core.getSkillsTable();
    try {
      const vector = await retryAsync(
        () => this.core.embeddingClient!.embed(params.queryText),
        createRetryOptions(this.config, "context-lancedb-skill-search-embed"),
      );
      const results = (await table
        .vectorSearch(vector)
        .column("desc_vector")
        .limit(params.limit)
        .toArray()) as Array<Record<string, unknown>>;
      return results.map((row) => ({
        row: this.normalizeSkillRecord(row),
        distance:
          typeof (row as Record<string, unknown>)._distance === "number" &&
          Number.isFinite((row as Record<string, unknown>)._distance)
            ? Number((row as Record<string, unknown>)._distance)
            : undefined,
      }));
    } catch (err) {
      this.core.logger.warn(
        `context-lancedb: failed to search skills with vector embedding (${err instanceof Error ? err.message : String(err)})`,
      );
      return [];
    }
  }

  async cleanupSkillsTableIfNeeded(): Promise<boolean> {
    const table = this.core.getSkillsTable();
    const cleanupOlderThan = new Date(
      Date.now() - this.config.skillSearchCleanupOlderThanDays * 24 * 60 * 60 * 1000,
    );
    await table.optimize({
      cleanupOlderThan,
    });
    return true;
  }
}
