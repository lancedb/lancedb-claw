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

import type { ContextEngineRule } from "./base.js";

export class ContextEngineRuleRegistry {
  private readonly rules: ContextEngineRule[];

  constructor(rules: ContextEngineRule[]) {
    this.rules = [...rules].sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id),
    );
  }

  getEnabledRules(): readonly ContextEngineRule[] {
    return this.rules.filter((rule) => rule.isEnabled());
  }

  hasEnabledRules(): boolean {
    return this.getEnabledRules().length > 0;
  }
}
