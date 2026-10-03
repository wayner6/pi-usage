import type { UsageSnapshot } from "./types.ts";
import { safeError } from "./security.ts";

export class UsageCache {
  private snapshots = new Map<string, UsageSnapshot>();
  private pending = new Map<string, Promise<UsageSnapshot>>();

  get(key: string): UsageSnapshot | undefined {
    return this.snapshots.get(key);
  }

  async coalesce(key: string, operation: () => Promise<UsageSnapshot>): Promise<UsageSnapshot> {
    // Capture this cache generation so clear() also isolates unfinished requests.
    const snapshots = this.snapshots;
    const pending = this.pending;
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = operation()
      .then((snapshot) => {
        snapshots.set(key, snapshot);
        return snapshot;
      })
      .catch((error) => {
        const old = snapshots.get(key);
        if (!old) throw new Error(safeError(error));
        const stale: UsageSnapshot = {
          ...old,
          state: "stale",
          stale: true,
          error: safeError(error),
        };
        snapshots.set(key, stale);
        return stale;
      })
      .finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  }

  clear(): void {
    this.snapshots = new Map();
    this.pending = new Map();
  }
}
