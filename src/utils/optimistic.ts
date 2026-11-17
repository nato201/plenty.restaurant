/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Optimistic updates: change the screen first, send the request in the background, and undo the
 * change with a message if the server says no (or can't be reached).
 *
 * Rollbacks should undo only THIS change (e.g. flip one dish back), not restore a whole snapshot,
 * so another edit made in the meantime isn't thrown away.
 */

type Tone = 'error' | 'ok';
export interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

// --- A tiny app-wide toast store (no context needed) ---
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((l) => l(toasts));

export function showToast(text: string, tone: Tone = 'error'): void {
  const toast = { id: nextId++, tone, text };
  toasts = [...toasts.slice(-3), toast]; // keep at most 4 on screen
  emit();
  setTimeout(() => dismissToast(toast.id), tone === 'error' ? 7000 : 3500);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: (t: Toast[]) => void): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}

// --- The optimistic helper ---
export interface OptimisticOptions<T> {
  /** Update the screen now. */
  apply: () => void;
  /** Undo exactly what `apply` did. */
  rollback: () => void;
  /** The request to send in the background. */
  request: () => Promise<Response>;
  /** Shown if it fails, e.g. "Couldn’t mark Salmon Wrap as sold out." The server's reason is added. */
  failMessage: string;
  /** Called with the server's answer, to swap in the saved data (ids, timestamps…). */
  onSuccess?: (data: T) => void;
  /** Called after a rollback, e.g. to reopen a form. */
  onFailure?: (reason: string) => void;
}

/** Returns true if the server accepted the change. */
export async function optimistic<T = any>(opts: OptimisticOptions<T>): Promise<boolean> {
  opts.apply();
  let reason = '';
  try {
    const res = await opts.request();
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.success !== false) {
      opts.onSuccess?.(data as T);
      return true;
    }
    reason = data?.error || `The server answered ${res.status}.`;
  } catch {
    reason = 'Couldn’t reach the server. Check your connection.';
  }
  opts.rollback();
  showToast(`${opts.failMessage} ${reason}`.trim());
  opts.onFailure?.(reason);
  return false;
}
