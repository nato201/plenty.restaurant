/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DaySchedule, RestaurantSettings } from '../types.ts';

/** All opening hours are in the restaurant's local time, wherever the server or visitor is. */
export const RESTAURANT_TIME_ZONE = 'Africa/Addis_Ababa';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** "23:30" → "11:30 PM" (the same labels used for pickup slots) */
export function formatTime12(minutesOrHHMM: number | string): string {
  const m = typeof minutesOrHHMM === 'number' ? minutesOrHHMM : toMinutes(minutesOrHHMM);
  return `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${Math.floor(m / 60) % 24 >= 12 ? 'PM' : 'AM'}`;
}

/** Friendlier form for prose: "9 am", "11:30 pm" */
export function formatTimeShort(hhmm: string): string {
  const m = toMinutes(hhmm);
  const h = Math.floor(m / 60) % 12 || 12;
  const min = m % 60;
  return `${h}${min ? `:${String(min).padStart(2, '0')}` : ''} ${m >= 720 ? 'pm' : 'am'}`;
}

/** The week's schedule, falling back to the older single open/close time if needed. */
export function getWeeklySchedule(settings: Partial<RestaurantSettings>): DaySchedule[] {
  if (Array.isArray(settings.weeklySchedule) && settings.weeklySchedule.length === 7) {
    return settings.weeklySchedule;
  }
  const open = settings.operatingHours?.openTime || '09:00';
  const close = settings.operatingHours?.closeTime || '23:30';
  const days = settings.availableDays || [1, 2, 3, 4, 5];
  return DAY_NAMES.map((_, i) => ({ isOpen: days.includes(i), openTime: open, closeTime: close }));
}

/** Day of week (0 = Sunday) for a 'YYYY-MM-DD' date. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Today's date and the current minute of the day in Addis Ababa. */
export function restaurantNow(now: Date = new Date()): { date: string; minutes: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: RESTAURANT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, minutes: Number(parts.hour) * 60 + Number(parts.minute), day: dayOfWeek(date) };
}

/** Check a schedule from the staff portal. Returns an error message, or null if it's fine. */
export function validateWeeklySchedule(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 7) return 'Opening hours need an entry for each day of the week.';
  for (let i = 0; i < 7; i++) {
    const d = value[i] as DaySchedule;
    if (!d || typeof d.isOpen !== 'boolean') return `Check ${DAY_NAMES[i]}.`;
    if (!TIME_RE.test(d.openTime) || !TIME_RE.test(d.closeTime)) return `Enter valid times for ${DAY_NAMES[i]}.`;
    if (d.isOpen && toMinutes(d.closeTime) <= toMinutes(d.openTime)) {
      return `${DAY_NAMES[i]}: closing time must be after opening time.`;
    }
  }
  return null;
}

/**
 * Group days with the same hours for display, in Monday-first order:
 * e.g. [{ label: 'Mon – Fri', hours: '9:00 AM – 11:30 PM' }, { label: 'Sat – Sun', hours: null }]
 */
export function summarizeWeek(schedule: DaySchedule[]): { label: string; hours: string | null }[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const key = (d: DaySchedule) => (d.isOpen ? `${d.openTime}-${d.closeTime}` : 'closed');
  const groups: { days: number[]; key: string }[] = [];
  for (const day of order) {
    const k = key(schedule[day]);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.days.push(day);
    else groups.push({ days: [day], key: k });
  }
  return groups.map((g) => {
    const first = DAY_SHORT[g.days[0]];
    const lastDay = DAY_SHORT[g.days[g.days.length - 1]];
    const d = schedule[g.days[0]];
    return {
      label: g.days.length === 1 ? DAY_NAMES[g.days[0]] : `${first} – ${lastDay}`,
      hours: d.isOpen ? `${formatTime12(d.openTime)} – ${formatTime12(d.closeTime)}` : null,
    };
  });
}

/** 'YYYY-MM-DD' plus n days */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The first date (from `from`, within `maxDaysAhead`) the restaurant is open and still taking
 * orders. Today counts only if there's still time before the last pickup.
 */
export function nextOrderableDate(
  schedule: DaySchedule[],
  opts: { holidays?: string[]; maxDaysAhead?: number; cutoffMinutes?: number; minPrepMinutes?: number } = {},
  now: Date = new Date()
): string {
  const { date: today, minutes } = restaurantNow(now);
  const max = opts.maxDaysAhead ?? 7;
  for (let i = 0; i <= max; i++) {
    const date = addDays(today, i);
    const day = schedule[dayOfWeek(date)];
    if (!day?.isOpen || opts.holidays?.includes(date)) continue;
    if (i === 0) {
      const lastPickup = toMinutes(day.closeTime) - (opts.cutoffMinutes ?? 30);
      if (minutes + (opts.minPrepMinutes ?? 0) > lastPickup) continue;
    }
    return date;
  }
  return today;
}

/** A short status line for the homepage, e.g. "Open today until 11:30 pm". */
export function openStatusLine(schedule: DaySchedule[], now: Date = new Date()): string {
  const { day, minutes } = restaurantNow(now);
  const today = schedule[day];
  if (today?.isOpen) {
    if (minutes < toMinutes(today.openTime)) return `Opens today at ${formatTimeShort(today.openTime)}`;
    if (minutes < toMinutes(today.closeTime)) return `Open today until ${formatTimeShort(today.closeTime)}`;
  }
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    if (schedule[d]?.isOpen) {
      const when = i === 1 ? 'tomorrow' : DAY_NAMES[d];
      return `Closed now · opens ${when} at ${formatTimeShort(schedule[d].openTime)}`;
    }
  }
  return 'Closed for now';
}
