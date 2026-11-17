/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { X, Minus, Plus, ArrowRight } from 'lucide-react';
import { CartItem } from '../types.ts';
import { ORDER_LIMITS } from '../utils/orderLimits.ts';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  onUpdateQuantity: (cartItemId: string, newQty: number) => void;
  onRemoveItem: (cartItemId: string) => void;
  onProceedToCheckout: () => void;
  onClearCart: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cart,
  onUpdateQuantity,
  onRemoveItem,
  onProceedToCheckout,
  onClearCart,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const subtotal = cart.reduce((sum, item) => sum + item.itemTotal, 0);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/40 animate-fade" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your bag"
        className="absolute inset-y-0 right-0 w-full max-w-md bg-card flex flex-col shadow-2xl animate-slide-in"
      >
        <div className="px-6 pt-6 pb-5 flex items-start justify-between border-b border-line">
          <div>
            <h3 className="font-display text-3xl text-ink">Your bag</h3>
            <p className="text-sm text-muted mt-1">
              {count === 0 ? 'Nothing here yet' : `${count} item${count > 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 -mr-2 rounded-full flex items-center justify-center text-ink hover:bg-paper-2"
            aria-label="Close"
          >
            <X className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center pb-16">
              <p className="font-display italic text-2xl text-ink">Hungry?</p>
              <p className="text-muted mt-2 max-w-[240px]">
                Pick something from the menu and it'll show up here.
              </p>
              <button
                onClick={onClose}
                className="mt-6 text-sm text-accent underline underline-offset-4"
              >
                Browse the menu
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((item) => (
                <li key={item.cartItemId} className="py-5 flex gap-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-paper-2 shrink-0">
                    {item.menuItem.imageUrl && (
                      <img src={item.menuItem.imageUrl} alt="" width={64} height={64} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <h4 className="font-display text-lg leading-snug text-ink">{item.menuItem.name}</h4>
                      <span className="tabular text-ink shrink-0">{item.itemTotal.toLocaleString()}</span>
                    </div>

                    {item.selectedToppings.length > 0 && (
                      <p className="text-sm text-muted mt-1">
                        {item.selectedToppings
                          .map((t) => `${t.quantity && t.quantity > 1 ? `${t.quantity}× ` : ''}${t.name}`)
                          .join(', ')}
                      </p>
                    )}

                    {item.specialNotes && (
                      <p className="text-sm text-ink-2 mt-1 italic font-display">“{item.specialNotes}”</p>
                    )}

                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center rounded-full border border-line">
                        <button
                          onClick={() => onUpdateQuantity(item.cartItemId, item.quantity - 1)}
                          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-paper-2"
                          aria-label="Decrease"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-6 text-center text-sm tabular">{item.quantity}</span>
                        <button
                          onClick={() => onUpdateQuantity(item.cartItemId, Math.min(ORDER_LIMITS.maxItemQuantity, item.quantity + 1))}
                          disabled={item.quantity >= ORDER_LIMITS.maxItemQuantity}
                          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-paper-2"
                          aria-label="Increase"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button
                        onClick={() => onRemoveItem(item.cartItemId)}
                        className="text-sm text-muted hover:text-accent"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cart.length > 0 && (
          <div className="px-6 pt-5 pb-6 border-t border-line bg-card">
            <div className="flex items-baseline justify-between">
              <span className="text-ink">Total</span>
              <span className="font-display text-2xl text-ink tabular">
                {subtotal.toLocaleString()} <span className="text-base text-muted">br</span>
              </span>
            </div>
            <p className="text-sm text-muted mt-1">VAT and service included.</p>

            <button
              onClick={() => {
                onClose();
                onProceedToCheckout();
              }}
              className="mt-5 w-full h-13 bg-accent hover:bg-accent-dark text-white rounded-full flex items-center justify-center gap-2 font-medium transition-colors"
            >
              Choose pickup time
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={onClearCart}
              className="mt-3 w-full text-sm text-muted hover:text-ink"
            >
              Empty bag
            </button>
          </div>
        )}
      </aside>
    </div>
  );
};
