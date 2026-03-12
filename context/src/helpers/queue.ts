// SPDX-License-Identifier: Apache-2.0

export class SessionTaskQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const priorTailPromise = this.tails.get(sessionId) ?? Promise.resolve();
    const next = priorTailPromise
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.tails.get(sessionId) === next) {
          this.tails.delete(sessionId);
        }
      });
    this.tails.set(sessionId, next);
    return next;
  }
}
