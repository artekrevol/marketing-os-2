/**
 * In-memory TTL cache for DataForSEO responses. Keyed by
 * `(endpoint, query-fingerprint)` with a 7-day default TTL.
 *
 * Scope is per-process: a cache instance lives on a DataForSEOClient
 * and is shared across that client's calls. It exists to avoid paying
 * for repeat lookups of slow-moving data (search volume, keyword
 * ideas, ranked keywords). Live SERP rank tracking deliberately does
 * NOT cache — each snapshot must reflect current rankings.
 */
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/** Deterministic JSON stringify with object keys sorted recursively. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export class TtlCache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly defaultTtlMs: number = SEVEN_DAYS_MS) {}

  /**
   * Build a stable cache key from an endpoint and its query params.
   * Param ordering and key ordering are normalised so semantically
   * identical queries collapse to the same key.
   */
  static fingerprint(endpoint: string, params: unknown): string {
    return `${endpoint}::${stableStringify(params)}`;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  clear(): void {
    this.store.clear();
  }
}
