/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Order, OrderItem, Payment } from '../../src/types.ts';
import { query, queryOne, Queryable, pool } from '../db/pool.ts';
import { buildSet, compact, iso } from './util.ts';
import { serviceOf } from '../../src/utils/service.ts';

// =====================================================================
// Orders
// =====================================================================

function toOrder(r: any, items: OrderItem[]): Order {
  return compact({
    id: r.id,
    orderNumber: r.order_number,
    customer: {
      firstName: r.customer_first_name,
      lastName: r.customer_last_name,
      email: r.customer_email,
      phoneNumber: r.customer_phone,
    },
    pickup: compact({
      pickupDate: r.pickup_date,
      pickupTime: r.pickup_time,
      serviceType: r.service_type ?? 'delivery',
      floorNumber: r.floor_number,
      specialInstructions: r.special_instructions,
    }),
    items,
    subtotal: r.subtotal,
    taxOrFees: r.tax_or_fees,
    totalAmount: r.total_amount,
    status: r.status,
    paymentId: r.payment_id ?? '',
    paymentStatus: r.payment_status,
    estimatedPrepMinutes: r.estimated_prep_minutes,
    estimatedReadyTime: r.estimated_ready_time,
    acceptedAt: iso(r.accepted_at),
    declinedReason: r.declined_reason,
    declinedAt: iso(r.declined_at),
    cancellationReason: r.cancellation_reason,
    cancelledAt: iso(r.cancelled_at),
    completedAt: iso(r.completed_at),
    soundAlertDismissed: r.sound_alert_dismissed,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  }) as Order;
}

function toOrderItem(r: any): OrderItem {
  return {
    menuItemId: r.menu_item_id,
    name: r.name,
    unitPrice: r.unit_price,
    quantity: r.quantity,
    selectedToppings: r.selected_extras || [],
    specialNotes: r.special_notes ?? '',
    totalPrice: r.total_price,
  };
}

/** Load orders with their items using two queries, keeping the given row order. */
async function hydrate(rows: any[], client: Queryable): Promise<Order[]> {
  if (rows.length === 0) return [];
  const itemRows = await query(
    'SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY order_id, position',
    [rows.map((r) => r.id)],
    client
  );
  const byOrder = new Map<string, OrderItem[]>();
  for (const it of itemRows) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id)!.push(toOrderItem(it));
  }
  return rows.map((r) => toOrder(r, byOrder.get(r.id) || []));
}

export interface OrderFilters {
  status?: string;
  paymentStatus?: string;
  date?: string;
  floor?: string;
  search?: string;
  limit?: number;
}

export async function listOrders(f: OrderFilters = {}): Promise<Order[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (f.status && f.status !== 'all') add('status = ?', f.status);
  if (f.paymentStatus && f.paymentStatus !== 'all') add('payment_status = ?', f.paymentStatus);
  if (f.date) add('pickup_date = ?::date', f.date);
  if (f.floor === 'dine_in') where.push(`service_type = 'dine_in'`);
  else if (f.floor && f.floor !== 'all') add('floor_number = ?::smallint', Number(f.floor));
  if (f.search && f.search.trim()) {
    params.push(`%${f.search.trim().toLowerCase()}%`);
    const p = `$${params.length}`;
    // Must match orders_search_trgm_idx exactly so the index is used
    where.push(
      `lower(order_number || ' ' || customer_first_name || ' ' || customer_last_name || ' ' || customer_email || ' ' || customer_phone) LIKE ${p}`
    );
  }

  params.push(Math.min(Math.max(f.limit ?? 1000, 1), 5000));
  const rows = await query(
    `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return hydrate(rows, pool);
}

export async function getOrder(id: string, client: Queryable = pool, forUpdate = false): Promise<Order | null> {
  const row = await queryOne(`SELECT * FROM orders WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id], client);
  return row ? (await hydrate([row], client))[0] : null;
}

/** Find by id or by order number (case-insensitive), for the staff order detail view. */
export async function getOrderByIdOrNumber(idOrNumber: string): Promise<Order | null> {
  const row = await queryOne('SELECT * FROM orders WHERE id = $1 OR upper(order_number) = upper($1) LIMIT 1', [idOrNumber]);
  return row ? (await hydrate([row], pool))[0] : null;
}

/** Customer lookup: needs both the order number and the email used at checkout. */
export async function findCustomerOrder(orderNumber: string, email: string): Promise<Order | null> {
  const row = await queryOne(
    'SELECT * FROM orders WHERE upper(order_number) = upper($1) AND lower(customer_email) = lower($2)',
    [orderNumber, email.trim()]
  );
  return row ? (await hydrate([row], pool))[0] : null;
}

const ACTIVE = `status NOT IN ('declined', 'cancelled')`;

export async function countActiveInSlot(date: string, time: string, client: Queryable = pool): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM orders WHERE pickup_date = $1::date AND pickup_time = $2 AND ${ACTIVE}`,
    [date, time],
    client
  );
  return row?.n ?? 0;
}

/** Bookings per slot label for one day, plus the day's total. */
export async function slotBookings(date: string): Promise<{ total: number; bySlot: Map<string, number> }> {
  const rows = await query<{ pickup_time: string; n: number }>(
    `SELECT pickup_time, COUNT(*) AS n FROM orders WHERE pickup_date = $1::date AND ${ACTIVE} GROUP BY pickup_time`,
    [date]
  );
  const bySlot = new Map(rows.map((r) => [r.pickup_time, r.n]));
  return { total: rows.reduce((s, r) => s + r.n, 0), bySlot };
}

/** Next human-friendly order number, e.g. #PLT-2026-0108. Backed by a sequence, so never duplicated. */
export async function nextOrderNumber(client: Queryable): Promise<string> {
  const row = await queryOne<{ n: number }>(`SELECT nextval('order_number_seq') AS n`, [], client);
  return `#PLT-${new Date().getFullYear()}-${String(row!.n).padStart(4, '0')}`;
}

export async function insertOrder(order: Order, client: Queryable): Promise<void> {
  await query(
    `INSERT INTO orders (
       id, order_number, customer_first_name, customer_last_name, customer_email, customer_phone,
       pickup_date, pickup_time, floor_number, special_instructions,
       subtotal, tax_or_fees, total_amount, status, payment_status, payment_id,
       estimated_prep_minutes, estimated_ready_time, accepted_at, declined_reason, declined_at,
       cancellation_reason, cancelled_at, completed_at, sound_alert_dismissed, created_at, updated_at, service_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
             COALESCE($26::timestamptz, now()), COALESCE($27::timestamptz, now()), $28)`,
    [
      order.id,
      order.orderNumber,
      order.customer.firstName,
      order.customer.lastName ?? '',
      order.customer.email,
      order.customer.phoneNumber,
      order.pickup.pickupDate,
      order.pickup.pickupTime,
      serviceOf(order.pickup) === 'dine_in' ? null : order.pickup.floorNumber,
      order.pickup.specialInstructions ?? null,
      order.subtotal,
      order.taxOrFees ?? 0,
      order.totalAmount,
      order.status,
      order.paymentStatus,
      order.paymentId || null,
      order.estimatedPrepMinutes ?? null,
      order.estimatedReadyTime ?? null,
      order.acceptedAt ?? null,
      order.declinedReason ?? null,
      order.declinedAt ?? null,
      order.cancellationReason ?? null,
      order.cancelledAt ?? null,
      order.completedAt ?? null,
      !!order.soundAlertDismissed,
      order.createdAt ?? null,
      order.updatedAt ?? null,
      serviceOf(order.pickup),
    ],
    client
  );
  if (order.items.length === 0) return;
  // All lines in one INSERT instead of one per line
  const its = order.items;
  await query(
    `INSERT INTO order_items (order_id, position, menu_item_id, name, unit_price, quantity, selected_extras, special_notes, total_price)
     SELECT $1, i.ord - 1, i.menu_item_id, i.name, i.unit_price, i.quantity, i.extras::jsonb, i.notes, i.total_price
     FROM unnest($2::text[], $3::text[], $4::numeric[], $5::int[], $6::text[], $7::text[], $8::numeric[])
          WITH ORDINALITY AS i(menu_item_id, name, unit_price, quantity, extras, notes, total_price, ord)`,
    [
      order.id,
      its.map((it) => it.menuItemId),
      its.map((it) => it.name),
      its.map((it) => it.unitPrice),
      its.map((it) => it.quantity),
      its.map((it) => JSON.stringify(it.selectedToppings || [])),
      its.map((it) => it.specialNotes || null),
      its.map((it) => it.totalPrice),
    ],
    client
  );
}

const ORDER_COLUMNS: Record<string, string> = {
  status: 'status',
  paymentStatus: 'payment_status',
  estimatedPrepMinutes: 'estimated_prep_minutes',
  estimatedReadyTime: 'estimated_ready_time',
  acceptedAt: 'accepted_at',
  declinedReason: 'declined_reason',
  declinedAt: 'declined_at',
  cancellationReason: 'cancellation_reason',
  cancelledAt: 'cancelled_at',
  completedAt: 'completed_at',
  soundAlertDismissed: 'sound_alert_dismissed',
};

export type OrderPatch = Partial<Pick<Order, 'status' | 'paymentStatus' | 'estimatedPrepMinutes' | 'estimatedReadyTime' |
  'acceptedAt' | 'declinedReason' | 'declinedAt' | 'cancellationReason' | 'cancelledAt' | 'completedAt' | 'soundAlertDismissed'>>;

export async function updateOrder(id: string, patch: OrderPatch, client: Queryable = pool): Promise<Order | null> {
  const { sql, values } = buildSet(patch, ORDER_COLUMNS, 2);
  const row = await queryOne(
    `UPDATE orders SET ${sql ? `${sql}, ` : ''}updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...values],
    client
  );
  return row ? (await hydrate([row], client))[0] : null;
}

/** Paid orders the kitchen hasn't accepted or declined yet (drives the sound alert). */
export async function unhandledPaidOrders(): Promise<Order[]> {
  const rows = await query(
    `SELECT * FROM orders WHERE status = 'pending' AND payment_status = 'successful' AND NOT sound_alert_dismissed
     ORDER BY created_at`
  );
  return hydrate(rows, pool);
}

// =====================================================================
// Payments
// =====================================================================

function toPayment(r: any): Payment {
  return compact({
    id: r.id,
    orderId: r.order_id,
    orderNumber: r.order_number,
    provider: 'Chapa',
    txRef: r.tx_ref,
    chapaReference: r.chapa_reference,
    amount: r.amount,
    currency: 'ETB',
    paymentMethod: r.payment_method,
    status: r.status,
    customerEmail: r.customer_email,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    checkoutUrl: r.checkout_url,
    paidAt: iso(r.paid_at),
    refundReference: r.refund_reference,
    refundReason: r.refund_reason,
    refundAmount: r.refund_amount,
    refundedAt: iso(r.refunded_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  }) as Payment;
}

export async function insertPayment(p: Payment, client: Queryable = pool): Promise<void> {
  await query(
    `INSERT INTO payments (
       id, order_id, order_number, provider, tx_ref, chapa_reference, amount, currency, payment_method, status,
       customer_email, customer_name, customer_phone, checkout_url, paid_at, refund_reference, refund_reason,
       refund_amount, refunded_at, created_at, updated_at)
     VALUES ($1,$2,$3,'Chapa',$4,$5,$6,'ETB',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             COALESCE($18::timestamptz, now()), COALESCE($19::timestamptz, now()))`,
    [
      p.id,
      p.orderId ?? null,
      p.orderNumber ?? null,
      p.txRef,
      p.chapaReference ?? null,
      p.amount,
      p.paymentMethod || 'other',
      p.status,
      p.customerEmail,
      p.customerName,
      p.customerPhone ?? null,
      p.checkoutUrl ?? null,
      p.paidAt ?? null,
      p.refundReference ?? null,
      p.refundReason ?? null,
      p.refundAmount ?? null,
      p.refundedAt ?? null,
      p.createdAt ?? null,
      p.updatedAt ?? null,
    ],
    client
  );
}

const PAYMENT_COLUMNS: Record<string, string> = {
  orderId: 'order_id',
  orderNumber: 'order_number',
  chapaReference: 'chapa_reference',
  paymentMethod: 'payment_method',
  status: 'status',
  checkoutUrl: 'checkout_url',
  paidAt: 'paid_at',
  refundReference: 'refund_reference',
  refundReason: 'refund_reason',
  refundAmount: 'refund_amount',
  refundedAt: 'refunded_at',
};

export async function updatePayment(id: string, patch: Partial<Payment>, client: Queryable = pool): Promise<Payment | null> {
  const { sql, values } = buildSet(patch as Record<string, unknown>, PAYMENT_COLUMNS, 2);
  const row = await queryOne(
    `UPDATE payments SET ${sql ? `${sql}, ` : ''}updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...values],
    client
  );
  return row ? toPayment(row) : null;
}

export async function getPaymentByTxRef(txRef: string, client: Queryable = pool, forUpdate = false): Promise<Payment | null> {
  const row = await queryOne(`SELECT * FROM payments WHERE tx_ref = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [txRef], client);
  return row ? toPayment(row) : null;
}

export async function paymentExists(txRef: string): Promise<boolean> {
  return !!(await queryOne('SELECT 1 FROM payments WHERE tx_ref = $1', [txRef]));
}

/** The payment behind an order (by the order's payment id, or the payment's order id). */
export async function getPaymentForOrder(order: Order, client: Queryable = pool, forUpdate = false): Promise<Payment | null> {
  const row = await queryOne(
    `SELECT * FROM payments WHERE id = $1 OR order_id = $2 ORDER BY (id = $1) DESC LIMIT 1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [order.paymentId || '', order.id],
    client
  );
  return row ? toPayment(row) : null;
}

export async function listPayments(limit = 1000): Promise<Payment[]> {
  const rows = await query('SELECT * FROM payments ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(toPayment);
}

// =====================================================================
// Pending checkouts (order details held until Chapa confirms payment)
// =====================================================================

export interface PendingCheckout {
  txRef: string;
  customer: Order['customer'];
  pickup: Order['pickup'];
  items: OrderItem[];
  subtotal: number;
  taxOrFees: number;
  totalAmount: number;
}

export async function insertPendingCheckout(p: PendingCheckout, client: Queryable = pool): Promise<void> {
  await query(
    `INSERT INTO pending_checkouts (tx_ref, customer, pickup, items, subtotal, tax_or_fees, total_amount)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7)`,
    [p.txRef, JSON.stringify(p.customer), JSON.stringify(p.pickup), JSON.stringify(p.items), p.subtotal, p.taxOrFees, p.totalAmount],
    client
  );
}

export async function getPendingCheckout(txRef: string, client: Queryable = pool): Promise<PendingCheckout | null> {
  const r = await queryOne('SELECT * FROM pending_checkouts WHERE tx_ref = $1', [txRef], client);
  return r
    ? {
        txRef: r.tx_ref,
        customer: r.customer,
        pickup: r.pickup,
        items: r.items,
        subtotal: r.subtotal,
        taxOrFees: r.tax_or_fees,
        totalAmount: r.total_amount,
      }
    : null;
}

export async function deletePendingCheckout(txRef: string, client: Queryable = pool): Promise<void> {
  await query('DELETE FROM pending_checkouts WHERE tx_ref = $1', [txRef], client);
}

// =====================================================================
// Dashboard numbers and reports
// =====================================================================

export async function dashboardMetrics(today: string) {
  const r = await queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE pickup_date = $1::date)                                              AS total_today,
       COALESCE(SUM(total_amount) FILTER (WHERE pickup_date = $1::date AND payment_status = 'successful'
                                          AND ${ACTIVE}), 0)                                         AS revenue_today,
       COUNT(*) FILTER (WHERE status = 'pending')                                                  AS pending,
       COUNT(*) FILTER (WHERE status IN ('accepted', 'preparing'))                                 AS accepted,
       COUNT(*) FILTER (WHERE status = 'declined')                                                 AS declined,
       COUNT(*) FILTER (WHERE status = 'completed')                                                AS completed,
       COUNT(*) FILTER (WHERE status = 'pending' AND payment_status = 'successful' AND NOT sound_alert_dismissed) AS unhandled,
       COUNT(*) FILTER (WHERE pickup_date = $1::date AND status IN ('accepted', 'preparing'))     AS upcoming
     FROM orders`,
    [today]
  );
  const p = await queryOne(
    `SELECT COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COUNT(*) FILTER (WHERE status IN ('refunded', 'partially_refunded')) AS refunded
     FROM payments`
  );
  return {
    totalOrdersToday: r.total_today,
    totalRevenueTodayETB: r.revenue_today,
    pendingOrdersCount: r.pending,
    acceptedOrdersCount: r.accepted,
    declinedOrdersCount: r.declined,
    completedOrdersCount: r.completed,
    failedPaymentsCount: p.failed,
    refundedOrdersCount: p.refunded,
    upcomingPickupsCount: r.upcoming,
    unhandledPaidAlertsCount: r.unhandled,
  };
}

export async function reports() {
  // Category comes from one join on the dish id, not a lookup per dish name
  const popular = await query(
    `SELECT oi.name,
            SUM(oi.quantity)::int AS quantity,
            SUM(oi.total_price)   AS revenue,
            COALESCE(MIN(m.category), 'General') AS category
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN menu_items m ON m.id = oi.menu_item_id
     WHERE o.${ACTIVE}
     GROUP BY oi.name
     ORDER BY quantity DESC`
  );
  const floors = await query(`SELECT floor_number, COUNT(*) AS n FROM orders WHERE ${ACTIVE} GROUP BY floor_number`);
  const byDate = await query(
    `SELECT pickup_date, COUNT(*) AS n, SUM(total_amount) AS revenue
     FROM orders WHERE ${ACTIVE} GROUP BY pickup_date ORDER BY pickup_date`
  );

  const floorCounts: Record<number, number> = { 2: 0, 8: 0, 10: 0, 11: 0, 12: 0, 13: 0 };
  let dineInCount = 0;
  for (const f of floors) {
    if (f.floor_number === null) dineInCount += f.n;
    else if (floorCounts[f.floor_number] !== undefined) floorCounts[f.floor_number] = f.n;
  }

  const salesByDate: Record<string, { count: number; revenue: number }> = {};
  for (const d of byDate) salesByDate[d.pickup_date] = { count: d.n, revenue: d.revenue };

  return {
    popularItems: popular.map((p) => ({ name: p.name, quantity: p.quantity, revenueETB: p.revenue, category: p.category })),
    floorCounts,
    dineInCount,
    salesByDate,
    payments: await listPayments(),
  };
}
