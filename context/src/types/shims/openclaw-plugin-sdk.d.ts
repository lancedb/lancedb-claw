// SPDX-License-Identifier: Apache-2.0

declare module "openclaw/plugin-sdk" {
  import type { ContextEngine } from "openclaw/context-engine/types";

  export type PluginLogger = {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  };

  export type OpenClawPluginApi = {
    id: string;
    name: string;
    version?: string;
    description?: string;
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    runtime: Record<string, unknown>;
    logger: PluginLogger;
    registerContextEngine: (id: string, factory: () => ContextEngine) => void;
    resolvePath: (input: string) => string;
  };

  export type OpenClawPluginDefinition = {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
    kind?: "context-engine" | "memory";
    register?: (api: OpenClawPluginApi) => void | Promise<void>;
  };
}
