/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdminRole, AdminUser } from '../../src/types.ts';
import { query, queryOne, Queryable, pool } from '../db/pool.ts';
import { compact, iso } from './util.ts';
import { cached, invalidate } from '../cache.ts';

// Staff accounts are read on every staff request (the session check). Any change to an account
// clears the cache at once, so a deactivated user or changed password takes effect immediately.
const STAFF_TTL = 60 * 1000;

/** A staff account as stored, including the password hash. Never send this to a client. */
export type StaffRecord = AdminUser & { passwordHash?: string };

function toStaff(r: any): StaffRecord {
  return compact({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    isActive: r.is_active,
    lastLogin: iso(r.last_login_at),
    createdAt: iso(r.created_at)!,
    passwordHash: r.password_hash,
  });
}

/** Strip the password hash before an account leaves the server. */
export function publicStaff(s: StaffRecord): AdminUser {
  const { passwordHash: _omit, ...rest } = s;
  return rest;
}

export async function listStaff(): Promise<StaffRecord[]> {
  return cached('staff:list', STAFF_TTL, async () => (await query('SELECT * FROM staff_users ORDER BY created_at')).map(toStaff));
}

async function loadStaffById(id: string, client: Queryable): Promise<StaffRecord | null> {
  const row = await queryOne('SELECT * FROM staff_users WHERE id = $1', [id], client);
  return row ? toStaff(row) : null;
}

export async function findStaffById(id: string, client: Queryable = pool): Promise<StaffRecord | null> {
  if (client !== pool) return loadStaffById(id, client);
  return cached(`staff:id:${id}`, STAFF_TTL, () => loadStaffById(id, pool));
}

export async function findStaffByEmail(email: string, client: Queryable = pool): Promise<StaffRecord | null> {
  const row = await queryOne('SELECT * FROM staff_users WHERE lower(email) = lower($1)', [email.trim()], client);
  return row ? toStaff(row) : null;
}

export async function insertStaff(
  s: { id: string; name: string; email: string; role: AdminRole; isActive: boolean; passwordHash?: string | null; lastLogin?: string; createdAt?: string },
  client: Queryable = pool
): Promise<StaffRecord> {
  const row = await queryOne(
    `INSERT INTO staff_users (id, name, email, role, is_active, password_hash, last_login_at, created_at)
     VALUES ($1, $2, lower($3), $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
     RETURNING *`,
    [s.id, s.name, s.email, s.role, s.isActive, s.passwordHash ?? null, s.lastLogin ?? null, s.createdAt ?? null],
    client
  );
  invalidate('staff:');
  return toStaff(row);
}

export async function updateStaff(
  id: string,
  changes: { name?: string; role?: AdminRole; isActive?: boolean },
  client: Queryable = pool
): Promise<StaffRecord | null> {
  const row = await queryOne(
    `UPDATE staff_users SET
       name = COALESCE($2, name),
       role = COALESCE($3, role),
       is_active = COALESCE($4, is_active)
     WHERE id = $1 RETURNING *`,
    [id, changes.name ?? null, changes.role ?? null, changes.isActive ?? null],
    client
  );
  invalidate('staff:');
  return row ? toStaff(row) : null;
}

export async function setStaffPassword(id: string, passwordHash: string, client: Queryable = pool): Promise<void> {
  await query('UPDATE staff_users SET password_hash = $2 WHERE id = $1', [id, passwordHash], client);
  invalidate('staff:');
}

export async function recordStaffLogin(id: string): Promise<void> {
  await query('UPDATE staff_users SET last_login_at = now() WHERE id = $1', [id]);
  invalidate('staff:');
}

export async function anySuperAdminCanSignIn(): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM staff_users WHERE role = 'super_admin' AND is_active AND password_hash IS NOT NULL`
  );
  return !!row && row.n > 0;
}

export async function firstActiveSuperAdmin(): Promise<StaffRecord | null> {
  const row = await queryOne(
    `SELECT * FROM staff_users WHERE role = 'super_admin' AND is_active ORDER BY created_at LIMIT 1`
  );
  return row ? toStaff(row) : null;
}
