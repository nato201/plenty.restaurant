/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Copy } from 'lucide-react';
import { DaySchedule, RestaurantSettings } from '../types.ts';
import { DAY_NAMES, formatTime12, getWeeklySchedule, summarizeWeek, validateWeeklySchedule } from '../utils/schedule.ts';
import { optimistic } from '../utils/optimistic.ts';

/** Monday first, the way the restaurant thinks about its week */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const OpeningHoursCard: React.FC<{
  settings: RestaurantSettings;
  canEdit: boolean;
  onSaved: (settings: RestaurantSettings) => void;
}> = ({ settings, canEdit, onSaved }) => {
  const saved = useMemo(() => getWeeklySchedule(settings), [settings]);
  const [draft, setDraft] = useState<DaySchedule[]>(saved);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Pick up changes made elsewhere (e.g. after a refresh), unless there are unsaved edits
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const validation = validateWeeklySchedule(draft);

  const setDay = (day: number, changes: Partial<DaySchedule>) => {
    setMessage(null);
    setDraft((d) => d.map((entry, i) => (i === day ? { ...entry, ...changes } : entry)));
  };

  const copyMondayToOpenDays = () => {
    const mon = draft[1];
    setMessage(null);
    setDraft((d) => d.map((entry) => (entry.isOpen ? { ...entry, openTime: mon.openTime, closeTime: mon.closeTime } : entry)));
  };

  // Optimistic: the hours show as saved at once. If the server refuses, the saved hours go back
  // to what they were, and the edits stay in the form (marked unsaved) with the reason.
  const save = () => {
    if (validation) return setMessage({ tone: 'error', text: validation });
    const before = settings;
    const week = draft;
    setSaving(true);
    optimistic<{ settings: RestaurantSettings }>({
      apply: () => {
        onSaved({ ...before, weeklySchedule: week });
        setMessage({ tone: 'ok', text: 'Opening hours saved. Customers see them right away.' });
      },
      rollback: () => {
        onSaved(before);
        setDraft(week); // keep what was typed
      },
      request: () =>
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weeklySchedule: week }),
        }),
      failMessage: 'Couldn’t save opening hours.',
      onSuccess: (data) => data.settings && onSaved(data.settings),
      onFailure: (reason) => setMessage({ tone: 'error', text: `Not saved: ${reason}` }),
    }).finally(() => setSaving(false));
  };

  const lastPickup = (d: DaySchedule) => {
    const [h, m] = d.closeTime.split(':').map(Number);
    return formatTime12(h * 60 + m - (settings.orderCutoffMinutesBeforeClose ?? 30));
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl text-ink">Opening hours</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Customers can only choose pickup times inside these hours. All times are Addis Ababa time.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={copyMondayToOpenDays}
            className="self-start text-sm text-slate-600 hover:text-ink flex items-center gap-1.5 px-3 h-9 rounded-lg hover:bg-slate-100"
          >
            <Copy className="w-4 h-4" /> Copy Monday to all open days
          </button>
        )}
      </div>

      <ul className="divide-y divide-slate-100 border-y border-slate-100">
        {WEEK_ORDER.map((day) => {
          const d = draft[day];
          return (
            <li key={day} className="py-3 grid grid-cols-[7.5rem_auto_1fr] items-center gap-3">
              <span className="font-medium text-ink">{DAY_NAMES[day]}</span>

              <label className={`flex items-center gap-2 text-sm ${canEdit ? 'cursor-pointer' : 'opacity-70'}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={d.isOpen}
                  aria-label={`${DAY_NAMES[day]} open`}
                  disabled={!canEdit}
                  onClick={() => setDay(day, { isOpen: !d.isOpen })}
                  className={`relative w-10 h-6 rounded-full transition-colors shrink-0 disabled:cursor-not-allowed ${
                    d.isOpen ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      d.isOpen ? 'translate-x-4' : ''
                    }`}
                  />
                </button>
                <span className={`w-14 ${d.isOpen ? 'text-emerald-700' : 'text-slate-500'}`}>{d.isOpen ? 'Open' : 'Closed'}</span>
              </label>

              {d.isOpen ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <input
                    type="time"
                    aria-label={`${DAY_NAMES[day]} opening time`}
                    disabled={!canEdit}
                    value={d.openTime}
                    onChange={(e) => setDay(day, { openTime: e.target.value })}
                    className="h-9 px-2 rounded-lg border border-slate-200 bg-slate-50 tabular disabled:opacity-70"
                  />
                  <span className="text-slate-400">to</span>
                  <input
                    type="time"
                    aria-label={`${DAY_NAMES[day]} closing time`}
                    disabled={!canEdit}
                    value={d.closeTime}
                    onChange={(e) => setDay(day, { closeTime: e.target.value })}
                    className="h-9 px-2 rounded-lg border border-slate-200 bg-slate-50 tabular disabled:opacity-70"
                  />
                  <span className="text-xs text-slate-400 hidden md:inline">last pickup {lastPickup(d)}</span>
                </div>
              ) : (
                <span className="text-sm text-slate-400">No orders</span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
        <span className="text-slate-500">Customers will see: </span>
        {summarizeWeek(draft)
          .map((g) => `${g.label} ${g.hours ?? 'closed'}`)
          .join(' · ')}
      </div>

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : undefined}
          className={`text-sm rounded-xl px-4 py-2.5 border ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          {message.text}
        </p>
      )}
      {!message && validation && dirty && <p className="text-sm text-red-600">{validation}</p>}

      {canEdit ? (
        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <button type="button" onClick={() => setDraft(saved)} className="h-10 px-4 rounded-xl text-sm text-slate-600 hover:bg-slate-100">
              Discard changes
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving || !!validation}
            className="h-10 px-5 rounded-xl bg-accent hover:bg-accent-dark disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save opening hours
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-400">Only owners and managers can change opening hours.</p>
      )}
    </div>
  );
};
