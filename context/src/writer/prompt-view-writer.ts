// SPDX-License-Identifier: Apache-2.0

import { LanceDbClient } from "../db/client.js";
import { quoteSqlString } from "../db/schema.js";
import type { PromptSlot } from "../types/domain.js";

export class PromptViewWriter {
  constructor(private readonly db: LanceDbClient) {}

  async replace(sessionId: string, rows: PromptSlot[]): Promise<void> {
    const table = await this.db.getPromptViewTable();
    await table.delete(`session_id = ${quoteSqlString(sessionId)}`);
    if (rows.length > 0) {
      await table.add(rows);
    }
  }

  async append(rows: PromptSlot[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const table = await this.db.getPromptViewTable();
    await table.add(rows);
  }
}
