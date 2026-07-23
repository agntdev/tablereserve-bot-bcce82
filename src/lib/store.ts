/**
 * Durable key-value store for domain data (bookings, settings, inventory).
 * Redis when REDIS_URL is set; in-memory fallback for the test harness / dev.
 * Never scan the keyspace — callers maintain explicit index records.
 */

export interface DurableStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
}

class MemoryDurableStore implements DurableStore {
  private readonly data = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }

  /** Test helper — wipe all keys between specs if needed. */
  clear(): void {
    this.data.clear();
  }
}

class RedisDurableStore implements DurableStore {
  constructor(
    private readonly client: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<unknown>;
      del(key: string): Promise<unknown>;
    },
    private readonly prefix = "tr:",
  ) {}

  private k(key: string): string {
    return this.prefix + key;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(this.k(key));
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.client.set(this.k(key), JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.k(key));
  }
}

const memorySingleton = new MemoryDurableStore();
let resolved: DurableStore | null = null;
let resolving: Promise<DurableStore> | null = null;

async function resolveStore(): Promise<DurableStore> {
  if (resolved) return resolved;
  if (resolving) return resolving;
  resolving = (async () => {
    const url =
      typeof process !== "undefined" ? process.env.REDIS_URL : undefined;
    if (url) {
      try {
        const { createRequire } = await import("node:module");
        const require = createRequire(import.meta.url);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ioredis: any = require("ioredis");
        const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
        const client = new Redis(url, {
          maxRetriesPerRequest: null,
          lazyConnect: false,
        });
        resolved = new RedisDurableStore(client);
        return resolved;
      } catch {
        // Fall through to memory if Redis cannot be reached at runtime.
      }
    }
    resolved = memorySingleton;
    return resolved;
  })();
  return resolving;
}

/** Get the shared durable store (lazy-resolved). */
export async function getStore(): Promise<DurableStore> {
  return resolveStore();
}

/**
 * Reset the in-memory backend (tests only). No-op for Redis.
 * Call between specs so durable data does not leak across dialogs.
 */
export async function resetMemoryStore(): Promise<void> {
  const s = await getStore();
  if (s === memorySingleton || s instanceof MemoryDurableStore) {
    memorySingleton.clear();
  }
  // Force re-resolve next time if someone swapped backends in tests.
  if (resolved === memorySingleton) {
    /* keep memory */
  }
}

/** Force a specific store (tests). */
export function _setStoreForTests(store: DurableStore | null): void {
  resolved = store;
  resolving = store ? Promise.resolve(store) : null;
  if (store === null) {
    memorySingleton.clear();
  }
}
