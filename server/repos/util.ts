/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';

/** Prefixed random id, e.g. newId('log') → 'log-mf3k2a-9f2c1b7d' */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

/** timestamptz → ISO string (or undefined), matching the JSON the API always returned */
export function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Drop undefined/null so API objects look the same as before (no `"field": null`). */
export function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] === undefined || obj[key] === null) delete obj[key];
  }
  return obj;
}

/**
 * Build "col1 = $1, col2 = $2" for the fields present in `patch`, using `columns` to map
 * API field names to database columns. Unknown fields are ignored.
 */
export function buildSet(
  patch: Record<string, unknown>,
  columns: Record<string, string>,
  startIndex = 1
): { sql: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const [field, column] of Object.entries(columns)) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      values.push(patch[field] === undefined ? null : patch[field]);
      parts.push(`${column} = $${startIndex + values.length - 1}`);
    }
  }
  return { sql: parts.join(', '), values };
}
