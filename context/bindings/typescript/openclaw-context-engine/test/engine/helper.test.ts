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

import { describe, expect, it } from "vitest";
import { extractSearchQuery } from "../../src/engine/helper.js";

describe("engine helper prompt normalization", () => {
  it("strips the openclaw message timestamp prefix", () => {
    const prompt = "[Thu 2026-03-26 20:36 GMT+8] 你好";

    expect(extractSearchQuery({ messages: [], prompt })).toBe("你好");
  });

  it("extracts the actual Feishu message text from structured prompt metadata", () => {
    const prompt = `{
  "message_id": "om_x100b536617f2d4a8e12c24d0c56296e",
  "sender_id": "ou_face2d241375cd17056a606e7a58284d",
  "sender": "ou_face2d241375cd17056a606e7a58284d",
  "timestamp": "Thu 2026-03-26 20:24 GMT+8"
}

Sender (untrusted metadata):
\`\`\`json
{
  "label": "ou_face2d241375cd17056a606e7a58284d",
  "id": "ou_face2d241375cd17056a606e7a58284d",
  "name": "ou_face2d241375cd17056a606e7a58284d"
}
\`\`\`

[message_id: om_x100b536617f2d4a8e12c24d0c56296e]
ou_face2d241375cd17056a606e7a58284d: 你好，      `;

    expect(extractSearchQuery({ messages: [], prompt })).toBe("你好，");
  });
});
