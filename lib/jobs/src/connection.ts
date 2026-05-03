import IORedis, { type Redis, type RedisOptions } from "ioredis";

let _conn: Redis | null = null;

/**
 * One Redis connection multiplexed across every Queue and Worker. BullMQ
 * requires `maxRetriesPerRequest: null` so blocking commands can wait
 * indefinitely. `enableReadyCheck: false` avoids spurious READONLY
 * errors against Upstash's connection-pool replicas.
 *
 * Fails fast if REDIS_URL is missing.
 */
export function getRedisConnection(): Redis {
  if (_conn) return _conn;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is required (Upstash connection string).");
  }
  const opts: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  };
  _conn = new IORedis(url, opts);
  return _conn;
}

/** Close the shared connection. Used by graceful shutdown handlers. */
export async function closeRedisConnection(): Promise<void> {
  if (!_conn) return;
  try {
    await _conn.quit();
  } catch {
    _conn.disconnect();
  }
  _conn = null;
}
