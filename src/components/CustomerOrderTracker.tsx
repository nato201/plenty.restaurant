/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { X, Loader2, RefreshCw, Check } from 'lucide-react';
import { Order, OrderStatus } from '../types.ts';
import { serviceLong, serviceOf, serviceShort } from '../utils/service.ts';

interface CustomerOrderTrackerProps {
  isOpen: boolean;
  onClose: () => void;
  initialOrderNumber?: string;
  initialEmail?: string;
}

type SavedOrder = { orderNumber: string; email: string };
const HISTORY_KEY = 'plenty_tracked_orders';

function readHistory(): SavedOrder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((x) => x?.orderNumber && x?.email).slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberTrackedOrder(entry: SavedOrder) {
  try {
    const next = [entry, ...readHistory().filter((h) => h.orderNumber !== entry.orderNumber)].slice(0, 5);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {}
}

const STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'pending', label: 'Received' },
  { key: 'accepted', label: 'Confirmed' },
  { key: 'preparing', label: 'Cooking' },
  { key: 'ready', label: 'Ready' },
  { key: 'completed', label: 'Picked up' },
];

const HEADLINES: Record<OrderStatus, string> = {
  pending: 'The kitchen has your order',
  accepted: 'Confirmed — we’re on it',
  preparing: 'Your food is cooking',
  ready: 'Ready for pickup',
  completed: 'Picked up. Enjoy!',
  declined: 'We couldn’t take this order',
  cancelled: 'This order was cancelled',
};

const field =
  'w-full h-12 px-4 rounded-xl bg-white border border-line text-ink text-[15px] outline-none focus:border-ink placeholder:text-muted/70 transition-colors';

export const CustomerOrderTracker: React.FC<CustomerOrderTrackerProps> = ({
  isOpen,
  onClose,
  initialOrderNumber = '',
  initialEmail = '',
}) => {
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedOrder[]>([]);

  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);

  const lookup = async (num: string, mail: string, quiet = false) => {
    if (!num.trim() || !mail.trim()) return;
    if (!quiet) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const res = await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: num, email: mail }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.order) {
        setOrder(data.order);
        rememberTrackedOrder({ orderNumber: data.order.orderNumber, email: mail.trim() });
        setHistory(readHistory());
      } else if (!quiet) {
        setOrder(null);
        setError(data.error || 'We couldn’t find that order.');
      }
    } catch {
      if (!quiet) setError('Can’t reach the restaurant right now. Try again in a moment.');
    } finally {
      if (!quiet) setIsLoading(false);
    }
  };

  // Reset and pre-fill each time the tracker opens
  useEffect(() => {
    if (!isOpen) return;
    const saved = readHistory();
    setHistory(saved);
    setOrder(null);
    setError(null);
    setShowCancel(false);

    let rememberedEmail = '';
    try {
      rememberedEmail = localStorage.getItem('plenty_saved_email') || '';
    } catch {}

    const num = initialOrderNumber;
    const mail = initialEmail || saved[0]?.email || rememberedEmail;
    setOrderNumber(num);
    setEmail(mail);
    if (num && mail) lookup(num, mail);

    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialOrderNumber, initialEmail]);

  // Keep an open order fresh while the customer waits
  useEffect(() => {
    if (!isOpen || !order || ['completed', 'declined', 'cancelled'].includes(order.status)) return;
    const t = setInterval(() => lookup(order.orderNumber, email, true), 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, order?.orderNumber, order?.status, email]);

  const requestCancellation = async () => {
    if (!order) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/cancel-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.order) {
        setOrder(data.order);
        setShowCancel(false);
        setCancelReason('');
      } else {
        setError(data.error || 'We couldn’t cancel this order. Please call the restaurant.');
      }
    } finally {
      setCancelLoading(false);
    }
  };

  if (!isOpen) return null;

  const stepIndex = order ? STEPS.findIndex((s) => s.key === order.status) : -1;
  const isClosedOut = order && (order.status === 'declined' || order.status === 'cancelled');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-ink/60 animate-fade" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Track your order"
        className="relative bg-card text-ink w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl animate-rise"
      >
        <div className="px-6 sm:px-8 pt-7 pb-5 flex items-start justify-between">
          <div>
            <h3 className="font-display text-3xl">{order ? HEADLINES[order.status] : 'Track your order'}</h3>
            <p className="text-muted mt-1.5">
              {order
                ? `${order.orderNumber} · ${serviceShort(order.pickup)}`
                : 'Use the order number from your confirmation and the email you paid with.'}
            </p>
          </div>
          <button onClick={onClose} className="w-9 h-9 -mr-2 rounded-full flex items-center justify-center hover:bg-paper-2" aria-label="Close">
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 sm:px-8 pb-8">
          {!order ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookup(orderNumber, email);
              }}
              className="space-y-3"
            >
              <input
                aria-label="Order number"
                placeholder="Order number, e.g. PLT-2026-1042"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className={`${field} tabular`}
                required
              />
              <input
                aria-label="Email"
                type="email"
                autoComplete="email"
                placeholder="Email used at checkout"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={field}
                required
              />
              {error && (
                <p role="alert" className="text-sm text-accent-dark bg-accent/10 rounded-xl px-4 py-3">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 rounded-full bg-accent hover:bg-accent-dark disabled:opacity-60 text-white font-medium flex items-center justify-center gap-2 transition-colors"
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Find my order
              </button>

              {history.length > 0 && (
                <div className="pt-4">
                  <p className="text-sm text-muted mb-2">Recent orders on this device</p>
                  <div className="flex flex-wrap gap-2">
                    {history.map((h) => (
                      <button
                        key={h.orderNumber}
                        type="button"
                        onClick={() => {
                          setOrderNumber(h.orderNumber);
                          setEmail(h.email);
                          lookup(h.orderNumber, h.email);
                        }}
                        className="px-3 h-9 rounded-full border border-line hover:border-ink text-sm tabular transition-colors"
                      >
                        {h.orderNumber}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form>
          ) : (
            <div className="space-y-7">
              {/* Progress */}
              {isClosedOut ? (
                <div className="rounded-2xl bg-paper-2 px-5 py-4 text-[15px] text-ink/80">
                  {order.status === 'declined'
                    ? order.declinedReason || 'The kitchen couldn’t fulfil this order.'
                    : order.cancellationReason || 'This order was cancelled.'}{' '}
                  {order.paymentStatus === 'refunded' || order.paymentStatus === 'partially_refunded'
                    ? 'Your payment has been refunded.'
                    : ''}
                </div>
              ) : (
                <ol className="grid grid-cols-5 gap-1.5">
                  {STEPS.map((s, i) => {
                    const done = i <= stepIndex;
                    return (
                      <li key={s.key} className="text-center">
                        <div className={`h-1.5 rounded-full ${done ? 'bg-accent' : 'bg-line'}`} />
                        <span className={`block mt-2 text-xs ${i === stepIndex ? 'text-ink font-medium' : 'text-muted'}`}>
                          {s.label}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}

              {(order.status === 'accepted' || order.status === 'preparing') && order.estimatedReadyTime && (
                <div className="flex items-baseline justify-between border-y border-line py-4">
                  <span className="text-muted">Ready around</span>
                  <span className="font-display text-3xl tabular">{order.estimatedReadyTime}</span>
                </div>
              )}

              <dl className="divide-y divide-line border-y border-line text-[15px]">
                <div className="flex justify-between py-3">
                  <dt className="text-muted">When</dt>
                  <dd>
                    {order.pickup.pickupDate}, {order.pickup.pickupTime}
                  </dd>
                </div>
                <div className="flex justify-between py-3">
                  <dt className="text-muted">Service</dt>
                  <dd>{serviceLong(order.pickup)}</dd>
                </div>
              </dl>

              <div>
                <h4 className="font-medium mb-2">Your order</h4>
                <ul className="divide-y divide-line">
                  {order.items.map((it, idx) => (
                    <li key={idx} className="py-3 flex justify-between gap-4">
                      <div>
                        <span>
                          {it.quantity}× {it.name}
                        </span>
                        {it.selectedToppings?.length > 0 && (
                          <p className="text-sm text-muted">
                            {it.selectedToppings
                              .map((t) => `${t.quantity && t.quantity > 1 ? `${t.quantity}× ` : ''}${t.name}`)
                              .join(', ')}
                          </p>
                        )}
                        {it.specialNotes && <p className="text-sm text-muted italic">“{it.specialNotes}”</p>}
                      </div>
                      <span className="tabular shrink-0">{it.totalPrice.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between pt-3 border-t border-line">
                  <span>Paid</span>
                  <span className="font-display text-xl tabular">{order.totalAmount.toLocaleString()} br</span>
                </div>
              </div>

              {error && <p className="text-sm text-accent-dark">{error}</p>}

              {showCancel ? (
                <div className="rounded-2xl border border-line p-4 space-y-3">
                  <p className="text-[15px]">
                    {order.status === 'pending'
                      ? 'The kitchen hasn’t started yet, so you’ll get a full refund.'
                      : 'The kitchen has already confirmed this order. We’ll review your request and get back to you.'}
                  </p>
                  <textarea
                    rows={2}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Reason (optional)"
                    className="w-full px-4 py-3 rounded-xl bg-white border border-line text-[15px] outline-none focus:border-ink resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowCancel(false)} className="h-10 px-4 text-sm text-muted hover:text-ink">
                      Keep my order
                    </button>
                    <button
                      onClick={requestCancellation}
                      disabled={cancelLoading}
                      className="h-10 px-5 rounded-full bg-ink text-white text-sm disabled:opacity-60"
                    >
                      {cancelLoading ? 'Cancelling…' : 'Cancel order'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => lookup(order.orderNumber, email)}
                    className="text-sm text-muted hover:text-ink flex items-center gap-1.5"
                  >
                    {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Refresh
                  </button>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => {
                        setOrder(null);
                        setOrderNumber('');
                        setError(null);
                      }}
                      className="text-sm text-muted hover:text-ink"
                    >
                      Track another
                    </button>
                    {(order.status === 'pending' || order.status === 'accepted') && (
                      <button onClick={() => setShowCancel(true)} className="text-sm text-accent-dark hover:underline">
                        Cancel order
                      </button>
                    )}
                  </div>
                </div>
              )}

              {order.status === 'ready' && (
                <p className="flex items-center gap-2 text-olive text-[15px]">
                  <Check className="w-4 h-4" />{' '}
                  {serviceOf(order.pickup) === 'dine_in'
                    ? 'Your table is ready. Come to the restaurant and show your order number.'
                    : `It's on its way to floor ${order.pickup.floorNumber}. Have your order number handy.`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
