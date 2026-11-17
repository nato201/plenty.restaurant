/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { AdminPortal } from '../components/AdminPortal.tsx';
import { PlentyLogo } from '../components/Header.tsx';
import { StaffUser } from './types.ts';
import { Toaster } from './Toaster.tsx';

type SessionState = { status: 'loading' } | { status: 'signedOut'; notice?: string } | { status: 'signedIn'; user: StaffUser };

export default function StaffApp() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  useEffect(() => {
    document.title = 'Plenty · Staff';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);

    fetch('/api/staff/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSession(data?.user ? { status: 'signedIn', user: data.user } : { status: 'signedOut' }))
      .catch(() => setSession({ status: 'signedOut' }));

    // If any staff API call comes back 401 (session expired or password changed elsewhere),
    // drop back to the sign-in screen instead of leaving a half-broken portal on screen.
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (res.status === 401 && url.includes('/api/') && !url.includes('/api/staff/login')) {
        setSession((s) =>
          s.status === 'signedIn' ? { status: 'signedOut', notice: 'Your session ended. Please sign in again.' } : s
        );
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const signOut = async () => {
    await fetch('/api/staff/logout', { method: 'POST' }).catch(() => {});
    setSession({ status: 'signedOut', notice: 'You’ve been signed out.' });
  };

  if (session.status === 'loading') {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-white/50 animate-spin" />
      </div>
    );
  }

  if (session.status === 'signedOut') {
    return <SignIn notice={session.notice} onSignedIn={(user) => setSession({ status: 'signedIn', user })} />;
  }

  return (
    <>
      <AdminPortal
        currentUser={session.user}
        onSignOut={signOut}
        onChangePassword={() => setShowPasswordDialog(true)}
      />
      {showPasswordDialog && <ChangePasswordDialog onClose={() => setShowPasswordDialog(false)} />}
      <Toaster />
    </>
  );
}

const inputClass =
  'w-full h-12 px-4 rounded-xl bg-white border border-line text-ink text-[15px] outline-none focus:border-ink focus:ring-2 focus:ring-accent/30 transition';

const SignIn: React.FC<{ notice?: string; onSignedIn: (user: StaffUser) => void }> = ({ notice, onSignedIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        onSignedIn(data.user);
      } else {
        setError(data.error || 'Sign-in failed. Please try again.');
        setPassword('');
      }
    } catch {
      setError('Can’t reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink text-white flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center mb-10">
            <PlentyLogo className="h-28" />
            <p className="text-sm text-white/50 mt-3">Staff portal</p>
          </div>

          <form onSubmit={submit} className="bg-card text-ink rounded-3xl p-7 shadow-2xl space-y-4">
            <h1 className="font-display text-2xl">Sign in</h1>
            {notice && !error && <p className="text-sm text-muted">{notice}</p>}

            <div>
              <label htmlFor="staff-email" className="block text-sm text-ink/70 mb-1.5">
                Work email
              </label>
              <input
                id="staff-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="staff-password" className="block text-sm text-ink/70 mb-1.5">
                Password
              </label>
              <input
                id="staff-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-accent-dark bg-accent/10 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full h-12 rounded-full bg-accent hover:bg-accent-dark disabled:opacity-60 text-white font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Sign in
            </button>
          </form>

          <p className="text-sm text-white/40 mt-6">
            Forgot your password? Ask the restaurant owner to reset it.
          </p>
        </div>
      </div>
    </div>
  );
};

const ChangePasswordDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 10) return setError('Use at least 10 characters.');
    if (newPassword !== confirm) return setError('The new passwords don’t match.');
    setBusy(true);
    try {
      const res = await fetch('/api/staff/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDone(true);
      else setError(data.error || 'Couldn’t change your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-sm bg-card text-ink rounded-3xl p-7 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="font-display text-2xl">Change password</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <>
            <p className="text-ink/70">Your password is updated. Other devices signed in as you have been signed out.</p>
            <button type="button" onClick={onClose} className="w-full h-11 rounded-full bg-ink text-white">
              Done
            </button>
          </>
        ) : (
          <>
            <input type="password" autoComplete="current-password" placeholder="Current password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputClass} />
            <input type="password" autoComplete="new-password" placeholder="New password (10+ characters)" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} />
            <input type="password" autoComplete="new-password" placeholder="Repeat new password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
            {error && <p className="text-sm text-accent-dark">{error}</p>}
            <button type="submit" disabled={busy} className="w-full h-11 rounded-full bg-accent hover:bg-accent-dark disabled:opacity-60 text-white font-medium">
              Update password
            </button>
          </>
        )}
      </form>
    </div>
  );
};
