/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { dismissToast, subscribeToasts, Toast } from '../utils/optimistic.ts';

/** Shows messages from showToast(), e.g. when an optimistic change had to be undone. */
export const Toaster: React.FC = () => {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 sm:bottom-6 z-[60] flex flex-col gap-2 sm:w-96 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 shadow-xl border text-sm animate-rise ${
            t.tone === 'error' ? 'bg-white border-red-200 text-red-800' : 'bg-white border-emerald-200 text-emerald-800'
          }`}
        >
          {t.tone === 'error' ? (
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-px" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-px" />
          )}
          <p className="flex-1 leading-snug">{t.text}</p>
          <button onClick={() => dismissToast(t.id)} className="text-slate-400 hover:text-ink" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
