/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Plus, Loader2, KeyRound } from 'lucide-react';
import { AdminRole, AdminUser } from '../types.ts';
import { optimistic } from '../utils/optimistic.ts';

const ROLES: { value: AdminRole; label: string; hint: string }[] = [
  { value: 'super_admin', label: 'Owner', hint: 'Everything, including refunds, settings and staff accounts' },
  { value: 'restaurant_admin', label: 'Manager', hint: 'Orders, menu and kitchen capacity' },
  { value: 'reporting', label: 'Viewer', hint: 'Read-only: orders, reports and logs' },
];

const field =
  'h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm text-ink outline-none focus:border-ink focus:ring-2 focus:ring-accent/20';

async function saveUser(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.user) throw new Error(data.error || 'Couldn’t save.');
  return data.user as AdminUser;
}

export const StaffUsersPanel: React.FC<{ currentUserId: string }> = ({ currentUserId }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);

  const load = async () => {
    const data = await fetch('/api/admin/users').then((r) => r.json()).catch(() => null);
    if (data?.success) setUsers(data.users);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  /** Role and "can sign in": change on screen at once, change back if the server refuses. */
  const updateNow = (u: AdminUser, changes: Pick<Partial<AdminUser>, 'role' | 'isActive'>) => {
    setMessage(null);
    const before = { role: u.role, isActive: u.isActive };
    const patch = (values: Partial<AdminUser>) => setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...values } : x)));
    optimistic<{ user: AdminUser }>({
      apply: () => patch(changes),
      rollback: () => patch(before),
      request: () =>
        fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: u.name, email: u.email, role: u.role, isActive: u.isActive, ...changes }),
        }),
      failMessage: `Couldn’t update ${u.name}.`,
      onSuccess: (data) => data.user && setUsers((prev) => prev.map((x) => (x.id === data.user.id ? data.user : x))),
    });
  };

  // Passwords are NOT optimistic: you need to know the new one really works before telling anyone
  const update = async (u: AdminUser, changes: Partial<AdminUser> & { password?: string }) => {
    setMessage(null);
    try {
      const saved = await saveUser({ name: u.name, email: u.email, role: u.role, isActive: u.isActive, ...changes });
      setUsers((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
      setMessage({ tone: 'ok', text: changes.password ? `New password set for ${u.name}.` : `Updated ${u.name}.` });
      return true;
    } catch (e: any) {
      setMessage({ tone: 'error', text: e.message });
      return false;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs">
      <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-serif text-2xl text-ink">Staff accounts</h3>
          <p className="text-sm text-slate-500 mt-0.5">Who can sign in to this portal, and what they can do.</p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="h-10 px-4 rounded-xl bg-accent hover:bg-accent-dark text-white text-sm font-semibold flex items-center gap-1.5 self-start"
          >
            <Plus className="w-4 h-4" /> Add staff member
          </button>
        )}
      </div>

      {message && (
        <div
          className={`mx-5 sm:mx-6 mt-4 px-4 py-2.5 rounded-xl text-sm border ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {adding && (
        <AddStaffForm
          onCancel={() => setAdding(false)}
          onAdded={(u) => {
            setUsers((prev) => [...prev.filter((x) => x.id !== u.id), u]);
            setAdding(false);
            setMessage({ tone: 'ok', text: `${u.name} can now sign in with ${u.email}.` });
          }}
        />
      )}

      {loading ? (
        <div className="p-12 flex justify-center">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {users.map((u) => {
            const isMe = u.id === currentUserId;
            return (
              <li key={u.id} className="px-5 sm:px-6 py-4">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink">
                      {u.name} {isMe && <span className="text-xs font-normal text-slate-400">(you)</span>}
                    </div>
                    <div className="text-sm text-slate-500 truncate">
                      {u.email} · last sign-in {u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'never'}
                    </div>
                  </div>

                  <select
                    value={u.role}
                    disabled={isMe}
                    onChange={(e) => updateNow(u, { role: e.target.value as AdminRole })}
                    className={`${field} w-40`}
                    title={ROLES.find((r) => r.value === u.role)?.hint}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>

                  <label className={`flex items-center gap-2 text-sm w-28 ${isMe ? 'opacity-50' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-accent"
                      checked={u.isActive}
                      disabled={isMe}
                      onChange={(e) => updateNow(u, { isActive: e.target.checked })}
                    />
                    {u.isActive ? 'Can sign in' : 'Disabled'}
                  </label>

                  <button
                    onClick={() => setResetFor(resetFor === u.id ? null : u.id)}
                    className="h-10 px-3 rounded-xl text-sm text-slate-600 hover:bg-slate-100 flex items-center gap-1.5"
                  >
                    <KeyRound className="w-4 h-4" /> Set password
                  </button>
                </div>

                {resetFor === u.id && (
                  <SetPasswordRow
                    onCancel={() => setResetFor(null)}
                    onSave={async (password) => {
                      if (await update(u, { password })) setResetFor(null);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="px-5 sm:px-6 py-4 border-t border-slate-100 grid sm:grid-cols-3 gap-3 text-xs text-slate-500">
        {ROLES.map((r) => (
          <div key={r.value}>
            <span className="font-semibold text-slate-700">{r.label}:</span> {r.hint}
          </div>
        ))}
      </div>
    </div>
  );
};

const SetPasswordRow: React.FC<{ onCancel: () => void; onSave: (password: string) => void }> = ({ onCancel, onSave }) => {
  const [password, setPassword] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(password);
      }}
      className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-center"
    >
      <input
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        placeholder="New password (10+ characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={`${field} sm:w-72`}
      />
      <button type="submit" className="h-10 px-4 rounded-xl bg-ink text-white text-sm font-medium">
        Save password
      </button>
      <button type="button" onClick={onCancel} className="h-10 px-3 text-sm text-slate-500">
        Cancel
      </button>
      <span className="text-xs text-slate-400">Signs them out everywhere. Share it with them in person.</span>
    </form>
  );
};

const AddStaffForm: React.FC<{ onCancel: () => void; onAdded: (u: AdminUser) => void }> = ({ onCancel, onAdded }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('restaurant_admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onAdded(await saveUser({ name, email, role, password, isActive: true }));
        } catch (err: any) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}
      className="mx-5 sm:mx-6 mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input required placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
        <input required type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} className={field}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <input
          required
          type="password"
          autoComplete="new-password"
          minLength={10}
          placeholder="Starting password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <button disabled={busy} className="h-10 px-4 rounded-xl bg-accent hover:bg-accent-dark disabled:opacity-60 text-white text-sm font-semibold">
          Create account
        </button>
        <button type="button" onClick={onCancel} className="h-10 px-3 text-sm text-slate-500">
          Cancel
        </button>
        <span className="text-xs text-slate-400 hidden sm:inline">
          {ROLES.find((r) => r.value === role)?.hint}
        </span>
      </div>
    </form>
  );
};
