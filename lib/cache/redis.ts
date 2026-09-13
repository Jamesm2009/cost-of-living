**
 * lib/cache/redis.ts
 *
 * Upstash Redis cache for the external data feeds (Census, HUD, Zillow, BLS,
 * EIA). Upstash speaks HTTP rather than the Redis TCP protocol, so it works in
 * every Vercel runtime with no connection pooling and no singleton dance.
 *
 * Requires: npm install @upstash/redis
 *
 * Environment variables (set in Vercel → Settings → Environment Variables,
 * and in .env.local for development — never commit them):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Both are shown in the Upstash console under your database's REST API tab.
 */

import { Redis } from '@upstash/redis';

let client: Redis | null = null;

/**
 * Lazily created so that importing this module doesn't throw during a build
 * step where the env vars aren't present.
 */
function redis(): Redis {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN. ' +
        'Add them in Vercel → Settings → Environment Variables, or in .env.local.',
    );
  }

  client = new Redis({ url, token });
  return client;
}

/** Namespaced key so one Upstash database can serve several projects. */
const NAMESPACE = 'costcompare';
const key = (...parts: string[]) => [NAMESPACE, ...parts].join(':');

export interface CachedEntry<T> {
  data: T;
  /** ISO timestamp of when this was fetched. Show it in the UI. */
  fetchedAt: string;
  /** Which upstream API produced it. */
  source: string;
}

/**
 * Read a cached value. Returns null on a miss OR on any Redis error — a cache
 * outage should degrade to a slow page, never a broken one.
 */
export async function getCached<T>(
  name: string,
): Promise<CachedEntry<T> | null> {
  try {
    return await redis().get<CachedEntry<T>>(key('data', name));
  } catch (err) {
    console.error(`[cache] read failed for ${name}:`, err);
    return null;
  }
}

/** Write a value with a TTL in seconds. Defaults to 8 days. */
export async function setCached<T>(
  name: string,
  data: T,
  source: string,
  ttlSeconds = 8 * 24 * 60 * 60,
): Promise<void> {
  const entry: CachedEntry<T> = {
    data,
    fetchedAt: new Date().toISOString(),
    source,
  };
  try {
    await redis().set(key('data', name), entry, { ex: ttlSeconds });
  } catch (err) {
    console.error(`[cache] write failed for ${name}:`, err);
  }
}

/**
 * Fetch-through cache. Returns cached data when fresh, otherwise calls
 * `fetcher` and stores the result.
 *
 * If the fetcher throws but stale data exists, the stale data is returned.
 * A government API being down should not blank out your comparison.
 */
export async function cached<T>(
  name: string,
  source: string,
  fetcher: () => Promise<T>,
  opts: { ttlSeconds?: number; forceRefresh?: boolean } = {},
): Promise<CachedEntry<T>> {
  const existing = opts.forceRefresh ? null : await getCached<T>(name);
  if (existing) return existing;

  try {
    const data = await fetcher();
    await setCached(name, data, source, opts.ttlSeconds);
    return { data, fetchedAt: new Date().toISOString(), source };
  } catch (err) {
    const stale = await getCached<T>(name);
    if (stale) {
      console.warn(`[cache] ${name} fetch failed; serving stale data.`, err);
      return stale;
    }
    throw err;
  }
}

/** Age in hours, for a "last updated" line in the UI. */
export function ageHours(entry: CachedEntry<unknown>): number {
  return (Date.now() - Date.parse(entry.fetchedAt)) / 3_600_000;
}

/** Drop one cached feed. Useful from an admin route or a script. */
export async function invalidate(name: string): Promise<void> {
  try {
    await redis().del(key('data', name));
  } catch (err) {
    console.error(`[cache] invalidate failed for ${name}:`, err);
  }
}
