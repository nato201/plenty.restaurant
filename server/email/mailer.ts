/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import nodemailer, { Transporter } from 'nodemailer';

/**
 * SMTP settings come from .env (see .env.example). With Microsoft 365 and a shared mailbox:
 * SMTP_USER/SMTP_PASSWORD are a licensed account with "Send As" on the shared mailbox, and
 * EMAIL_FROM_ADDRESS is the shared address (e.g. orders@plenty.restaurant).
 */
interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
  replyTo?: string;
}

function readConfig(): EmailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const fromAddress = (process.env.EMAIL_FROM_ADDRESS || user || '').trim();
  if (!host || !user || !password || !fromAddress) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    user,
    password,
    fromAddress,
    fromName: process.env.EMAIL_FROM_NAME?.trim() || 'Plenty',
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
  };
}

let transporter: Transporter | null = null;
let transporterKey = '';

function getTransporter(cfg: EmailConfig): Transporter {
  const key = `${cfg.host}:${cfg.port}:${cfg.secure}:${cfg.user}`;
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure, // true = TLS from the start (465); false = upgrade with STARTTLS (587)
      // Never send the password over an unencrypted connection. SMTP_REQUIRE_TLS=false exists
      // only for a local test mail server; don't use it with a real one.
      requireTLS: !cfg.secure && process.env.SMTP_REQUIRE_TLS !== 'false',
      auth: { user: cfg.user, pass: cfg.password },
      pool: true,
      maxConnections: 2,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    transporterKey = key;
  }
  return transporter;
}

export function isEmailConfigured(): boolean {
  return readConfig() !== null;
}

/** Safe to show in the staff portal: no password. */
export function emailStatus() {
  const cfg = readConfig();
  return cfg
    ? { configured: true, host: cfg.host, port: cfg.port, user: cfg.user, from: `${cfg.fromName} <${cfg.fromAddress}>`, replyTo: cfg.replyTo }
    : { configured: false };
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendResult = { ok: true; messageId?: string } | { ok: false; skipped?: boolean; error: string };

/** Turn SMTP errors into something a restaurant manager can act on. */
function explain(err: any): string {
  const msg = String(err?.response || err?.message || err);
  if (/5\.7\.139|SmtpClientAuthentication is disabled/i.test(msg)) {
    return 'Microsoft 365 refused the sign-in: SMTP AUTH is turned off for this mailbox. Ask IT to enable "Authenticated SMTP".';
  }
  if (/5\.7\.3|535|Authentication unsuccessful|Invalid login/i.test(msg)) {
    return 'The mail server rejected the username or password. If the account uses multi-factor sign-in, use an app password.';
  }
  if (/5\.7\.60|SendAsDenied|not allowed to send as/i.test(msg)) {
    return 'This account isn’t allowed to send as the From address. Ask IT to grant "Send As" on the shared mailbox.';
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNECTION|timeout/i.test(msg)) {
    return `Couldn’t reach the mail server (${msg.split('\n')[0]}). Check SMTP_HOST and SMTP_PORT.`;
  }
  return msg.split('\n')[0].slice(0, 300);
}

export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, skipped: true, error: 'Email isn’t set up yet (SMTP settings missing in .env).' };
  try {
    const info = await getTransporter(cfg).sendMail({
      from: { name: cfg.fromName, address: cfg.fromAddress },
      to: email.to,
      replyTo: cfg.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err: any) {
    return { ok: false, error: explain(err) };
  }
}

/** Sign in to the mail server without sending anything; used by the portal's test. */
export async function verifyEmailConnection(): Promise<SendResult> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, skipped: true, error: 'Email isn’t set up yet (SMTP settings missing in .env).' };
  try {
    await getTransporter(cfg).verify();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: explain(err) };
  }
}
