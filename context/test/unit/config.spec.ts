// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { resolveContextConfig } from "../../src/types/config.js";

describe("config", () => {
  it("fills semanticIndex defaults when the config is missing", () => {
    const config = resolveContextConfig({}, (input) => input);

    expect(config.semanticIndex).toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "",
    });
  });

  it("ignores an incomplete digestModel override during early install configuration", () => {
    const config = resolveContextConfig(
      {
        digestModel: {
          provider: "openai",
        },
      },
      (input) => input,
    );

    expect(config.digestModel).toBe(undefined);
  });
});
