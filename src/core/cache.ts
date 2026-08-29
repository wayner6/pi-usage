import type { UsageSnapshot } from "./types.ts";

export class UsageCache {
  private snapshots = new Map<string, UsageSnapshot>();
  private pending = new Map<string, Promise<UsageSnapshot>>();

  get(key: string): UsageSnapshot | undefined {
    return this.snapshots.get(key);
  }

  values(): UsageSnapshot[] {
    return [...this.snapshots.values()];
  }

  async coalesce(key: string, operation: () => Promise<UsageSnapshot>): Promise<UsageSnapshot> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = operation()
      .then((snapshot) => {
        this.snapshots.set(key, snapshot);
        return snapshot;
      })
      .catch((error) => {
        const old = this.snapshots.get(key);
        if (!old) throw error;
        const stale: UsageSnapshot = {
          ...old,
          state: "stale",
          stale: true,
          error: error instanceof Error ? error.message : String(error),
        };
        this.snapshots.set(key, stale);
        return stale;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  clear(): void {
    this.snapshots.clear();
    this.pending.clear();
  }
}
