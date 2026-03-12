// SPDX-License-Identifier: Apache-2.0

import type { ContextLogger } from "../types/domain.js";
import type { LogLevelName } from "../types/config.js";

const LOG_LEVEL_ORDER: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createContextLogger(
  logger: {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  },
  level: LogLevelName,
): ContextLogger {
  const enabled = (target: LogLevelName) => LOG_LEVEL_ORDER[target] >= LOG_LEVEL_ORDER[level];

  return {
    debug(message, meta) {
      if (enabled("debug")) {
        logger.debug?.(message, meta);
      }
    },
    info(message, meta) {
      if (enabled("info")) {
        logger.info(message, meta);
      }
    },
    warn(message, meta) {
      if (enabled("warn")) {
        logger.warn(message, meta);
      }
    },
    error(message, meta) {
      if (enabled("error")) {
        logger.error(message, meta);
      }
    },
  };
}
