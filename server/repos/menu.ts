/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MenuItem, Topping } from '../../src/types.ts';
import { query, queryOne, transaction, Queryable, pool } from '../db/pool.ts';
import { compact } from './util.ts';
import { cached, invalidate } from '../cache.ts';

const MENU_KEY = 'menu:all';
const MENU_TTL = 5 * 60 * 1000;

function toMenuItem(r: any, extras: Topping[]): MenuItem {
  return compact({
    id: r.id,
    name: r.name,
    category: r.category,
    groupLabel: r.group_label,
    description: r.description,
    price: r.price,
    available: r.available,
    imageUrl: r.image_url,
    isVegetarian: r.is_vegetarian,
    isFasting: r.is_fasting,
    isSpecial: r.is_special,
    availableToppings: extras,
  });
}

async function extrasFor(ids: string[], client: Queryable): Promise<Map<string, Topping[]>> {
  const map = new Map<string, Topping[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return map;
  const rows = await query(
    'SELECT menu_item_id, extra_id, name, price FROM menu_item_extras WHERE menu_item_id = ANY($1) ORDER BY position',
    [ids],
    client
  );
  for (const r of rows) map.get(r.menu_item_id)?.push({ id: r.extra_id, name: r.name, price: r.price });
  return map;
}

async function loadMenu(client: Queryable): Promise<MenuItem[]> {
  const rows = await query('SELECT * FROM menu_items ORDER BY sort_order, created_at', [], client);
  const extras = await extrasFor(rows.map((r) => r.id), client);
  return rows.map((r) => toMenuItem(r, extras.get(r.id) || []));
}

/** The whole menu with extras. Cached; inside a transaction it always reads the database. */
export async function listMenu(client: Queryable = pool): Promise<MenuItem[]> {
  if (client !== pool) return loadMenu(client);
  return cached(MENU_KEY, MENU_TTL, () => loadMenu(pool));
}

export async function getMenuItem(id: string, client: Queryable = pool): Promise<MenuItem | null> {
  if (client === pool) return (await listMenu()).find((m) => m.id === id) ?? null; // served from the cached menu
  const row = await queryOne('SELECT * FROM menu_items WHERE id = $1', [id], client);
  if (!row) return null;
  const extras = await extrasFor([id], client);
  return toMenuItem(row, extras.get(id) || []);
}

/** Load several dishes at once (2 queries total, however many ids). Keyed by id; unknown ids are absent. */
export async function getMenuItems(ids: string[], client: Queryable = pool): Promise<Map<string, MenuItem>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  if (client === pool) {
    // From the cached menu: no database query at all
    const wanted = new Set(unique);
    return new Map((await listMenu()).filter((m) => wanted.has(m.id)).map((m) => [m.id, m]));
  }
  const rows = await query('SELECT * FROM menu_items WHERE id = ANY($1)', [unique], client);
  const extras = await extrasFor(rows.map((r) => r.id), client);
  return new Map(rows.map((r) => [r.id, toMenuItem(r, extras.get(r.id) || [])]));
}

async function writeExtras(itemId: string, extras: Topping[] | undefined, client: Queryable) {
  await query('DELETE FROM menu_item_extras WHERE menu_item_id = $1', [itemId], client);
  const seen = new Set<string>();
  const list = (extras || []).filter((t) => !seen.has(t.id) && seen.add(t.id)); // extra ids are unique per dish
  if (list.length === 0) return;
  // One INSERT for all extras instead of one per extra
  await query(
    `INSERT INTO menu_item_extras (menu_item_id, extra_id, name, price, position)
     SELECT $1, e.extra_id, e.name, e.price, e.position - 1
     FROM unnest($2::text[], $3::text[], $4::numeric[]) WITH ORDINALITY AS e(extra_id, name, price, position)`,
    [itemId, list.map((t) => t.id), list.map((t) => t.name), list.map((t) => t.price)],
    client
  );
}

/** Insert a dish. `sortOrder` defaults to the end of the menu. */
export async function insertMenuItem(item: MenuItem, client: Queryable, sortOrder?: number): Promise<void> {
  await query(
    `INSERT INTO menu_items
       (id, name, category, group_label, description, price, available, image_url,
        is_vegetarian, is_fasting, is_special, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             COALESCE($12, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM menu_items)))`,
    [
      item.id,
      item.name,
      item.category,
      item.groupLabel ?? null,
      item.description,
      item.price,
      item.available,
      item.imageUrl ?? null,
      !!item.isVegetarian,
      !!item.isFasting,
      !!item.isSpecial,
      sortOrder ?? null,
    ],
    client
  );
  await writeExtras(item.id, item.availableToppings, client);
}

export async function createMenuItem(item: MenuItem): Promise<MenuItem> {
  const created = await transaction(async (client) => {
    await insertMenuItem(item, client);
    return (await getMenuItem(item.id, client))!;
  });
  invalidate(MENU_KEY); // after commit, so nobody re-caches the old menu in between
  return created;
}

/** Replace a dish's details and extras. Returns null if it doesn't exist. */
export async function replaceMenuItem(item: MenuItem): Promise<MenuItem | null> {
  const saved = await transaction(async (client) => {
    const updated = await query(
      `UPDATE menu_items SET
         name = $2, category = $3, group_label = $4, description = $5, price = $6, available = $7,
         image_url = $8, is_vegetarian = $9, is_fasting = $10, is_special = $11, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [
        item.id,
        item.name,
        item.category,
        item.groupLabel ?? null,
        item.description,
        item.price,
        item.available,
        item.imageUrl ?? null,
        !!item.isVegetarian,
        !!item.isFasting,
        !!item.isSpecial,
      ],
      client
    );
    if (updated.length === 0) return null;
    await writeExtras(item.id, item.availableToppings, client);
    return getMenuItem(item.id, client);
  });
  invalidate(MENU_KEY);
  return saved;
}

export async function deleteMenuItem(id: string): Promise<MenuItem | null> {
  const before = await getMenuItem(id);
  if (!before) return null;
  await query('DELETE FROM menu_items WHERE id = $1', [id]);
  invalidate(MENU_KEY);
  return before;
}

export async function toggleMenuItem(id: string): Promise<MenuItem | null> {
  const row = await queryOne(
    'UPDATE menu_items SET available = NOT available, updated_at = now() WHERE id = $1 RETURNING id',
    [id]
  );
  invalidate(MENU_KEY);
  return row ? getMenuItem(id) : null;
}

export async function menuIsEmpty(client: Queryable = pool): Promise<boolean> {
  const row = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM menu_items', [], client);
  return !row || row.n === 0;
}
