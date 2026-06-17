/**
 * Redis mock/setup utilities for testing.
 * Provides an in-memory Redis mock and connection helpers for integration tests.
 */

export interface RedisTestConfig {
  host: string;
  port: number;
}

const DEFAULT_REDIS_CONFIG: RedisTestConfig = {
  host: process.env['TEST_REDIS_HOST'] ?? 'localhost',
  port: parseInt(process.env['TEST_REDIS_PORT'] ?? '6379', 10),
};

/**
 * Returns Redis test configuration.
 */
export function getTestRedisConfig(overrides?: Partial<RedisTestConfig>): RedisTestConfig {
  return { ...DEFAULT_REDIS_CONFIG, ...overrides };
}

/**
 * Returns a Redis connection URL for test environment.
 */
export function getTestRedisUrl(config?: Partial<RedisTestConfig>): string {
  const c = getTestRedisConfig(config);
  return `redis://${c.host}:${c.port}`;
}

/**
 * In-memory Redis mock for unit tests.
 * Supports basic operations: get, set, del, keys, ping, xadd, xread, expire, ttl.
 */
export class RedisMock {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  private streams = new Map<string, Array<{ id: string; fields: Record<string, string> }>>();
  private _connected = true;

  get connected(): boolean {
    return this._connected;
  }

  async ping(): Promise<string> {
    this.assertConnected();
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    this.assertConnected();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, options?: { EX?: number }): Promise<'OK'> {
    this.assertConnected();
    const expiresAt = options?.EX ? Date.now() + options.EX * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    this.assertConnected();
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted++;
    }
    return deleted;
  }

  async keys(pattern: string): Promise<string[]> {
    this.assertConnected();
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return Array.from(this.store.keys()).filter((k) => regex.test(k));
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.assertConnected();
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    this.assertConnected();
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (!entry.expiresAt) return -1;
    const remaining = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async xadd(
    stream: string,
    id: string,
    fields: Record<string, string>
  ): Promise<string> {
    this.assertConnected();
    if (!this.streams.has(stream)) {
      this.streams.set(stream, []);
    }
    const entryId = id === '*' ? `${Date.now()}-0` : id;
    this.streams.get(stream)!.push({ id: entryId, fields });
    return entryId;
  }

  async xread(
    stream: string,
    fromId: string = '0'
  ): Promise<Array<{ id: string; fields: Record<string, string> }>> {
    this.assertConnected();
    const entries = this.streams.get(stream) ?? [];
    if (fromId === '0') return entries;
    const fromIdx = entries.findIndex((e) => e.id === fromId);
    return fromIdx === -1 ? entries : entries.slice(fromIdx + 1);
  }

  async xlen(stream: string): Promise<number> {
    this.assertConnected();
    return (this.streams.get(stream) ?? []).length;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    this.assertConnected();
    const existing = this.store.get(key);
    const hash: Record<string, string> = existing ? JSON.parse(existing.value) : {};
    const isNew = !(field in hash);
    hash[field] = value;
    this.store.set(key, { value: JSON.stringify(hash), expiresAt: existing?.expiresAt });
    return isNew ? 1 : 0;
  }

  async hget(key: string, field: string): Promise<string | null> {
    this.assertConnected();
    const entry = this.store.get(key);
    if (!entry) return null;
    const hash: Record<string, string> = JSON.parse(entry.value);
    return hash[field] ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    this.assertConnected();
    const entry = this.store.get(key);
    if (!entry) return {};
    return JSON.parse(entry.value);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    this.assertConnected();
    const entry = this.store.get(key);
    if (!entry) return 0;
    const hash: Record<string, string> = JSON.parse(entry.value);
    let deleted = 0;
    for (const field of fields) {
      if (field in hash) {
        delete hash[field];
        deleted++;
      }
    }
    this.store.set(key, { value: JSON.stringify(hash), expiresAt: entry.expiresAt });
    return deleted;
  }

  /**
   * Flush all data (equivalent to FLUSHALL).
   */
  async flushall(): Promise<'OK'> {
    this.store.clear();
    this.streams.clear();
    return 'OK';
  }

  /**
   * Simulate disconnect for testing error scenarios.
   */
  disconnect(): void {
    this._connected = false;
  }

  /**
   * Simulate reconnect.
   */
  reconnect(): void {
    this._connected = true;
  }

  private assertConnected(): void {
    if (!this._connected) {
      throw new Error('Redis connection is closed');
    }
  }
}

/**
 * Creates a fresh RedisMock instance for testing.
 */
export function createRedisMock(): RedisMock {
  return new RedisMock();
}
