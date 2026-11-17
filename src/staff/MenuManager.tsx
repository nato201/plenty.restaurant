/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Pencil, Trash2, X, ImagePlus, Loader2, Link2 } from 'lucide-react';
import { MenuItem, Topping } from '../types.ts';
import { optimistic } from '../utils/optimistic.ts';

/** Categories the storefront already knows how to label and order. New ones can be typed in. */
const DEFAULT_CATEGORIES = [
  'Breakfast',
  'Salad',
  'Burger and Sandwiches',
  'Spaghetti',
  'Ethiopian Delights',
  'Asian Fusion',
];

type DishDraft = {
  id?: string;
  name: string;
  category: string;
  groupLabel: string;
  description: string;
  price: string;
  imageUrl: string;
  available: boolean;
  isVegetarian: boolean;
  isFasting: boolean;
  isSpecial: boolean;
  availableToppings: { id?: string; name: string; price: string }[];
};

const emptyDraft = (category = DEFAULT_CATEGORIES[0]): DishDraft => ({
  name: '',
  category,
  groupLabel: '',
  description: '',
  price: '',
  imageUrl: '',
  available: true,
  isVegetarian: false,
  isFasting: false,
  isSpecial: false,
  availableToppings: [],
});

const toDraft = (item: MenuItem): DishDraft => ({
  id: item.id,
  name: item.name,
  category: item.category,
  groupLabel: item.groupLabel || '',
  description: item.description,
  price: String(item.price),
  imageUrl: item.imageUrl || '',
  available: item.available,
  isVegetarian: !!item.isVegetarian,
  isFasting: !!item.isFasting,
  isSpecial: !!item.isSpecial,
  availableToppings: (item.availableToppings || []).map((t: Topping) => ({ id: t.id, name: t.name, price: String(t.price) })),
});

export const MenuManager: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<DishDraft | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  // Dishes saved on screen but not yet confirmed by the server
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const markPending = (id: string, on: boolean) =>
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const [flash, setFlash] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await fetch('/api/menu').then((r) => r.json());
      if (data.success) setItems(data.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  const categories = useMemo(() => {
    const seen = new Set(DEFAULT_CATEGORIES);
    const extra = items.map((i) => i.category).filter((c) => !seen.has(c) && (seen.add(c), true));
    return [...DEFAULT_CATEGORIES, ...extra];
  }, [items]);

  const groupLabels = useMemo(
    () => Array.from(new Set(items.map((i) => i.groupLabel).filter(Boolean) as string[])).sort(),
    [items]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (category === 'all' || i.category === category) &&
        (!q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
    );
  }, [items, query, category]);

  const soldOut = items.filter((i) => !i.available).length;

  const flip = (id: string) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, available: !i.available } : i)));

  // Sold out / back in stock: the switch moves at once and flips back if the server says no
  const toggleAvailability = (item: MenuItem) =>
    optimistic<{ item: MenuItem }>({
      apply: () => flip(item.id),
      rollback: () => flip(item.id),
      request: () => fetch(`/api/menu/${item.id}/toggle`, { method: 'POST' }),
      failMessage: `Couldn’t mark ${item.name} as ${item.available ? 'sold out' : 'in stock'}.`,
      onSuccess: (data) => data.item && setItems((prev) => prev.map((i) => (i.id === item.id ? data.item : i))),
    });

  // Delete: the dish disappears at once and comes back in the same place if the delete fails
  const remove = (item: MenuItem) => {
    if (!window.confirm(`Delete “${item.name}” from the menu? Past orders keep their record of it.`)) return;
    const index = items.findIndex((i) => i.id === item.id);
    optimistic({
      apply: () => {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setFlash(`Deleted ${item.name}.`);
      },
      rollback: () => {
        setFlash(null);
        setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev.slice(0, index), item, ...prev.slice(index)]));
      },
      request: () => fetch(`/api/menu/${item.id}`, { method: 'DELETE' }),
      failMessage: `Couldn’t delete ${item.name}.`,
    });
  };

  // Save from the editor: the editor closes and the list updates at once. If the server rejects
  // it, the old version comes back and the editor reopens with what was typed and the reason.
  const submitDish = (draft: DishDraft, payload: Record<string, any>) => {
    const isNew = !draft.id;
    const id = draft.id || `tmp-${Date.now()}`;
    const previous = isNew ? null : items.find((i) => i.id === id) || null;
    const shown: MenuItem = {
      ...(previous || {}),
      id,
      name: payload.name,
      category: payload.category,
      groupLabel: payload.groupLabel || undefined,
      description: payload.description,
      price: payload.price,
      available: payload.available,
      imageUrl: payload.imageUrl || undefined,
      isVegetarian: payload.isVegetarian,
      isFasting: payload.isFasting,
      isSpecial: payload.isSpecial,
      availableToppings: payload.availableToppings.map((t: any, n: number) => ({ id: t.id || `tmp-${n}`, name: t.name, price: t.price })),
    };
    setEditing(null);
    setEditorError(null);
    optimistic<{ item: MenuItem }>({
      apply: () => {
        markPending(id, true);
        setItems((prev) => (isNew ? [...prev, shown] : prev.map((i) => (i.id === id ? shown : i))));
        setFlash(isNew ? `Added ${shown.name} to the menu.` : `Saved changes to ${shown.name}.`);
      },
      rollback: () => {
        markPending(id, false);
        setFlash(null);
        setItems((prev) => (isNew ? prev.filter((i) => i.id !== id) : prev.map((i) => (i.id === id && previous ? previous : i))));
      },
      request: () =>
        fetch(isNew ? '/api/menu' : `/api/menu/${id}`, {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      failMessage: `Couldn’t save ${shown.name || 'this dish'}.`,
      onSuccess: (data) => {
        markPending(id, false);
        // Swap in the saved dish (real id for new dishes, cleaned-up values)
        if (data.item) setItems((prev) => prev.map((i) => (i.id === id ? data.item : i)));
      },
      onFailure: (reason) => {
        setEditorError(reason);
        setEditing(draft); // reopen with everything the user typed
      },
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs">
      <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
        <div>
          <h3 className="font-serif text-2xl text-ink">Menu</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            {items.length} dishes{soldOut > 0 ? ` · ${soldOut} sold out today` : ''}. Changes show on the website within seconds.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search dishes"
              className="h-10 pl-9 pr-3 w-full sm:w-56 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-ink"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-ink"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {canEdit && (
            <button
              onClick={() => {
                setEditorError(null);
                setEditing(emptyDraft(category !== 'all' ? category : undefined));
              }}
              className="h-10 px-4 rounded-xl bg-accent hover:bg-accent-dark text-white text-sm font-semibold flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Add dish
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div className="mx-5 sm:mx-6 mt-4 px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-800 text-sm border border-emerald-200">
          {flash}
        </div>
      )}

      {loading ? (
        <div className="p-16 flex justify-center">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="p-16 text-center text-slate-500 text-sm">No dishes match.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {visible.map((item) => (
            <li
              key={item.id}
              aria-busy={pendingIds.has(item.id)}
              className={`px-5 sm:px-6 py-4 flex items-center gap-4 transition-opacity ${pendingIds.has(item.id) ? 'opacity-60' : ''}`}
            >
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                {item.imageUrl && <img src={item.imageUrl} alt="" width={56} height={56} loading="lazy" decoding="async" className="w-full h-full object-cover" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-ink truncate">{item.name}</span>
                  {item.isSpecial && <Tag tone="accent">Chef’s pick</Tag>}
                  {item.isFasting && <Tag tone="green">Fasting</Tag>}
                  {item.isVegetarian && !item.isFasting && <Tag tone="green">Vegetarian</Tag>}
                  {pendingIds.has(item.id) && (
                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Saving
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-500 truncate">
                  {item.category}
                  {item.groupLabel ? ` · ${item.groupLabel}` : ''}
                  {item.availableToppings?.length ? ` · ${item.availableToppings.length} extras` : ''}
                </div>
              </div>

              <div className="text-right tabular text-ink font-semibold w-20 shrink-0">{item.price.toLocaleString()} br</div>

              <label
                className={`hidden sm:flex items-center gap-2 text-sm w-32 shrink-0 ${canEdit ? 'cursor-pointer' : 'opacity-70'}`}
                title={canEdit ? 'Mark sold out / back in stock' : undefined}
              >
                <Switch
                  checked={item.available}
                  disabled={!canEdit || item.id.startsWith('tmp-')}
                  onChange={() => toggleAvailability(item)}
                />
                <span className={item.available ? 'text-emerald-700' : 'text-slate-500'}>
                  {item.available ? 'In stock' : 'Sold out'}
                </span>
              </label>

              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setEditorError(null);
                      setEditing(toDraft(item));
                    }}
                    disabled={pendingIds.has(item.id)}
                    className="p-2 rounded-lg text-slate-500 hover:text-ink hover:bg-slate-100"
                    aria-label={`Edit ${item.name}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => remove(item)}
                    disabled={pendingIds.has(item.id)}
                    className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50"
                    aria-label={`Delete ${item.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <DishEditor
          draft={editing}
          categories={categories}
          groupLabels={groupLabels}
          initialError={editorError}
          onClose={() => setEditing(null)}
          onSubmit={submitDish}
        />
      )}
    </div>
  );
};

const Tag: React.FC<{ tone: 'accent' | 'green'; children: React.ReactNode }> = ({ tone, children }) => (
  <span
    className={`text-[11px] px-2 py-0.5 rounded-full ${
      tone === 'accent' ? 'bg-accent/10 text-accent-dark' : 'bg-emerald-50 text-emerald-700'
    }`}
  >
    {children}
  </span>
);

const Switch: React.FC<{ checked: boolean; disabled?: boolean; onChange: () => void }> = ({ checked, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={onChange}
    className={`relative w-10 h-6 rounded-full transition-colors disabled:opacity-50 shrink-0 ${
      checked ? 'bg-emerald-500' : 'bg-slate-300'
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-4' : ''
      }`}
    />
  </button>
);

const field =
  'w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-[15px] text-ink outline-none focus:border-ink focus:ring-2 focus:ring-accent/20';

const DishEditor: React.FC<{
  draft: DishDraft;
  categories: string[];
  groupLabels: string[];
  initialError?: string | null;
  onClose: () => void;
  onSubmit: (draft: DishDraft, payload: Record<string, any>) => void;
}> = ({ draft: initial, categories, groupLabels, initialError, onClose, onSubmit }) => {
  const [draft, setDraft] = useState<DishDraft>(initial);
  const saving = false; // saves are optimistic: the editor closes immediately
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isNew = !initial.id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const set = <K extends keyof DishDraft>(key: K, value: DishDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const upload = async (file: File) => {
    setError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return setError('Photos must be JPG, PNG or WebP.');
    }
    if (file.size > 5 * 1024 * 1024) return setError('That photo is over 5 MB. Try a smaller one.');
    setUploading(true);
    try {
      const res = await fetch('/api/admin/uploads', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) set('imageUrl', data.url);
      else setError(data.error || 'Upload failed.');
    } catch {
      setError('Upload failed. Check your connection.');
    } finally {
      setUploading(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Quick checks here, so obvious mistakes don't need a round trip and a rollback
    const price = Number(draft.price);
    if (!draft.name.trim()) return setError('Give the dish a name.');
    if (!(price > 0)) return setError('Enter a price above 0.');
    if (uploading) return setError('Wait for the photo to finish uploading.');
    const payload = {
      ...draft,
      price,
      availableToppings: draft.availableToppings
        .filter((t) => t.name.trim())
        .map((t) => ({ id: t.id, name: t.name, price: Number(t.price || 0) })),
    };
    onSubmit(draft, payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/50 animate-fade" onClick={onClose} />
      <form
        onSubmit={save}
        className="relative w-full max-w-xl h-full bg-slate-50 flex flex-col shadow-2xl animate-slide-in"
        aria-label={isNew ? 'Add dish' : `Edit ${initial.name}`}
      >
        <div className="px-6 py-5 bg-white border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-serif text-2xl text-ink">{isNew ? 'Add a dish' : 'Edit dish'}</h3>
          <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-lg text-slate-500 hover:text-ink" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-7">
          {/* Photo */}
          <section>
            <Label>Photo</Label>
            <div className="flex gap-4 items-start">
              <div className="w-36 aspect-[4/3] rounded-xl overflow-hidden bg-slate-200 shrink-0 flex items-center justify-center">
                {uploading ? (
                  <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
                ) : draft.imageUrl ? (
                  <img src={draft.imageUrl} alt="" width={144} height={108} decoding="async" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="w-6 h-6 text-slate-400" />
                )}
              </div>
              <div className="space-y-2 text-sm">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="h-9 px-3.5 rounded-lg bg-white border border-slate-200 hover:border-ink text-ink font-medium"
                >
                  {draft.imageUrl ? 'Replace photo' : 'Upload photo'}
                </button>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowLinkInput((v) => !v)} className="text-slate-500 hover:text-ink flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5" /> Use a link
                  </button>
                  {draft.imageUrl && (
                    <button type="button" onClick={() => set('imageUrl', '')} className="text-slate-500 hover:text-red-600">
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-slate-400 text-xs">JPG, PNG or WebP, up to 5 MB. Landscape works best.</p>
              </div>
            </div>
            {showLinkInput && (
              <input
                className={`${field} mt-3`}
                placeholder="https://…"
                value={draft.imageUrl.startsWith('/uploads/') ? '' : draft.imageUrl}
                onChange={(e) => set('imageUrl', e.target.value)}
              />
            )}
          </section>

          {/* Basics */}
          <section className="space-y-4">
            <div>
              <Label htmlFor="dish-name">Name</Label>
              <input id="dish-name" className={field} required maxLength={80} value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dish-category">Category</Label>
                <input
                  id="dish-category"
                  className={field}
                  required
                  maxLength={40}
                  list="dish-categories"
                  value={draft.category}
                  onChange={(e) => set('category', e.target.value)}
                />
                <datalist id="dish-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <Hint>Pick one, or type a new category.</Hint>
              </div>
              <div>
                <Label htmlFor="dish-group">
                  Section <span className="text-slate-400 font-normal">(optional)</span>
                </Label>
                <input
                  id="dish-group"
                  className={field}
                  maxLength={40}
                  list="dish-groups"
                  placeholder="e.g. Savory Plates"
                  value={draft.groupLabel}
                  onChange={(e) => set('groupLabel', e.target.value)}
                />
                <datalist id="dish-groups">
                  {groupLabels.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <Label htmlFor="dish-desc">Description</Label>
              <textarea
                id="dish-desc"
                rows={3}
                required
                maxLength={500}
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
                className={`${field} h-auto py-3 resize-none`}
              />
              <Hint>{draft.description.length}/500 · Customers see the first two lines on the menu.</Hint>
            </div>
            <div className="w-40">
              <Label htmlFor="dish-price">Price</Label>
              <div className="relative">
                <input
                  id="dish-price"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  required
                  value={draft.price}
                  onChange={(e) => set('price', e.target.value)}
                  className={`${field} pr-12 tabular`}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">ETB</span>
              </div>
            </div>
          </section>

          {/* Flags */}
          <section>
            <Label>Labels</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  ['available', 'In stock today', 'Untick to show it as sold out'],
                  ['isSpecial', 'Chef’s pick', 'Highlighted on the menu'],
                  ['isFasting', 'Fasting', 'Vegan, no animal products'],
                  ['isVegetarian', 'Vegetarian', 'No meat or fish'],
                ] as const
              ).map(([key, title, hint]) => (
                <label key={key} className="flex items-start gap-3 p-3 rounded-xl bg-white border border-slate-200 cursor-pointer hover:border-slate-300">
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    onChange={(e) => set(key, e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-accent"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">{title}</span>
                    <span className="block text-xs text-slate-500">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* Extras */}
          <section>
            <div className="flex items-baseline justify-between">
              <Label>Extras customers can add</Label>
              <span className="text-xs text-slate-400">{draft.availableToppings.length}/30</span>
            </div>
            {draft.availableToppings.length > 0 && (
              <ul className="space-y-2 mb-3">
                {draft.availableToppings.map((t, i) => (
                  <li key={t.id || `new-${i}`} className="flex gap-2">
                    <input
                      className={field}
                      placeholder="Extra (e.g. Fried egg)"
                      maxLength={60}
                      value={t.name}
                      onChange={(e) =>
                        set(
                          'availableToppings',
                          draft.availableToppings.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                        )
                      }
                    />
                    <div className="relative w-32 shrink-0">
                      <input
                        className={`${field} pr-11 tabular`}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={t.price}
                        onChange={(e) =>
                          set(
                            'availableToppings',
                            draft.availableToppings.map((x, j) => (j === i ? { ...x, price: e.target.value } : x))
                          )
                        }
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">ETB</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => set('availableToppings', draft.availableToppings.filter((_, j) => j !== i))}
                      className="p-2.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50"
                      aria-label="Remove extra"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {draft.availableToppings.length < 30 && (
              <button
                type="button"
                onClick={() => set('availableToppings', [...draft.availableToppings, { name: '', price: '' }])}
                className="text-sm font-medium text-accent hover:text-accent-dark flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Add an extra
              </button>
            )}
          </section>
        </div>

        <div className="px-6 py-4 bg-white border-t border-slate-200">
          {error && (
            <p role="alert" className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="h-11 px-5 rounded-xl text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploading}
              className="h-11 px-6 rounded-xl bg-accent hover:bg-accent-dark disabled:opacity-60 text-white font-semibold flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isNew ? 'Add to menu' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

const Label: React.FC<{ htmlFor?: string; children: React.ReactNode }> = ({ htmlFor, children }) => (
  <label htmlFor={htmlFor} className="block text-sm font-medium text-ink mb-1.5">
    {children}
  </label>
);

const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs text-slate-400 mt-1.5">{children}</p>
);
