/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import pg from 'pg';

// NUMERIC (money) comes back as a string by default; the app works in plain numbers.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)) as any);
// DATE stays a 'YYYY-MM-DD' string so it never shifts with the server's time zone.
pg.types.setTypeParser(1082, (v) => v);
// BIGINT counts (e.g. COUNT(*)) are small enough to be numbers.
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)) as any);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Add it to .env, e.g. DATABASE_URL="postgresql://user:password@localhost:5432/plenty"'
  );
}

export const pool = new pg.Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
  // Hosted Postgres (Neon, Supabase, RDS…) needs TLS; set DATABASE_SSL=true there.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  // An idle client lost its connection (e.g. the database restarted). The pool replaces it.
  console.error('[db] idle client error:', err.message);
});

export type Queryable = pg.Pool | pg.PoolClient;

export async function query<T = any>(text: string, params: unknown[] = [], client: Queryable = pool): Promise<T[]> {
  const result = await client.query(text, params as any[]);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params: unknown[] = [], client: Queryable = pool): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

/** Run work in a single transaction; rolls back automatically if it throws. */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
