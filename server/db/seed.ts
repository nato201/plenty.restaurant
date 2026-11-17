/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { INITIAL_MENU_ITEMS, INITIAL_SETTINGS, INITIAL_ADMIN_USERS } from '../../src/data/initialData.ts';
import { AuditLog, NotificationLog } from '../../src/types.ts';
import { transaction, query, queryOne } from './pool.ts';
import { insertMenuItem } from '../repos/menu.ts';
import { insertStaff } from '../repos/staff.ts';
import { insertOrder, insertPayment, insertPendingCheckout } from '../repos/orders.ts';
import { addAudit, addNotification } from '../repos/logs.ts';
import { updateSettings } from '../repos/settings.ts';

const LEGACY_FILE = path.resolve(process.cwd(), 'data', 'plenty_db.json');

/** Make ids unique: the old JSON store could create two log entries in the same millisecond. */
function uniqueIds<T extends { id: string }>(list: T[]): T[] {
  const seen = new Map<string, number>();
  return list.map((entry) => {
    const n = seen.get(entry.id) ?? 0;
    seen.set(entry.id, n + 1);
    return n === 0 ? entry : { ...entry, id: `${entry.id}-${n}` };
  });
}

/**
 * Fill an empty database. If the old data/plenty_db.json exists, everything in it is imported
 * (menu, settings, staff accounts with their passwords, orders, payments, logs). Otherwise the
 * starter menu, settings and staff list are used. Does nothing once the database has data.
 */
export async function seedIfEmpty(): Promise<'imported' | 'seeded' | 'skipped'> {
  const existing = await queryOne<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM menu_items) + (SELECT COUNT(*) FROM orders) + (SELECT COUNT(*) FROM staff_users) AS n`
  );
  if (existing && existing.n > 0) return 'skipped';

  if (fs.existsSync(LEGACY_FILE)) {
    await importLegacyJson(JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8')));
    return 'imported';
  }

  await transaction(async (client) => {
    await updateSettings(INITIAL_SETTINGS, client);
    let order = 0;
    for (const item of INITIAL_MENU_ITEMS) await insertMenuItem(item, client, order++);
    for (const u of INITIAL_ADMIN_USERS) {
      await insertStaff({ id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, createdAt: u.createdAt }, client);
    }
  });
  return 'seeded';
}

async function importLegacyJson(old: any) {
  await transaction(async (client) => {
    await updateSettings({ ...INITIAL_SETTINGS, ...(old.settings || {}) }, client);

    let sort = 0;
    const menu = Array.isArray(old.menuItems) && old.menuItems.length ? old.menuItems : INITIAL_MENU_ITEMS;
    for (const item of menu) await insertMenuItem(item, client, sort++);

    const credentials: Record<string, string> = old.staffCredentials || {};
    const staff = Array.isArray(old.adminUsers) && old.adminUsers.length ? old.adminUsers : INITIAL_ADMIN_USERS;
    const seenEmails = new Set<string>();
    for (const u of staff) {
      const email = String(u.email || '').toLowerCase();
      if (!email || seenEmails.has(email)) continue;
      seenEmails.add(email);
      await insertStaff(
        {
          id: u.id,
          name: u.name,
          email,
          role: u.role,
          isActive: u.isActive !== false,
          passwordHash: credentials[u.id] ?? null,
          lastLogin: u.lastLogin,
          createdAt: u.createdAt,
        },
        client
      );
    }

    // Orders first (payments reference them), oldest first so ids/sequence stay sensible
    const orders = [...(old.orders || [])].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const orderIds = new Set<string>();
    for (const o of orders) {
      await insertOrder({ ...o, items: o.items || [] }, client);
      orderIds.add(o.id);
    }

    for (const p of old.payments || []) {
      await insertPayment({ ...p, orderId: p.orderId && orderIds.has(p.orderId) ? p.orderId : undefined }, client);
    }

    const paymentRefs = new Set((old.payments || []).map((p: any) => p.txRef));
    for (const [txRef, prov] of Object.entries<any>(old.provisionalOrders || {})) {
      if (!paymentRefs.has(txRef)) continue;
      await insertPendingCheckout(
        {
          txRef,
          customer: prov.customer,
          pickup: prov.pickup,
          items: prov.items,
          subtotal: prov.subtotal,
          taxOrFees: prov.taxOrFees ?? 0,
          totalAmount: prov.totalAmount,
        },
        client
      );
    }

    for (const l of uniqueIds<AuditLog>(old.auditLogs || [])) await addAudit(l, client);
    for (const n of uniqueIds<NotificationLog>(old.notificationLogs || [])) await addNotification(n, client);

    // Continue order numbers after the highest one imported (e.g. #PLT-2026-0108 → next is 109)
    const maxNumber = orders.reduce((max: number, o: any) => {
      const m = /(\d+)$/.exec(String(o.orderNumber || ''));
      return m ? Math.max(max, Number(m[1])) : max;
    }, 100);
    await query(`SELECT setval('order_number_seq', $1)`, [maxNumber], client);
  });
}
