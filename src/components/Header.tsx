/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShoppingBag } from 'lucide-react';
import { CartItem } from '../types.ts';

interface HeaderProps {
  cart: CartItem[];
  onOpenCart: () => void;
  onOpenOrderLookup: () => void;
  onScrollToMenu: () => void;
  onGoHome: () => void;
}

/** The official Plenty logo (white line art with wordmark), for dark backgrounds. */
export const PlentyLogo: React.FC<{ className?: string; lazy?: boolean }> = ({ className = 'h-12', lazy = false }) => (
  <img
    src="/plenty-logo.png"
    alt="Plenty"
    width={515}
    height={506}
    loading={lazy ? 'lazy' : 'eager'}
    decoding="async"
    className={`w-auto ${className}`}
  />
);

/** Line-art sprout, echoing the Plenty leaf mark */
export const PlentyMark: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M16 29V15" />
    <path d="M16 18c-1-5-5-8-11-8 0 6 4 9 11 8Z" />
    <path d="M16 15c.6-5.5 4.6-9.5 11-10 0 6.6-4.4 10.4-11 10Z" />
    <path d="M9 29h14" />
  </svg>
);

export const Header: React.FC<HeaderProps> = ({
  cart,
  onOpenCart,
  onOpenOrderLookup,
  onScrollToMenu,
  onGoHome,
}) => {
  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cart.reduce((sum, item) => sum + item.itemTotal, 0);

  return (
    <header className="sticky top-0 z-40 bg-ink/90 backdrop-blur-md border-b border-white/10 text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[68px] sm:h-[84px] flex items-center justify-between gap-4">
        <button onClick={onGoHome} className="flex items-center gap-2.5 select-none" aria-label="Plenty home">
          <PlentyLogo className="h-[52px] sm:h-[68px]" />
        </button>

        <nav className="hidden md:flex items-center gap-8 text-[15px] text-white/80">
          <button
            onClick={() => {
              onGoHome();
              setTimeout(onScrollToMenu, 0);
            }}
            className="hover:text-white transition-colors"
          >
            Place order
          </button>
          <button onClick={onOpenOrderLookup} className="hover:text-white transition-colors">
            Track an order
          </button>
        </nav>

        <div className="flex items-center gap-2">
          <button onClick={onOpenOrderLookup} className="md:hidden text-sm text-white/80 px-2 py-2">
            Track
          </button>
          <button
            onClick={onOpenCart}
            className={`flex items-center gap-2.5 pl-3.5 pr-4 h-10 rounded-full text-sm border transition-colors ${
              totalItemCount > 0
                ? 'bg-accent border-accent text-white hover:bg-accent-dark'
                : 'border-accent text-accent hover:bg-accent hover:text-white'
            }`}
          >
            <ShoppingBag className="w-4 h-4" strokeWidth={1.75} />
            <span className="font-medium">{totalItemCount > 0 ? totalItemCount : 'Bag'}</span>
            {cartSubtotal > 0 && (
              <span className="tabular text-white/80 hidden sm:inline">· {cartSubtotal.toLocaleString()} br</span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
