// SPDX-License-Identifier: Apache-2.0

export type RuntimeModelAuthLookupModel = {
  id: string;
  provider: string;
  api: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow?: number;
  maxTokens?: number;
};

export type RuntimeModelAuthResult = {
  apiKey?: string;
};

export type RuntimeModelAuth = {
  getApiKeyForModel: (params: {
    model: RuntimeModelAuthLookupModel;
    cfg?: unknown;
    profileId?: string;
    preferredProfile?: string;
  }) => Promise<RuntimeModelAuthResult | undefined>;
};

export type DigestResolution = {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  api: string;
  source: "override" | "runtime";
};
