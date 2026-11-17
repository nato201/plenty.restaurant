/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Mail, Send } from 'lucide-react';

type EmailStatus =
  | { configured: false }
  | { configured: true; host: string; port: number; user: string; from: string; replyTo?: string };

/** Shows whether customer email is connected, and sends a test. Owner only. */
export const EmailSettingsCard: React.FC<{ defaultTo: string }> = ({ defaultTo }) => {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [to, setTo] = useState(defaultTo);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin/email/status')
      .then((r) => r.json())
      .then((d) => d.success && setStatus(d.email))
      .catch(() => {});
  }, []);

  const sendTest = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      });
      const data = await res.json().catch(() => ({}));
      setResult(
        res.ok
          ? { tone: 'ok', text: `Test email sent to ${data.to}. Check the inbox (and the junk folder).` }
          : { tone: 'error', text: data.error || 'The test email couldn’t be sent.' }
      );
    } catch {
      setResult({ tone: 'error', text: 'Couldn’t reach the server.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 max-w-2xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl text-ink flex items-center gap-2">
            <Mail className="w-5 h-5 text-accent" /> Customer email
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Order confirmations, “confirmed”, “ready for pickup”, and declined or cancelled notices.
          </p>
        </div>
        {status && (
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${
              status.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {status.configured ? 'Connected' : 'Not set up'}
          </span>
        )}
      </div>

      {!status ? (
        <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
      ) : status.configured ? (
        <dl className="text-sm divide-y divide-slate-100 border-y border-slate-100">
          {[
            ['Sends as', status.from],
            ['Signs in as', status.user],
            ['Mail server', `${status.host}:${status.port}`],
            ...(status.replyTo ? [['Replies go to', status.replyTo]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-ink text-right break-all">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-slate-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          No emails are being sent yet. Add the SMTP settings to the server’s <code className="font-mono">.env</code> file and
          restart it. Until then, customer emails appear in Audit Logs as “skipped”.
        </p>
      )}

      {status?.configured && (
        <div className="space-y-2">
          <label htmlFor="test-email-to" className="block text-sm font-medium text-ink">
            Send a test email to
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="test-email-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="flex-1 h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-ink"
            />
            <button
              onClick={sendTest}
              disabled={sending || !to.includes('@')}
              className="h-10 px-4 rounded-xl bg-accent hover:bg-accent-dark disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send test email
            </button>
          </div>
        </div>
      )}

      {result && (
        <p
          role={result.tone === 'error' ? 'alert' : undefined}
          className={`text-sm rounded-xl px-4 py-2.5 border ${
            result.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
          }`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
};
