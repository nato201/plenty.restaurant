/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A small in-memory cache for data that rarely changes (settings, menu, staff accounts).
 *
 * - Writes clear the affected keys immediately (see the repos), so staff never see stale data
 *   on this server. The TTL is only a safety net, e.g. if someone edits the database by hand,
 *   or if the app is ever run as several servers (each has its own cache).
 * - Every read returns a fresh copy, so a caller changing the object can't corrupt the cache.
 * - Concurrent misses share one database query instead of each running their own.
 */

interface Entry<T> {
  value: T;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
/** Bumped on every invalidation, so a load that started before a write can't refill stale data. */
let generation = 0;

export const stats = { hits: 0, misses: 0 };

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) {
    stats.hits++;
    return structuredClone(hit.value as T);
  }
  stats.misses++;
  let pending = inflight.get(key) as Promise<T> | undefined;
  if (!pending) {
    const startedAt = generation;
    pending = load()
      .then((value) => {
        if (startedAt === generation) store.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return structuredClone(await pending);
}

/** Drop every key that starts with one of the prefixes (e.g. 'menu:' or 'staff:'). */
export function invalidate(...prefixes: string[]): void {
  generation++;
  for (const key of [...store.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) store.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) inflight.delete(key);
  }
}

export function clearCache(): void {
  invalidate('');
}
