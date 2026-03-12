// SPDX-License-Identifier: Apache-2.0

declare module "vitest" {
  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
  export const test: (name: string, fn: () => void | Promise<void>) => void;
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export const afterEach: (fn: () => void | Promise<void>) => void;
  export const expect: (value: unknown) => {
    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toContain: (expected: unknown) => void;
    toHaveLength: (expected: number) => void;
    toBeGreaterThan: (expected: number) => void;
    toBeGreaterThanOrEqual: (expected: number) => void;
    toMatch: (expected: RegExp | string) => void;
    toThrow: () => void;
  };
  export const vi: {
    fn: <T extends (...args: any[]) => any>(impl?: T) => T;
    mock: (path: string, factory?: () => unknown) => void;
    resetAllMocks: () => void;
  };
}
