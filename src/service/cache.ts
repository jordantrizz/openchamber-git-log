// One refresh per project directory, shared by every request, kept for a few
// seconds. Concurrent callers share the in-flight promise (single flight), and
// Refresh drops the entry so the next read rebuilds it.

export const CACHE_TTL_MS = 10_000;

interface Entry<T> {
  at: number;
  value: Promise<T>;
}

export class SnapshotCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs: number = CACHE_TTL_MS, now: () => number = () => Date.now()) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && this.now() - existing.at < this.ttlMs) return existing.value;

    const value = load().catch((error: unknown) => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { at: this.now(), value });
    return value;
  }

  invalidate(key?: string): void {
    if (key === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(key);
  }
}
