/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Search, Plus, Minus, Check, X } from 'lucide-react';
import { MenuItem, Topping } from '../types.ts';
import { ORDER_LIMITS } from '../utils/orderLimits.ts';

interface MenuSectionProps {
  menuItems: MenuItem[];
  onAddToCart: (item: MenuItem, selectedToppings: Topping[], specialNotes: string, quantity: number) => void;
}

const CATEGORIES = [
  'Breakfast',
  'Salad',
  'Burger and Sandwiches',
  'Spaghetti',
  'Ethiopian Delights',
  'Asian Fusion',
];

const CATEGORY_LABELS: Record<string, string> = {
  'Burger and Sandwiches': 'Burgers & Sandwiches',
};

const CATEGORY_NOTES: Record<string, string> = {
  Breakfast: 'Served from 7:30 in the morning.',
  Salad: 'Crisp, bright and built to order.',
  'Burger and Sandwiches': 'On toasted buns and fresh baguette.',
  Spaghetti: 'Tossed to order, never sitting.',
  'Ethiopian Delights': 'The dishes we grew up on.',
  'Asian Fusion': 'A little heat, a lot of wok.',
};

const label = (cat: string) => CATEGORY_LABELS[cat] || cat;

export const MenuSection: React.FC<MenuSectionProps> = ({ menuItems, onAddToCart }) => {
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [fastingFilterOnly, setFastingFilterOnly] = useState(false);
  const [vegetarianFilterOnly, setVegetarianFilterOnly] = useState(false);

  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);
  const [selectedToppings, setSelectedToppings] = useState<Topping[]>([]);
  const [specialNotes, setSpecialNotes] = useState('');
  const [quantity, setQuantity] = useState(1);

  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (activeCategory !== 'All' && item.category !== activeCategory) return false;
      if (fastingFilterOnly && !item.isFasting) return false;
      if (vegetarianFilterOnly && !item.isVegetarian) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return (
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          !!item.groupLabel?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [menuItems, activeCategory, fastingFilterOnly, vegetarianFilterOnly, searchQuery]);

  // Known categories keep their curated order; any category staff add later is appended,
  // and categories with no dishes are hidden.
  const categories = useMemo(() => {
    const present = new Set(menuItems.map((i) => i.category));
    const extra = [...present].filter((c) => !CATEGORIES.includes(c));
    return [...CATEGORIES.filter((c) => present.has(c)), ...extra];
  }, [menuItems]);

  const grouped = useMemo(
    () =>
      categories
        .map((cat) => ({ cat, items: filteredItems.filter((i) => i.category === cat) }))
        .filter((g) => g.items.length > 0),
    [categories, filteredItems]
  );

  // If staff remove the last dish in the selected category, fall back to everything
  useEffect(() => {
    if (activeCategory !== 'All' && menuItems.length > 0 && !categories.includes(activeCategory)) {
      setActiveCategory('All');
    }
  }, [categories, activeCategory, menuItems.length]);

  // Lock page scroll while the item sheet is open; close on Escape
  useEffect(() => {
    if (!customizingItem) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setCustomizingItem(null);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [customizingItem]);

  const handleOpenCustomize = (item: MenuItem) => {
    if (!item.available) return;
    setCustomizingItem(item);
    setSelectedToppings([]);
    setSpecialNotes('');
    setQuantity(1);
  };

  const handleUpdateToppingQty = (topping: Topping, delta: number) => {
    setSelectedToppings((prev) => {
      const existing = prev.find((t) => t.id === topping.id);
      const newQty = Math.min(ORDER_LIMITS.maxExtraQuantity, (existing ? existing.quantity || 1 : 0) + delta);
      if (newQty <= 0) return prev.filter((t) => t.id !== topping.id);
      if (!existing) return [...prev, { ...topping, quantity: newQty }];
      return prev.map((t) => (t.id === topping.id ? { ...t, quantity: newQty } : t));
    });
  };

  const handleConfirmAddToCart = () => {
    if (!customizingItem) return;
    onAddToCart(customizingItem, selectedToppings, specialNotes, quantity);
    setCustomizingItem(null);
  };

  const modalCurrentTotal = useMemo(() => {
    if (!customizingItem) return 0;
    const toppingsSum = selectedToppings.reduce((sum, t) => sum + t.price * (t.quantity || 1), 0);
    return (customizingItem.price + toppingsSum) * quantity;
  }, [customizingItem, selectedToppings, quantity]);

  const filtersActive = fastingFilterOnly || vegetarianFilterOnly || searchQuery.trim() !== '';

  return (
    <section id="menu-section" className="scroll-mt-[68px] sm:scroll-mt-[84px] pt-16 sm:pt-24 pb-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Heading */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10">
          <div>
            <h2 className="font-display text-4xl sm:text-5xl font-medium text-white tracking-tight">
              The menu
            </h2>
            <p className="mt-3 text-white/60 max-w-md">
              Prices are in Ethiopian birr, tax included. Everything is cooked when your slot comes up.
            </p>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-0 top-1/2 -translate-y-1/2 text-white/60" strokeWidth={1.75} />
            <input
              type="text"
              placeholder="Search the menu"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-7 py-2.5 bg-transparent border-b border-white/15 focus:border-white text-[15px] placeholder:text-white/40 outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Category nav */}
        <div className="sticky top-[68px] sm:top-[84px] z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 bg-ink/90 backdrop-blur-md border-b border-white/15 mb-12">
          <div className="flex items-center gap-2 py-3 overflow-x-auto scrollbar-none">
            {['All', ...categories].map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`shrink-0 px-4 h-9 rounded-full text-sm whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-accent text-white'
                      : 'bg-white text-ink hover:bg-paper'
                  }`}
                >
                  {cat === 'All' ? 'Everything' : label(cat)}
                </button>
              );
            })}

            <span className="h-5 w-px bg-white/15 shrink-0 ml-auto mx-2" />

            {[
              { on: fastingFilterOnly, set: setFastingFilterOnly, text: 'Fasting' },
              { on: vegetarianFilterOnly, set: setVegetarianFilterOnly, text: 'Vegetarian' },
            ].map((f) => (
              <button
                key={f.text}
                onClick={() => f.set(!f.on)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-sm border transition-colors ${
                  f.on
                    ? 'bg-sage border-sage text-ink'
                    : 'border-white/25 text-white/85 hover:border-white/60'
                }`}
              >
                {f.on && <Check className="w-3.5 h-3.5" strokeWidth={2.25} />}
                {f.text}
              </button>
            ))}
          </div>
        </div>

        {/* Items */}
        {grouped.length === 0 ? (
          <div className="py-24 text-center">
            <p className="font-display text-2xl text-white">Nothing matches that.</p>
            <p className="text-white/60 mt-2">Try another word, or clear your filters.</p>
            {filtersActive && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFastingFilterOnly(false);
                  setVegetarianFilterOnly(false);
                }}
                className="mt-6 text-sm text-accent underline underline-offset-4"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-20">
            {grouped.map(({ cat, items }) => (
              <div key={cat}>
                <div className="flex items-baseline justify-between gap-4 mb-8">
                  <div className="flex items-baseline gap-4">
                    <h3 className="font-display text-3xl sm:text-[34px] text-white">{label(cat)}</h3>
                    <span className="text-sm text-white/60 tabular">{items.length}</span>
                  </div>
                  {CATEGORY_NOTES[cat] && (
                    <p className="hidden sm:block text-sm text-white/60 italic font-display">
                      {CATEGORY_NOTES[cat]}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
                  {items.map((item) => (
                    <MenuCard key={item.id} item={item} onOpen={handleOpenCustomize} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Item sheet */}
      {customizingItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
          <div
            className="absolute inset-0 bg-ink/50 animate-fade"
            onClick={() => setCustomizingItem(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={customizingItem.name}
            className="relative bg-card w-full sm:max-w-xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl animate-rise"
          >
            <div className="overflow-y-auto">
              <div className="relative aspect-[16/9] bg-paper-2">
                {customizingItem.imageUrl && (
                  <img
                    src={customizingItem.imageUrl}
                    alt=""
                    width={1280}
                    height={720}
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                )}
                <button
                  onClick={() => setCustomizingItem(null)}
                  className="absolute top-4 right-4 w-9 h-9 rounded-full bg-card/90 hover:bg-card text-ink flex items-center justify-center"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-6 sm:px-8 pt-6 pb-2">
                <p className="text-sm text-muted">{customizingItem.groupLabel || label(customizingItem.category)}</p>
                <div className="flex items-baseline justify-between gap-4 mt-1">
                  <h3 className="font-display text-[28px] leading-tight text-ink">{customizingItem.name}</h3>
                  <span className="text-lg text-ink tabular shrink-0">
                    {customizingItem.price.toLocaleString()} br
                  </span>
                </div>
                <p className="mt-3 text-ink-2/80 leading-relaxed">{customizingItem.description}</p>
              </div>

              {customizingItem.availableToppings && customizingItem.availableToppings.length > 0 && (
                <div className="px-6 sm:px-8 pt-6">
                  <div className="flex items-baseline justify-between mb-2">
                    <h4 className="font-medium text-ink">Add extras</h4>
                    {selectedToppings.length > 0 ? (
                      <button
                        onClick={() => setSelectedToppings([])}
                        className="text-sm text-muted hover:text-accent"
                      >
                        Clear
                      </button>
                    ) : (
                      <span className="text-sm text-muted">Optional</span>
                    )}
                  </div>
                  <ul className="divide-y divide-line border-y border-line">
                    {customizingItem.availableToppings.map((top) => {
                      const qty = selectedToppings.find((t) => t.id === top.id)?.quantity || 0;
                      const selected = qty > 0;
                      return (
                        <li key={top.id} className="flex items-center gap-3 py-3">
                          <button
                            onClick={() => handleUpdateToppingQty(top, selected ? -qty : 1)}
                            className="flex-1 flex items-center gap-3 text-left"
                          >
                            <span
                              className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 ${
                                selected ? 'bg-ink border-ink text-paper' : 'border-ink/30'
                              }`}
                            >
                              {selected && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
                            </span>
                            <span className="text-[15px] text-ink">{top.name}</span>
                          </button>

                          {selected ? (
                            <Stepper
                              value={qty}
                              onDec={() => handleUpdateToppingQty(top, -1)}
                              onInc={() => handleUpdateToppingQty(top, 1)}
                              small
                            />
                          ) : null}

                          <span className="w-16 text-right text-sm text-muted tabular">
                            +{(top.price * Math.max(qty, 1)).toLocaleString()}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="px-6 sm:px-8 pt-6 pb-6">
                <label htmlFor="item-notes" className="font-medium text-ink block mb-2">
                  Notes for the kitchen
                </label>
                <textarea
                  id="item-notes"
                  rows={2}
                  value={specialNotes}
                  onChange={(e) => setSpecialNotes(e.target.value)}
                  placeholder="No onions, dressing on the side…"
                  className="w-full px-4 py-3 bg-paper border border-line rounded-xl text-[15px] placeholder:text-muted/70 outline-none focus:border-ink transition-colors resize-none"
                />
              </div>
            </div>

            <div className="border-t border-line bg-card px-6 sm:px-8 py-4 flex items-center gap-4">
              <Stepper
                value={quantity}
                onDec={() => setQuantity(Math.max(1, quantity - 1))}
                onInc={() => setQuantity(Math.min(ORDER_LIMITS.maxItemQuantity, quantity + 1))}
              />
              <button
                onClick={handleConfirmAddToCart}
                className="flex-1 flex items-center justify-between bg-accent hover:bg-accent-dark text-white h-12 px-5 rounded-full transition-colors"
              >
                <span className="font-medium">Add to bag</span>
                <span className="tabular">{modalCurrentTotal.toLocaleString()} br</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const MenuCard: React.FC<{ item: MenuItem; onOpen: (item: MenuItem) => void }> = ({ item, onOpen }) => {
  const tags = [
    item.isSpecial && "Chef's pick",
    item.isFasting && 'Fasting',
    item.isVegetarian && !item.isFasting && 'Vegetarian',
  ].filter(Boolean) as string[];

  return (
    <article className={`group ${item.available ? '' : 'opacity-60'}`}>
      <button
        onClick={() => onOpen(item)}
        disabled={!item.available}
        className="block w-full text-left disabled:cursor-not-allowed"
        aria-label={item.available ? `Add ${item.name}` : `${item.name}, sold out`}
      >
        <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-ink-2">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt=""
              width={800}
              height={600}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            />
          ) : (
            <div className="w-full h-full grain" />
          )}

          {item.available ? (
            <span className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-white text-ink flex items-center justify-center shadow-md transition-all group-hover:bg-accent group-hover:text-white">
              <Plus className="w-5 h-5" strokeWidth={1.75} />
            </span>
          ) : (
            <span className="absolute top-3 left-3 px-3 py-1 rounded-full bg-white text-ink text-xs">
              Sold out today
            </span>
          )}
        </div>

        <div className="pt-4">
          <div className="flex items-baseline justify-between gap-4">
            <h4 className="font-display text-xl leading-snug text-white group-hover:text-accent transition-colors">
              {item.name}
            </h4>
            <span className="text-[15px] text-white tabular shrink-0">
              {item.price.toLocaleString()}
            </span>
          </div>
          <p className="mt-1.5 text-[15px] text-white/60 leading-relaxed line-clamp-2">
            {item.description}
          </p>
          {tags.length > 0 && (
            <p className="mt-2.5 text-xs text-sage tracking-wide">{tags.join('  ·  ')}</p>
          )}
        </div>
      </button>
    </article>
  );
};

const Stepper: React.FC<{ value: number; onDec: () => void; onInc: () => void; small?: boolean }> = ({
  value,
  onDec,
  onInc,
  small,
}) => {
  const size = small ? 'w-7 h-7' : 'w-10 h-10';
  return (
    <div className={`flex items-center rounded-full border border-line ${small ? '' : 'h-12 px-1'}`}>
      <button onClick={onDec} className={`${size} rounded-full flex items-center justify-center text-ink hover:bg-paper-2`} aria-label="Decrease">
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className={`${small ? 'w-5 text-sm' : 'w-7'} text-center tabular text-ink`}>{value}</span>
      <button onClick={onInc} className={`${size} rounded-full flex items-center justify-center text-ink hover:bg-paper-2`} aria-label="Increase">
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
