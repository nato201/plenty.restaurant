/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RestaurantSettings } from '../../src/types.ts';
import { INITIAL_SETTINGS } from '../../src/data/initialData.ts';
import { query, queryOne, Queryable, pool } from '../db/pool.ts';
import { cached, invalidate } from '../cache.ts';

const SETTINGS_KEY = 'settings';
const SETTINGS_TTL = 5 * 60 * 1000;

async function loadSettings(client: Queryable): Promise<RestaurantSettings> {
  const row = await queryOne<{ data: Partial<RestaurantSettings> }>(
    'SELECT data FROM restaurant_settings WHERE id = 1',
    [],
    client
  );
  return { ...INITIAL_SETTINGS, ...(row?.data || {}) };
}

/**
 * Current settings, with defaults filled in for any key added since they were saved.
 * Cached; inside a transaction (a `client` is passed) it always reads the database.
 */
export async function getSettings(client: Queryable = pool): Promise<RestaurantSettings> {
  if (client !== pool) return loadSettings(client);
  return cached(SETTINGS_KEY, SETTINGS_TTL, () => loadSettings(pool));
}

/** Merge changes into the saved settings and return the result. */
export async function updateSettings(changes: Partial<RestaurantSettings>, client: Queryable = pool): Promise<RestaurantSettings> {
  const row = await queryOne<{ data: Partial<RestaurantSettings> }>(
    `INSERT INTO restaurant_settings (id, data, updated_at) VALUES (1, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = restaurant_settings.data || EXCLUDED.data, updated_at = now()
     RETURNING data`,
    [JSON.stringify(changes)],
    client
  );
  invalidate(SETTINGS_KEY);
  return { ...INITIAL_SETTINGS, ...(row?.data || {}) };
}

export async function ensureSettings(client: Queryable = pool): Promise<void> {
  await query(
    `INSERT INTO restaurant_settings (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(INITIAL_SETTINGS)],
    client
  );
  invalidate(SETTINGS_KEY);
}
