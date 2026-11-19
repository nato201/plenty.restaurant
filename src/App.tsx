/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header.tsx';
import { Hero } from './components/Hero.tsx';
import { MenuSection } from './components/MenuSection.tsx';
import { CartDrawer } from './components/CartDrawer.tsx';
import { CheckoutModal } from './components/CheckoutModal.tsx';
import { CustomerOrderTracker, rememberTrackedOrder } from './components/CustomerOrderTracker.tsx';
import { Footer } from './components/Footer.tsx';
import { HowItWorks } from './components/HowItWorks.tsx';
import { MenuItem, CartItem, Topping, Order, RestaurantSettings } from './types.ts';
import { serviceLong } from './utils/service.ts';
import { Check, ArrowRight, Loader2 } from 'lucide-react';

const CART_KEY = 'plenty_cart';

/** The bag survives the round trip to Chapa's payment page (and a cancelled payment). */
function loadSavedCart(): CartItem[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

/**
 * The payment we sent the customer to Chapa for. Remembered (in localStorage, so every tab sees
 * it) until Chapa gives a final answer, so the bag empties however the customer comes back:
 * Chapa's return link, the browser's Back button, or reopening the site after paying in the
 * telebirr app.
 */
const PENDING_KEY = 'plenty_pending_payment';
const PENDING_MAX_AGE = 6 * 60 * 60 * 1000;
type PendingPayment = { txRef: string; startedAt: number };

function readPending(): PendingPayment | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (p?.txRef && Date.now() - p.startedAt < PENDING_MAX_AGE) return p;
    localStorage.removeItem(PENDING_KEY);
  } catch {}
  return null;
}
function writePending(txRef: string) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ txRef, startedAt: Date.now() }));
  } catch {}
}
function clearPending(txRef?: string) {
  try {
    if (!txRef || readPending()?.txRef === txRef) localStorage.removeItem(PENDING_KEY);
  } catch {}
}

type VerifyAnswer =
  | { kind: 'paid'; order: Order }
  | { kind: 'processing' }
  | { kind: 'failed' }
  /** Paid, but the pickup slot filled up during payment */
  | { kind: 'paidButFull'; error: string };

async function checkPayment(txRef: string): Promise<VerifyAnswer> {
  try {
    const res = await fetch(`/api/payment/verify?tx_ref=${encodeURIComponent(txRef)}`);
    const data = await res.json().catch(() => ({}));
    if (data.success && data.order) return { kind: 'paid', order: data.order };
    // A network or server hiccup, or Chapa still confirming: worth asking again
    if (data.retryable || res.status >= 500) return { kind: 'processing' };
    if (res.status === 409) return { kind: 'paidButFull', error: data.error || '' };
    return { kind: 'failed' };
  } catch {
    return { kind: 'processing' };
  }
}

export default function App() {
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>(loadSavedCart);
  // Shown when a payment couldn't be started or confirmed
  const [paymentNotice, setPaymentNotice] = useState<{ title: string; body: string } | null>(null);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isOrderLookupOpen, setIsOrderLookupOpen] = useState(false);
  // Pre-fills the tracker after a successful payment
  const [trackTarget, setTrackTarget] = useState<{ orderNumber: string; email: string } | null>(null);

  // Confirmed order popup
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);

  // Restaurant settings
  const [storeSettings, setStoreSettings] = useState<Partial<RestaurantSettings>>({});
  const isOrderingEnabled = storeSettings.isOrderingEnabled !== false;
  const pauseReason = storeSettings.pauseReason;

  // Load menu items & settings from backend
  const loadStoreData = async () => {
    try {
      const [menuRes, setRes] = await Promise.all([
        fetch('/api/menu').then((r) => r.json()),
        fetch('/api/settings').then((r) => r.json()),
      ]);

      if (menuRes.success) setMenuItems(menuRes.items);
      if (setRes.success && setRes.settings) {
        setStoreSettings(setRes.settings);
      }
    } catch (e) {
      console.error('Error fetching store data:', e);
    }
  };

  useEffect(() => {
    loadStoreData();

    // Check URL parameters for direct view navigation or return_url
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    const txRefParam = urlParams.get('tx_ref');

    // "Follow your order" link from an email: open the tracker already filled in
    const trackParam = urlParams.get('track');
    const trackEmail = urlParams.get('email');
    if (trackParam && trackEmail) {
      window.history.replaceState(null, '', window.location.pathname);
      setTrackTarget({ orderNumber: trackParam, email: trackEmail });
      setIsOrderLookupOpen(true);
    }

    if (viewParam === 'order_confirm' && txRefParam) {
      // Back from Chapa through its return link: tidy the address bar, then confirm with the server
      window.history.replaceState(null, '', window.location.pathname);
      confirmPayment(txRefParam, 'returned');
    } else {
      // Came back some other way (Back button, reopened the site after paying in an app)
      const pending = readPending();
      if (pending) confirmPayment(pending.txRef, 'background');
    }

    // Coming back to this tab (e.g. after paying in the telebirr app): check again
    const onVisible = () => {
      const pending = readPending();
      if (document.visibilityState === 'visible' && pending) confirmPayment(pending.txRef, 'background');
    };
    document.addEventListener('visibilitychange', onVisible);

    // Refresh menu & ordering status every 10 seconds
    const interval = setInterval(loadStoreData, 10000);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      if (recheckTimer.current) clearTimeout(recheckTimer.current);
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {}
  }, [cart]);

  const confirming = useRef<string | null>(null);
  const recheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPaid = (txRef: string, order: Order) => {
    clearPending(txRef);
    setCart([]);
    try {
      sessionStorage.removeItem(CART_KEY);
    } catch {}
    setPaymentNotice(null);
    setConfirmedOrder(order);
    rememberTrackedOrder({ orderNumber: order.orderNumber, email: order.customer.email });
    loadStoreData();
  };

  /**
   * Find out whether the payment went through.
   *  'returned'   - the customer just came back through Chapa's return link: show progress, and
   *                 keep asking for up to ~45 s (telebirr / CBE Birr can take a while).
   *  'background' - quietly check a remembered payment; if Chapa is still confirming, check
   *                 again every 15 s while the page is open.
   * The bag empties only once the order really exists, and stays if the payment failed.
   */
  const confirmPayment = async (txRef: string, mode: 'returned' | 'background') => {
    if (confirming.current === txRef) return; // already checking this one
    confirming.current = txRef;
    if (recheckTimer.current) clearTimeout(recheckTimer.current);
    if (mode === 'returned') setIsConfirmingPayment(true);

    let answer: VerifyAnswer = { kind: 'processing' };
    const attempts = mode === 'returned' ? 12 : 1;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 4000));
      answer = await checkPayment(txRef);
      if (answer.kind !== 'processing') break;
    }
    confirming.current = null;
    setIsConfirmingPayment(false);

    if (answer.kind === 'paid') return onPaid(txRef, answer.order);

    if (answer.kind === 'paidButFull') {
      clearPending(txRef);
      setPaymentNotice({
        title: 'That pickup time filled up while you were paying',
        body:
          'Your order couldn’t be placed, and your payment will be refunded in full. ' +
          'Your bag is still saved: please choose another time. ' +
          'If you have questions, contact the restaurant with the time you paid.',
      });
      return;
    }

    if (answer.kind === 'failed') {
      clearPending(txRef);
      if (mode === 'returned') {
        setPaymentNotice({
          title: 'Your payment wasn’t completed',
          body: 'No order was placed and nothing was charged. Your bag is still saved, so you can try again.',
        });
      }
      return;
    }

    // Still processing at Chapa: keep the bag, keep checking quietly
    if (!readPending()) writePending(txRef);
    if (mode === 'returned') {
      setPaymentNotice({
        title: 'Your payment is still being confirmed',
        body:
          'Chapa hasn’t finished confirming it yet. Please don’t pay again: this page checks every few seconds ' +
          'and your order appears here as soon as it’s confirmed. You’ll also get an email.',
      });
    }
    recheckTimer.current = setTimeout(() => {
      if (readPending()?.txRef === txRef) confirmPayment(txRef, 'background');
    }, 15000);
  };

  // Add Item to Cart
  const handleAddToCart = (
    item: MenuItem,
    selectedToppings: Topping[],
    specialNotes: string,
    quantity: number
  ) => {
    const toppingsTotal = selectedToppings.reduce(
      (sum, t) => sum + t.price * (t.quantity || 1),
      0
    );
    const itemTotal = (item.price + toppingsTotal) * quantity;
    const cartItemId = `cart-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newCartItem: CartItem = {
      cartItemId,
      menuItem: item,
      quantity,
      selectedToppings,
      specialNotes,
      itemTotal,
    };

    setCart((prev) => [...prev, newCartItem]);
    setIsCartOpen(true);
  };

  const handleUpdateQuantity = (cartItemId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveItem(cartItemId);
      return;
    }

    setCart((prev) =>
      prev.map((it) => {
        if (it.cartItemId === cartItemId) {
          const toppingsTotal = it.selectedToppings.reduce(
            (sum, t) => sum + t.price * (t.quantity || 1),
            0
          );
          return {
            ...it,
            quantity: newQty,
            itemTotal: (it.menuItem.price + toppingsTotal) * newQty,
          };
        }
        return it;
      })
    );
  };

  const handleRemoveItem = (cartItemId: string) => {
    setCart((prev) => prev.filter((it) => it.cartItemId !== cartItemId));
  };

  const handleClearCart = () => {
    setCart([]);
  };

  // Triggered when payment is initialized from checkout modal
  const handlePaymentInitiated = (txRef: string, checkoutUrl: string) => {
    setIsCheckoutOpen(false);
    // Only ever send customers to Chapa's own checkout page
    if (checkoutUrl.startsWith('https://checkout.chapa.co/')) {
      writePending(txRef); // so we can confirm it however the customer comes back
      window.location.href = checkoutUrl;
    } else {
      setPaymentNotice({
        title: 'Payment isn’t available',
        body: 'We couldn’t open the payment page. Please try again in a moment.',
      });
    }
  };

  const scrollToMenu = () => {
    const el = document.getElementById('menu-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col font-sans">
      {/* Header */}
      <Header
        cart={cart}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenOrderLookup={() => setIsOrderLookupOpen(true)}
        onScrollToMenu={scrollToMenu}
        onGoHome={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      />

      <main className="flex-1 bg-ink text-white">
          {/* Customer Storefront */}
          <Hero
            onPreOrderClick={scrollToMenu}
            isOrderingEnabled={isOrderingEnabled}
            pauseReason={pauseReason}
            weeklySchedule={storeSettings.weeklySchedule}
          />

          <MenuSection
            menuItems={menuItems}
            onAddToCart={handleAddToCart}
          />

          <HowItWorks onStart={scrollToMenu} isOrderingEnabled={isOrderingEnabled} />

          <Footer weeklySchedule={storeSettings.weeklySchedule} />
      </main>

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveItem}
        onProceedToCheckout={() => setIsCheckoutOpen(true)}
        onClearCart={handleClearCart}
      />

      {/* Pre-Order Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        cart={cart}
        onPaymentInitiated={handlePaymentInitiated}
        settings={storeSettings}
      />

      {/* Customer Order Tracker Modal */}
      <CustomerOrderTracker
        isOpen={isOrderLookupOpen}
        onClose={() => {
          setIsOrderLookupOpen(false);
          setTrackTarget(null);
        }}
        initialOrderNumber={trackTarget?.orderNumber}
        initialEmail={trackTarget?.email}
      />

      {/* Back from Chapa, waiting for the payment to be confirmed */}
      {isConfirmingPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-ink/80 animate-fade">
          <div className="bg-card rounded-3xl px-8 py-7 text-center shadow-2xl max-w-sm">
            <Loader2 className="w-6 h-6 text-accent animate-spin mx-auto" />
            <p className="font-display text-2xl text-ink mt-4">Confirming your payment…</p>
            <p className="text-muted mt-1">This takes a few seconds. Please don’t close this page.</p>
          </div>
        </div>
      )}

      {/* Payment couldn't be started or confirmed */}
      {paymentNotice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
          <div className="absolute inset-0 bg-ink/60 animate-fade" onClick={() => setPaymentNotice(null)} />
          <div role="alertdialog" aria-modal="true" className="relative bg-card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl px-7 sm:px-9 pt-8 pb-7 shadow-2xl animate-rise">
            <h3 className="font-display text-3xl text-ink">{paymentNotice.title}</h3>
            <p className="text-muted mt-3 leading-relaxed">{paymentNotice.body}</p>
            <button
              onClick={() => setPaymentNotice(null)}
              className="mt-7 w-full h-12 bg-ink hover:bg-ink-2 text-white rounded-full font-medium transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* ORDER CONFIRMATION SUCCESS MODAL */}
      {confirmedOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
          <div className="absolute inset-0 bg-ink/50 animate-fade" onClick={() => setConfirmedOrder(null)} />
          <div
            role="dialog"
            aria-modal="true"
            className="relative bg-card w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl px-7 sm:px-9 pt-9 pb-7 shadow-2xl animate-rise"
          >
            <div className="w-12 h-12 rounded-full bg-olive text-white flex items-center justify-center">
              <Check className="w-6 h-6" strokeWidth={2.25} />
            </div>

            <h3 className="font-display text-[34px] leading-tight text-ink mt-6">
              Thank you, {confirmedOrder.customer.firstName}.
            </h3>
            <p className="text-muted mt-2 leading-relaxed">
              Your payment went through and the kitchen has your order. We'll email you once they
              confirm a prep time.
            </p>

            <dl className="mt-7 border-y border-line divide-y divide-line text-[15px]">
              <div className="flex justify-between py-3">
                <dt className="text-muted">Order</dt>
                <dd className="text-ink tabular">{confirmedOrder.orderNumber}</dd>
              </div>
              <div className="flex justify-between py-3">
                <dt className="text-muted">When</dt>
                <dd className="text-ink">
                  {confirmedOrder.pickup.pickupDate}, {confirmedOrder.pickup.pickupTime}
                </dd>
              </div>
              <div className="flex justify-between py-3">
                <dt className="text-muted">Service</dt>
                <dd className="text-ink">{serviceLong(confirmedOrder.pickup)}</dd>
              </div>
              <div className="flex justify-between py-3">
                <dt className="text-muted">Paid</dt>
                <dd className="text-ink tabular">{confirmedOrder.totalAmount.toLocaleString()} br</dd>
              </div>
            </dl>

            <div className="mt-7 flex flex-col gap-2">
              <button
                onClick={() => {
                  setTrackTarget({
                    orderNumber: confirmedOrder.orderNumber,
                    email: confirmedOrder.customer.email,
                  });
                  setConfirmedOrder(null);
                  setIsOrderLookupOpen(true);
                }}
                className="h-12 bg-ink hover:bg-ink-2 text-paper rounded-full flex items-center justify-center gap-2 font-medium transition-colors"
              >
                Follow your order
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setConfirmedOrder(null)}
                className="h-11 text-muted hover:text-ink"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
