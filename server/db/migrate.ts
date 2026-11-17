/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { pool } from './pool.ts';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'server/db/migrations');

/**
 * Apply any .sql files in server/db/migrations that haven't run yet, in name order.
 * Each file runs in its own transaction. A Postgres advisory lock stops two servers
 * starting at the same time from migrating twice.
 */
export async function runMigrations(): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['plenty_migrations']);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const done = new Set(
      (await client.query('SELECT name FROM schema_migrations')).rows.map((r: { name: string }) => r.name)
    );
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['plenty_migrations']).catch(() => {});
    client.release();
  }
  return applied;
}
