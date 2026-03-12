// SPDX-License-Identifier: Apache-2.0

import { nowIso } from "../helpers/clock.js";
import { LanceDbClient } from "../db/client.js";
import { quoteSqlString } from "../db/schema.js";

export class VectorWriter {
  constructor(private readonly db: LanceDbClient) {}

  async writeVector(params: {
    sessionId: string;
    entryId: string;
    vector: number[];
    modelId: string;
  }): Promise<void> {
    const table = await this.db.getEntryStoreTable();
    await table.update({
      where:
        `session_id = ${quoteSqlString(params.sessionId)}` +
        ` AND entry_id = ${quoteSqlString(params.entryId)}`,
      values: {
        vector_blob: params.vector,
        vector_model_id: params.modelId,
        vector_size: params.vector.length,
        updated_at: nowIso(),
      },
    });
  }
}
