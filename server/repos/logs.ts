/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuditLog, NotificationLog } from '../../src/types.ts';
import { query, Queryable, pool } from '../db/pool.ts';
import { compact, iso, newId } from './util.ts';

// ---------- Audit log: who did what ----------

function toAudit(r: any): AuditLog {
  return compact({
    id: r.id,
    adminId: r.admin_id,
    adminName: r.admin_name,
    action: r.action,
    relatedOrderId: r.related_order_id,
    previousValue: r.previous_value,
    newValue: r.new_value,
    timestamp: iso(r.created_at)!,
  });
}

export async function addAudit(
  entry: Omit<AuditLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
  client: Queryable = pool
): Promise<void> {
  await query(
    `INSERT INTO audit_logs (id, admin_id, admin_name, action, related_order_id, previous_value, new_value, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))`,
    [
      entry.id || newId('log'),
      entry.adminId,
      entry.adminName,
      entry.action,
      entry.relatedOrderId ?? null,
      entry.previousValue ?? null,
      entry.newValue ?? null,
      entry.timestamp ?? null,
    ],
    client
  );
}

export async function listAudit(limit = 500): Promise<AuditLog[]> {
  const rows = await query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(toAudit);
}

export async function auditForOrder(orderId: string): Promise<AuditLog[]> {
  const rows = await query('SELECT * FROM audit_logs WHERE related_order_id = $1 ORDER BY created_at DESC', [orderId]);
  return rows.map(toAudit);
}

// ---------- Notification log: Teams / email / sound alerts ----------

function toNotification(r: any): NotificationLog {
  return compact({
    id: r.id,
    orderId: r.order_id,
    orderNumber: r.order_number,
    channel: r.channel,
    title: r.title,
    message: r.message,
    timestamp: iso(r.created_at)!,
    status: r.status,
    recipient: r.recipient,
    error: r.error,
  });
}

export async function addNotification(
  entry: Omit<NotificationLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
  client: Queryable = pool
): Promise<string> {
  const id = entry.id || newId(entry.channel === 'email' ? 'email' : 'notif');
  await query(
    `INSERT INTO notification_logs (id, order_id, order_number, channel, title, message, status, recipient, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()))`,
    [
      id,
      entry.orderId,
      entry.orderNumber,
      entry.channel,
      entry.title,
      entry.message,
      entry.status,
      entry.recipient ?? null,
      entry.error ?? null,
      entry.timestamp ?? null,
    ],
    client
  );
  return id;
}

export async function setNotificationStatus(id: string, status: NotificationLog['status'], error?: string): Promise<void> {
  await query('UPDATE notification_logs SET status = $2, error = $3 WHERE id = $1', [id, status, error ?? null]);
}

export async function listNotifications(limit = 500): Promise<NotificationLog[]> {
  const rows = await query('SELECT * FROM notification_logs ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(toNotification);
}
