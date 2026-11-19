/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Load .env before anything reads process.env (the database pool does so on import).
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  MenuItem,
  RestaurantSettings,
  Order,
  Payment,
  PickupSlot,
  OrderStatus,
  FloorNumber,
  OrderItem,
  AdminRole,
  Topping,
  ServiceType,
} from './src/types.ts';
import { FLOORS, isServiceType, serviceLong } from './src/utils/service.ts';
import { isApprovedCompanyEmail, APPROVED_EMAIL_HINT } from './src/utils/companyEmail.ts';
import { normalizeEthiopianMobile, PHONE_HINT } from './src/utils/phone.ts';
import { ORDER_LIMITS, isWholeNumberInRange } from './src/utils/orderLimits.ts';
import {
  DAY_NAMES,
  dayOfWeek,
  formatTime12,
  getWeeklySchedule,
  restaurantNow,
  summarizeWeek,
  toMinutes,
  validateWeeklySchedule,
} from './src/utils/schedule.ts';
import { pool, transaction, query } from './server/db/pool.ts';
import { runMigrations } from './server/db/migrate.ts';
import { seedIfEmpty } from './server/db/seed.ts';
import * as menuRepo from './server/repos/menu.ts';
import * as settingsRepo from './server/repos/settings.ts';
import * as staffRepo from './server/repos/staff.ts';
import * as ordersRepo from './server/repos/orders.ts';
import { addAudit, auditForOrder, listAudit, addNotification, setNotificationStatus, listNotifications } from './server/repos/logs.ts';
import { newId } from './server/repos/util.ts';
import { clearCache } from './server/cache.ts';
import { sendEmail, verifyEmailConnection, emailStatus, isEmailConfigured } from './server/email/mailer.ts';
import { orderEmail, testEmail, OrderEmailType } from './server/email/templates.ts';
import { orderTeamsCard, sendTeamsDirect, teamsDirectStatus, testTeamsCard } from './server/teams/directMessage.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/** Wrap an async route so a thrown error becomes a 500 response instead of a hung request. */
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const route =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };

// Express configuration
// Behind a reverse proxy / load balancer (Cloud Run, Nginx, Cloudflare…) set TRUST_PROXY
// so req.hostname and req.secure reflect the public request.
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp === 'true' ? true : /^\d+$/.test(tp) ? Number(tp) : tp);
}
app.disable('x-powered-by');
// Keep the exact bytes of each JSON body: Chapa signs the raw payload of its webhooks.
app.use(
  express.json({
    limit: '200kb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// ==========================================
// STAFF ACCESS
// The staff portal lives only on the staff subdomain (default "admin.", e.g.
// admin.plenty.restaurant or admin.localhost:3000). Every staff API:
//   1. returns 404 on any other host, so the public site doesn't reveal it exists;
//   2. needs a signed, HTTP-only session cookie from /api/staff/login;
//   3. checks the signed-in user's role on the server.
// ==========================================
const STAFF_SUBDOMAIN = (process.env.STAFF_SUBDOMAIN || 'admin').toLowerCase();
const SESSION_COOKIE = 'plenty_staff';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one shift
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (() => {
    console.warn(
      '[staff] SESSION_SECRET is not set. Using a random one, so staff will be signed out whenever the server restarts.'
    );
    return crypto.randomBytes(32).toString('hex');
  })();

const MANAGERS: AdminRole[] = ['super_admin', 'restaurant_admin'];

interface StaffSession {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: StaffSession;
    }
  }
}

function isStaffHost(req: Request): boolean {
  const host = (req.hostname || '').toLowerCase();
  return host === STAFF_SUBDOMAIN || host.startsWith(`${STAFF_SUBDOMAIN}.`);
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function verifyPassword(password: string, stored: string | undefined | null): boolean {
  // Always do the scrypt work so response time doesn't reveal whether an account exists.
  const [algo, salt, hash] = (stored || DUMMY_HASH).split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected) && !!stored;
}

/** Short fingerprint of the stored hash: changing a password signs out that user's old sessions. */
function credentialVersion(passwordHash: string | undefined | null): string {
  return crypto.createHash('sha256').update(passwordHash || '').digest('base64url').slice(0, 12);
}

function sign(value: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function createSessionToken(userId: string, passwordHash: string | undefined | null): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, ver: credentialVersion(passwordHash), exp: Date.now() + SESSION_TTL_MS })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readSession(req: Request): Promise<StaffSession | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let parsed: { uid?: string; ver?: string; exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (typeof parsed.exp !== 'number' || parsed.exp < Date.now() || typeof parsed.uid !== 'string') return null;
  const user = await staffRepo.findStaffById(parsed.uid);
  if (!user || !user.isActive || parsed.ver !== credentialVersion(user.passwordHash)) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function sessionCookie(req: Request, value: string, maxAgeMs: number): string {
  // No Domain attribute: the cookie stays on the staff subdomain and is never sent to the public site.
  const secure = req.secure || process.env.NODE_ENV === 'production';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
    maxAgeMs / 1000
  )}${secure ? '; Secure' : ''}`;
}

function notFound(res: Response) {
  return res.status(404).json({ success: false, error: 'Not found' });
}

function staffHostOnly(req: Request, res: Response, next: NextFunction) {
  if (!isStaffHost(req)) return notFound(res);
  next();
}

/** Gate a route to signed-in staff on the staff subdomain, optionally limited to some roles. */
function requireStaff(...roles: AdminRole[]) {
  return route(async (req, res, next) => {
    if (!isStaffHost(req)) return notFound(res);

    // Reject cross-origin writes (CSRF), including from the public site's own origin.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      let originHost = '';
      try {
        originHost = new URL(req.headers.origin).host;
      } catch {}
      if (originHost !== req.headers.host) {
        return res.status(403).json({ success: false, error: 'Cross-origin request blocked.' });
      }
    }

    const staff = await readSession(req);
    if (!staff) return res.status(401).json({ success: false, error: 'Please sign in.' });
    if (roles.length && !roles.includes(staff.role)) {
      return res.status(403).json({ success: false, error: 'Your role does not allow this action.' });
    }
    req.staff = staff;
    next();
  });
}

/** Who to record in the audit log for this request. */
function actor(req: Request): { id: string; name: string } {
  return req.staff ? { id: req.staff.id, name: req.staff.name } : { id: 'system', name: 'Plenty System' };
}

// Simple in-memory limiter for login and public order lookups.
const attemptLog = new Map<string, { count: number; since: number }>();
function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = attemptLog.get(key);
  if (!entry || now - entry.since > windowMs) {
    attemptLog.set(key, { count: 1, since: now });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

/**
 * Make sure someone can sign in. ADMIN_EMAIL + ADMIN_PASSWORD in the environment always
 * define an active super admin. Without them, if no super admin has a password yet, a
 * one-time password is generated for the first super admin and printed to the console.
 */
async function bootstrapStaffCredentials() {
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD;

  if (envEmail && envPassword) {
    if (envPassword.length < 10) {
      console.warn('[staff] ADMIN_PASSWORD is shorter than 10 characters. Please use a longer one.');
    }
    let user = await staffRepo.findStaffByEmail(envEmail);
    if (!user) {
      user = await staffRepo.insertStaff({
        id: newId('usr'),
        name: process.env.ADMIN_NAME || 'Owner',
        email: envEmail,
        role: 'super_admin',
        isActive: true,
        passwordHash: hashPassword(envPassword),
      });
    } else {
      await staffRepo.updateStaff(user.id, { role: 'super_admin', isActive: true });
      if (!verifyPassword(envPassword, user.passwordHash)) {
        await staffRepo.setStaffPassword(user.id, hashPassword(envPassword));
      }
    }
    return;
  }

  if (await staffRepo.anySuperAdminCanSignIn()) return;

  const owner = await staffRepo.firstActiveSuperAdmin();
  if (!owner) return;
  const oneTimePassword = crypto.randomBytes(12).toString('base64url');
  await staffRepo.setStaffPassword(owner.id, hashPassword(oneTimePassword));
  console.log(
    [
      '',
      '================ STAFF PORTAL FIRST SIGN-IN ================',
      `  Email:    ${owner.email}`,
      `  Password: ${oneTimePassword}`,
      '  Sign in on the staff subdomain and change this password,',
      '  or set ADMIN_EMAIL and ADMIN_PASSWORD in .env.',
      '=============================================================',
      '',
    ].join('\n')
  );
}

// --- Staff session routes ---
app.post(
  '/api/staff/login',
  staffHostOnly,
  route(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (isRateLimited(`login:${req.ip}`, 10, 15 * 60 * 1000)) {
      return res.status(429).json({ success: false, error: 'Too many attempts. Try again in 15 minutes.' });
    }

    const user = email ? await staffRepo.findStaffByEmail(email) : null;
    const ok = verifyPassword(password, user?.isActive ? user.passwordHash : undefined);
    if (!user || !user.isActive || !ok) {
      return res.status(401).json({ success: false, error: 'That email and password don’t match.' });
    }

    await staffRepo.recordStaffLogin(user.id);
    await addAudit({ adminId: user.id, adminName: user.name, action: 'STAFF_SIGNED_IN', newValue: `IP ${req.ip}` });

    res.setHeader('Set-Cookie', sessionCookie(req, createSessionToken(user.id, user.passwordHash), SESSION_TTL_MS));
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  })
);

app.post('/api/staff/logout', staffHostOnly, (req: Request, res: Response) => {
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.json({ success: true });
});

app.get('/api/staff/me', requireStaff(), (req: Request, res: Response) => {
  res.json({ success: true, user: req.staff });
});

app.post(
  '/api/staff/password',
  requireStaff(),
  route(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const user = await staffRepo.findStaffById(req.staff!.id);
    if (!user || !verifyPassword(String(currentPassword || ''), user.passwordHash)) {
      return res.status(400).json({ success: false, error: 'Your current password is incorrect.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 10) {
      return res.status(400).json({ success: false, error: 'Use at least 10 characters for the new password.' });
    }
    const newHash = hashPassword(newPassword);
    await staffRepo.setStaffPassword(user.id, newHash);
    await addAudit({ adminId: user.id, adminName: user.name, action: 'STAFF_PASSWORD_CHANGED' });
    // Old sessions are now invalid; issue a fresh one for this browser.
    res.setHeader('Set-Cookie', sessionCookie(req, createSessionToken(user.id, newHash), SESSION_TTL_MS));
    res.json({ success: true });
  })
);

// --- Dish photo uploads (staff only), served publicly from /uploads ---
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '30d',
    immutable: true,
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

function detectImageExt(buf: Buffer): '.jpg' | '.png' | '.webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

app.post(
  '/api/admin/uploads',
  requireStaff(...MANAGERS),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
  (req: Request, res: Response) => {
    const buf = req.body;
    const ext = Buffer.isBuffer(buf) ? detectImageExt(buf) : null;
    if (!ext) {
      return res.status(400).json({ success: false, error: 'Upload a JPG, PNG or WebP image under 5 MB.' });
    }
    const name = `${crypto.randomBytes(12).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    res.json({ success: true, url: `/uploads/${name}` });
  }
);

// ==========================================
// NOTIFICATIONS
// ==========================================
async function dispatchTeamsNotification(order: Order, type: 'NEW_ORDER' | 'ORDER_ACCEPTED' | 'ORDER_DECLINED') {
  try {
    const settings = await settingsRepo.getSettings();
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL || settings.teamsWebhookUrl;

    let title = '';
    let color = '0076D7';
    let message = '';
    if (type === 'NEW_ORDER') {
      title = `🛎️ NEW PAID ORDER: ${order.orderNumber}`;
      color = 'E8663F'; // Plenty Orange
      message = `New paid order of ${order.totalAmount} ETB received (${serviceLong(order.pickup)}) at ${order.pickup.pickupTime}. Needs admin review.`;
    } else if (type === 'ORDER_ACCEPTED') {
      title = `✅ Order Accepted: ${order.orderNumber}`;
      color = '2F9E5A';
      message = `Order accepted. Est prep time: ${order.estimatedPrepMinutes} mins. Ready by ~${order.estimatedReadyTime}.`;
    } else {
      title = `❌ Order Declined: ${order.orderNumber}`;
      color = 'D1552F';
      message = `Order declined: ${order.declinedReason}. Automatic refund initiated.`;
    }

    const hasWebhook = !!webhookUrl && webhookUrl.startsWith('http');
    const logId = await addNotification({
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: 'teams',
      title: `Teams Alert: ${type} ${order.orderNumber}`,
      message,
      status: hasWebhook ? 'pending' : 'sent', // without a webhook it's only recorded for the portal
    });

    if (!hasWebhook) return;
    try {
      await fetch(webhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: color,
          summary: title,
          sections: [
            {
              activityTitle: title,
              activitySubtitle: `Plenty Restaurant — Pre-Order System`,
              facts: [
                { name: 'Customer', value: `${order.customer.firstName} ${order.customer.lastName}` },
                { name: 'Service', value: serviceLong(order.pickup) },
                { name: 'Pickup Slot', value: `${order.pickup.pickupDate} at ${order.pickup.pickupTime}` },
                { name: 'Total Amount', value: `${order.totalAmount.toLocaleString()} ETB` },
                { name: 'Payment Status', value: `${order.paymentStatus.toUpperCase()} (Chapa)` },
              ],
              markdown: true,
            },
          ],
        }),
      });
      await setNotificationStatus(logId, 'sent');
    } catch (err: any) {
      console.error('Teams webhook error:', err?.message);
      await setNotificationStatus(logId, 'failed');
    }
  } catch (err: any) {
    console.error('Teams notification error:', err?.message);
  }
}

/**
 * Email the customer about their order. Runs in the background: a slow or failing mail server
 * never delays or blocks the order. Every attempt is logged with its real outcome
 * (sent / failed with the reason / skipped because email isn't set up).
 */
function notifyCustomer(order: Order, type: OrderEmailType): void {
  (async () => {
    const email = orderEmail(type, order);
    const logId = await addNotification({
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: 'email',
      title: email.subject,
      message: email.text,
      status: 'pending',
      recipient: email.to,
    });
    const result = await sendEmail(email);
    if (result.ok) {
      await setNotificationStatus(logId, 'sent');
    } else {
      if (!result.skipped) console.warn(`[email] ${type} email for ${order.orderNumber} failed: ${result.error}`);
      await setNotificationStatus(logId, result.skipped ? 'skipped' : 'failed', result.error);
    }
  })().catch((err) => console.error('[email] notification error:', err?.message || err));

  // The same update as a Teams card, sent to the employee directly
  (async () => {
    const message = orderTeamsCard(type, order);
    const logId = await addNotification({
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: 'teams',
      title: `Teams message to customer: ${message.summary}`,
      message: message.summary,
      status: 'pending',
      recipient: order.customer.email,
    });
    const result = await sendTeamsDirect(order.customer.email, message);
    if (result.ok) {
      await setNotificationStatus(logId, 'sent');
    } else {
      if (!result.skipped) console.warn(`[teams] ${type} message for ${order.orderNumber} failed: ${result.error}`);
      await setNotificationStatus(logId, result.skipped ? 'skipped' : 'failed', result.error);
    }
  })().catch((err) => console.error('[teams] customer message error:', err?.message || err));
}

// ==========================================
// REST API ROUTES
// ==========================================

// 1. Menu Items
app.get(
  '/api/menu',
  route(async (_req, res) => {
    res.json({ success: true, items: await menuRepo.listMenu() });
  })
);

const MENU_LIMITS = { name: 80, category: 40, groupLabel: 40, description: 500, toppingName: 60, toppings: 30 };

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function cleanPrice(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100000) return null;
  return Math.round(n * 100) / 100;
}

/** Validate a dish coming from the staff portal. Returns the clean fields or an error message. */
function parseMenuInput(body: any): { data?: Omit<MenuItem, 'id'>; error?: string } {
  const name = cleanText(body?.name, MENU_LIMITS.name);
  const category = cleanText(body?.category, MENU_LIMITS.category);
  const description =
    typeof body?.description === 'string' ? body.description.trim().slice(0, MENU_LIMITS.description) : '';
  const price = cleanPrice(body?.price);

  if (!name) return { error: 'Give the dish a name.' };
  if (!category) return { error: 'Choose a category.' };
  if (!description) return { error: 'Add a short description.' };
  if (price === null || price <= 0) return { error: 'Enter a price above 0 birr.' };

  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const isUpload = /^\/uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(imageUrl);
  const isHttpsLink = /^https:\/\/[^\s"'<>]+$/.test(imageUrl);
  if (imageUrl && !isUpload && !isHttpsLink) {
    return { error: 'Upload a photo, or use an image link that starts with https://' };
  }

  const rawToppings = Array.isArray(body?.availableToppings) ? body.availableToppings : [];
  if (rawToppings.length > MENU_LIMITS.toppings) {
    return { error: `Keep extras to ${MENU_LIMITS.toppings} or fewer.` };
  }
  const availableToppings: Topping[] = [];
  for (const t of rawToppings) {
    const tName = cleanText(t?.name, MENU_LIMITS.toppingName);
    const tPrice = cleanPrice(t?.price);
    if (!tName) continue;
    if (tPrice === null) return { error: `Check the price for "${tName}".` };
    const id =
      typeof t?.id === 'string' && /^[\w-]{1,40}$/.test(t.id) ? t.id : `top-${crypto.randomBytes(4).toString('hex')}`;
    availableToppings.push({ id, name: tName, price: tPrice });
  }

  const groupLabel = cleanText(body?.groupLabel, MENU_LIMITS.groupLabel);
  return {
    data: {
      name,
      category,
      ...(groupLabel ? { groupLabel } : {}),
      description,
      price,
      available: body?.available !== false,
      ...(imageUrl ? { imageUrl } : {}),
      isVegetarian: !!body?.isVegetarian,
      isFasting: !!body?.isFasting,
      isSpecial: !!body?.isSpecial,
      availableToppings,
    },
  };
}

const describeDish = (i: MenuItem) => `${i.name} · ${i.category} · ${i.price} ETB`;

app.post(
  '/api/menu',
  requireStaff(...MANAGERS),
  route(async (req, res) => {
    const { data, error } = parseMenuInput(req.body);
    if (!data) return res.status(400).json({ success: false, error });

    const item = await menuRepo.createMenuItem({ id: newId('item'), ...data });
    const who = actor(req);
    await addAudit({ adminId: who.id, adminName: who.name, action: 'MENU_ITEM_ADDED', previousValue: '', newValue: describeDish(item) });
    res.status(201).json({ success: true, item });
  })
);

app.put(
  '/api/menu/:id',
  requireStaff(...MANAGERS),
  route(async (req, res) => {
    const before = await menuRepo.getMenuItem(req.params.id);
    if (!before) return res.status(404).json({ success: false, error: 'Menu item not found' });

    const { data, error } = parseMenuInput(req.body);
    if (!data) return res.status(400).json({ success: false, error });

    const item = await menuRepo.replaceMenuItem({ id: before.id, ...data });
    if (!item) return res.status(404).json({ success: false, error: 'Menu item not found' });
    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: 'MENU_ITEM_UPDATED',
      previousValue: describeDish(before),
      newValue: describeDish(item),
    });
    res.json({ success: true, item });
  })
);

app.delete(
  '/api/menu/:id',
  requireStaff(...MANAGERS),
  route(async (req, res) => {
    // Past orders keep their own copy of name and price, so removing a dish is safe.
    const item = await menuRepo.deleteMenuItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Menu item not found' });
    const who = actor(req);
    await addAudit({ adminId: who.id, adminName: who.name, action: 'MENU_ITEM_DELETED', previousValue: describeDish(item), newValue: '' });
    res.json({ success: true });
  })
);

app.post(
  '/api/menu/:id/toggle',
  requireStaff(...MANAGERS),
  route(async (req, res) => {
    const item = await menuRepo.toggleMenuItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Menu item not found' });
    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: item.available ? 'ITEM_RESTOCKED' : 'ITEM_86_UNAVAILABLE',
      previousValue: `${item.name} available: ${!item.available}`,
      newValue: `${item.name} available: ${item.available}`,
    });
    res.json({ success: true, item });
  })
);

// 2. Settings & Opening Hours
// Public visitors get only what the storefront and checkout need; webhook URLs,
// alert emails and payment mode stay on the staff side.
const PUBLIC_SETTING_KEYS: (keyof RestaurantSettings)[] = [
  'weeklySchedule',
  'pickupIntervalMinutes',
  'minPrepTimeMinutes',
  'maxAdvanceOrderingDays',
  'orderCutoffMinutesBeforeClose',
  'isOrderingEnabled',
  'pauseReason',
  'maxOrdersPerSlot',
  'maxDailyOrders',
  'holidays',
];
const SUPER_ADMIN_SETTING_KEYS: (keyof RestaurantSettings)[] = ['teamsWebhookUrl', 'adminNotificationEmail', 'chapaMode'];

/** Range checks for numeric settings, so a typo can't break checkout (e.g. a 0-minute interval). */
const NUMBER_RULES: Partial<Record<keyof RestaurantSettings, [number, number, string]>> = {
  pickupIntervalMinutes: [5, 120, 'Pickup interval'],
  minPrepTimeMinutes: [0, 240, 'Minimum prep time'],
  maxAdvanceOrderingDays: [0, 60, 'Days customers can order ahead'],
  orderCutoffMinutesBeforeClose: [0, 240, 'Last order before closing'],
  maxOrdersPerSlot: [1, 500, 'Orders per pickup slot'],
  maxDailyOrders: [1, 5000, 'Orders per day'],
};

function validateSettingsChanges(changes: Partial<RestaurantSettings>): string | null {
  if (changes.weeklySchedule !== undefined) {
    const err = validateWeeklySchedule(changes.weeklySchedule);
    if (err) return err;
    changes.weeklySchedule = changes.weeklySchedule.map((d) => ({
      isOpen: d.isOpen,
      openTime: d.openTime,
      closeTime: d.closeTime,
    }));
  }
  for (const [key, [min, max, label]] of Object.entries(NUMBER_RULES) as [keyof RestaurantSettings, [number, number, string]][]) {
    if (changes[key] === undefined) continue;
    const n = Number(changes[key]);
    if (!Number.isInteger(n) || n < min || n > max) return `${label} must be a whole number from ${min} to ${max}.`;
    (changes as any)[key] = n;
  }
  if (changes.holidays !== undefined) {
    if (!Array.isArray(changes.holidays) || !changes.holidays.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)))) {
      return 'Holidays must be dates like 2026-12-25.';
    }
  }
  if (changes.isOrderingEnabled !== undefined) changes.isOrderingEnabled = !!changes.isOrderingEnabled;
  if (changes.pauseReason !== undefined) changes.pauseReason = cleanText(changes.pauseReason, 200);
  return null;
}

app.get(
  '/api/settings',
  route(async (req, res) => {
    const settings = await settingsRepo.getSettings();
    settings.weeklySchedule = getWeeklySchedule(settings);
    if (isStaffHost(req) && (await readSession(req))) {
      return res.json({ success: true, settings });
    }
    const publicSettings: Partial<RestaurantSettings> = {};
    for (const key of PUBLIC_SETTING_KEYS) (publicSettings as any)[key] = settings[key];
    res.json({ success: true, settings: publicSettings });
  })
);

app.post(
  '/api/settings',
  requireStaff(...MANAGERS),
  route(async (req, res) => {
    const incoming = req.body || {};
    const allowed =
      req.staff!.role === 'super_admin' ? [...PUBLIC_SETTING_KEYS, ...SUPER_ADMIN_SETTING_KEYS] : PUBLIC_SETTING_KEYS;
    const changes: Partial<RestaurantSettings> = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) (changes as any)[key] = incoming[key];
    }
    const error = validateSettingsChanges(changes);
    if (error) return res.status(400).json({ success: false, error });

    const settings = await settingsRepo.updateSettings(changes);
    settings.weeklySchedule = getWeeklySchedule(settings);

    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: changes.weeklySchedule ? 'UPDATE_OPENING_HOURS' : 'UPDATE_SETTINGS',
      previousValue: 'Previous configuration',
      newValue: changes.weeklySchedule
        ? summarizeWeek(changes.weeklySchedule).map((g) => `${g.label}: ${g.hours ?? 'Closed'}`).join('; ')
        : JSON.stringify(changes),
    });
    res.json({ success: true, settings });
  })
);

// 3. Pickup Slots & Real-time Capacity
type SlotsResult =
  | { open: false; reason: string }
  | { open: true; slots: PickupSlot[]; totalBookings: number; maxDailyOrders: number };

/**
 * The pickup slots for a date, following that day's opening hours (Addis Ababa time).
 * Used both to show times at checkout and to check the time a customer submits.
 */
async function buildPickupSlots(date: string, settings: RestaurantSettings): Promise<SlotsResult> {
  const { pickupIntervalMinutes, maxOrdersPerSlot, maxDailyOrders, minPrepTimeMinutes } = settings;
  const now = restaurantNow();

  if (!settings.isOrderingEnabled) {
    return { open: false, reason: settings.pauseReason || 'Online ordering is temporarily paused by the kitchen.' };
  }
  if (date < now.date) return { open: false, reason: 'That date has already passed.' };
  const daysAhead = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${now.date}T00:00:00Z`)) / 86400000);
  if (daysAhead > settings.maxAdvanceOrderingDays) {
    return { open: false, reason: `You can order up to ${settings.maxAdvanceOrderingDays} days ahead.` };
  }
  if ((settings.holidays || []).includes(date)) return { open: false, reason: 'Plenty is closed for a holiday on this date.' };

  const day = getWeeklySchedule(settings)[dayOfWeek(date)];
  if (!day?.isOpen) return { open: false, reason: `Plenty is closed on ${DAY_NAMES[dayOfWeek(date)]}s.` };

  const bookings = await ordersRepo.slotBookings(date);
  if (bookings.total >= maxDailyOrders) return { open: false, reason: 'Daily kitchen capacity has been reached for this date.' };

  const openMinutes = toMinutes(day.openTime);
  const lastStart = toMinutes(day.closeTime) - (settings.orderCutoffMinutesBeforeClose ?? 30);
  const isToday = date === now.date;

  const slots: PickupSlot[] = [];
  for (let m = openMinutes; m <= lastStart; m += pickupIntervalMinutes) {
    const startTime = formatTime12(m);
    const bookedCount = bookings.bySlot.get(startTime) || 0;

    let available = true;
    let reason = '';
    // Enforce minimum preparation time (can't pick a slot in 10 minutes if prep takes 30)
    if (isToday && m < now.minutes + minPrepTimeMinutes) {
      available = false;
      reason = 'Past cutoff / insufficient prep time';
    } else if (bookedCount >= maxOrdersPerSlot) {
      available = false;
      reason = 'Slot capacity reached';
    }

    slots.push({
      slotId: `slot-${date}-${m}`,
      pickupDate: date,
      startTime,
      endTime: formatTime12(m + pickupIntervalMinutes),
      maxCapacity: maxOrdersPerSlot,
      currentCapacity: bookedCount,
      isAvailable: available,
      reason,
    });
  }

  return { open: true, slots, totalBookings: bookings.total, maxDailyOrders };
}

app.get(
  '/api/pickup-slots',
  route(async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : restaurantNow().date;
    const result = await buildPickupSlots(date, await settingsRepo.getSettings());
    if (!result.open) {
      return res.json({ success: true, date, orderingDisabled: true, reason: result.reason, slots: [] });
    }
    res.json({
      success: true,
      date,
      orderingDisabled: false,
      slots: result.slots,
      totalBookingsToday: result.totalBookings,
      maxDailyOrders: result.maxDailyOrders,
    });
  })
);

// 4. Online Payment Initialization (Chapa - ETB)
/** The configured Chapa secret key, or '' when online payment isn't set up. There is no fake fallback. */
function getChapaKey(): string {
  const key = process.env.CHAPA_SECRET_KEY || '';
  return key.startsWith('CHASECK') && !key.includes('xxxxxxxx') ? key : '';
}

if (!getChapaKey()) {
  console.warn('[payments] CHAPA_SECRET_KEY is not set. Customers will not be able to pay or place orders.');
}

app.post(
  '/api/payment/initialize',
  route(async (req, res) => {
    const chapaKey = getChapaKey();
    if (!chapaKey) {
      return res.status(503).json({
        success: false,
        error: 'Online payment isn’t available right now, so we can’t take orders. Please try again later.',
      });
    }

    const { customer, pickup, items } = req.body || {};

    if (!customer?.firstName || !customer?.email || !customer?.phoneNumber) {
      return res.status(400).json({ success: false, error: 'Customer information is incomplete.' });
    }

    // Ordering is limited to approved company staff
    if (typeof customer.email !== 'string' || !isApprovedCompanyEmail(customer.email)) {
      return res.status(400).json({ success: false, error: APPROVED_EMAIL_HINT });
    }
    customer.email = customer.email.trim().toLowerCase();

    // Chapa only accepts the 10-digit local format (09xxxxxxxx / 07xxxxxxxx)
    const phone = normalizeEthiopianMobile(customer.phoneNumber);
    if (!phone) {
      return res.status(400).json({ success: false, error: PHONE_HINT });
    }
    customer.phoneNumber = phone;

    if (!pickup?.pickupDate || !pickup?.pickupTime || !/^\d{4}-\d{2}-\d{2}$/.test(pickup.pickupDate)) {
      return res.status(400).json({ success: false, error: 'Pickup scheduling details are incomplete.' });
    }

    // Delivery to a floor, or dine-in at the restaurant (no floor needed)
    if (!isServiceType(pickup.serviceType)) {
      return res.status(400).json({ success: false, error: 'Please choose delivery or dine-in.' });
    }
    const serviceType: ServiceType = pickup.serviceType;
    if (serviceType === 'delivery' && !FLOORS.includes(Number(pickup.floorNumber) as FloorNumber)) {
      return res.status(400).json({ success: false, error: 'Please choose your floor: 2, 8, 10, 11, 12 or 13.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Shopping cart is empty.' });
    }

    const settings = await settingsRepo.getSettings();
    if (!settings.isOrderingEnabled) {
      return res.status(400).json({
        success: false,
        error: settings.pauseReason || 'Plenty Restaurant is currently not accepting new orders.',
      });
    }

    // Rebuild the order from the database. The browser only tells us WHICH dishes and extras and
    // HOW MANY; every price comes from the menu, and every quantity must be a sensible whole number.
    // Anything else (a made-up extra, a negative price, 0.01 of a dish) is rejected.
    if (items.length > ORDER_LIMITS.maxLines) {
      return res.status(400).json({ success: false, error: `Orders can have up to ${ORDER_LIMITS.maxLines} items.` });
    }

    // Work in whole cents so totals never pick up floating-point rounding errors
    const cents = (birr: number) => Math.round(birr * 100);
    let subtotalCents = 0;
    const validatedOrderItems: OrderItem[] = [];

    // Load every dish in the bag at once (2 queries), not one lookup per line
    const dishes = await menuRepo.getMenuItems(items.map((it: any) => String(it?.menuItemId || '')));
    for (const item of items) {
      const menuItem = dishes.get(String(item?.menuItemId || ''));
      if (!menuItem) {
        return res.status(400).json({ success: false, error: 'Something in your bag is no longer on the menu. Please remove it and try again.' });
      }
      if (!menuItem.available) {
        return res.status(400).json({ success: false, error: `Sorry, "${menuItem.name}" is sold out right now.` });
      }
      if (!isWholeNumberInRange(item.quantity, 1, ORDER_LIMITS.maxItemQuantity)) {
        return res.status(400).json({
          success: false,
          error: `Choose between 1 and ${ORDER_LIMITS.maxItemQuantity} of "${menuItem.name}".`,
        });
      }

      // Each chosen extra must be one this dish actually offers; its price is the menu's price.
      const offered = new Map((menuItem.availableToppings || []).map((t) => [t.id, t]));
      const chosen = new Map<string, number>(); // extra id → quantity (duplicates are merged)
      for (const t of Array.isArray(item.selectedToppings) ? item.selectedToppings : []) {
        const id = String(t?.id || '');
        const extra = offered.get(id);
        if (!extra) {
          return res.status(400).json({
            success: false,
            error: `An extra on "${menuItem.name}" is no longer available. Please remove it and add the dish again.`,
          });
        }
        const qty = t?.quantity === undefined ? 1 : t.quantity;
        if (!isWholeNumberInRange(qty, 1, ORDER_LIMITS.maxExtraQuantity)) {
          return res.status(400).json({
            success: false,
            error: `Choose between 1 and ${ORDER_LIMITS.maxExtraQuantity} of "${extra.name}".`,
          });
        }
        chosen.set(id, (chosen.get(id) || 0) + qty);
      }

      let unitCents = cents(menuItem.price);
      const verifiedToppings: Topping[] = [];
      for (const [id, qty] of chosen) {
        const extra = offered.get(id)!;
        if (qty > ORDER_LIMITS.maxExtraQuantity) {
          return res.status(400).json({
            success: false,
            error: `Choose between 1 and ${ORDER_LIMITS.maxExtraQuantity} of "${extra.name}".`,
          });
        }
        unitCents += cents(extra.price) * qty;
        verifiedToppings.push({ id: extra.id, name: extra.name, price: extra.price, quantity: qty });
      }

      const lineCents = unitCents * item.quantity;
      subtotalCents += lineCents;

      validatedOrderItems.push({
        menuItemId: menuItem.id,
        name: menuItem.name,
        unitPrice: unitCents / 100,
        quantity: item.quantity,
        selectedToppings: verifiedToppings,
        specialNotes: typeof item.specialNotes === 'string' ? item.specialNotes.trim().slice(0, ORDER_LIMITS.maxNoteLength) : '',
        totalPrice: lineCents / 100,
      });
    }

    const calculatedSubtotal = subtotalCents / 100;
    const taxOrFees = 0; // ETB taxes included in menu prices
    const totalAmount = calculatedSubtotal + taxOrFees;
    if (!(totalAmount > 0)) {
      return res.status(400).json({ success: false, error: 'Your order total must be more than 0 birr.' });
    }
    if (typeof pickup.specialInstructions === 'string') {
      pickup.specialInstructions = pickup.specialInstructions.trim().slice(0, ORDER_LIMITS.maxNoteLength);
    }

    // The pickup time must be a real, open slot for that day: inside opening hours, not a
    // closed day or holiday, not in the past, and not full. (Capacity is checked again,
    // under a lock, when the payment completes.)
    const slotCheck = await buildPickupSlots(pickup.pickupDate, settings);
    if (!slotCheck.open) {
      return res.status(400).json({ success: false, error: slotCheck.reason });
    }
    const chosenSlot = slotCheck.slots.find((s) => s.startTime === pickup.pickupTime);
    if (!chosenSlot) {
      return res.status(400).json({ success: false, error: 'Please choose one of the available pickup times.' });
    }
    if (!chosenSlot.isAvailable) {
      return res.status(409).json({
        success: false,
        error:
          chosenSlot.reason === 'Slot capacity reached'
            ? `The ${pickup.pickupTime} pickup slot is full. Please choose another time.`
            : `It's too late to order for ${pickup.pickupTime}. Please choose a later time.`,
      });
    }

    const txRef = `PLT-TX-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const paymentRecord: Payment = {
      id: newId('pay'),
      provider: 'Chapa',
      txRef,
      amount: totalAmount,
      currency: 'ETB',
      paymentMethod: 'other', // set from Chapa's answer once the payment completes
      status: 'pending',
      customerEmail: customer.email,
      customerName: `${customer.firstName} ${customer.lastName || ''}`.trim(),
      customerPhone: customer.phoneNumber,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await transaction(async (client) => {
      await ordersRepo.insertPayment(paymentRecord, client);
      await ordersRepo.insertPendingCheckout(
        {
          txRef,
          customer: {
            firstName: String(customer.firstName),
            lastName: String(customer.lastName || ''),
            email: customer.email,
            phoneNumber: customer.phoneNumber,
          },
          // Only the known fields; anything else the browser sent is dropped
          pickup: {
            pickupDate: String(pickup.pickupDate),
            pickupTime: String(pickup.pickupTime),
            serviceType,
            ...(serviceType === 'delivery' ? { floorNumber: Number(pickup.floorNumber) as FloorNumber } : {}),
            ...(pickup.specialInstructions ? { specialInstructions: String(pickup.specialInstructions) } : {}),
          },
          items: validatedOrderItems,
          subtotal: calculatedSubtotal,
          taxOrFees,
          totalAmount,
        },
        client
      );
    });

    const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;

    // Real Chapa only. If Chapa won't start the payment, nothing is kept and the customer is told.
    const failInitialize = async (reason: string) => {
      console.warn('Chapa initialize failed:', reason);
      await transaction(async (client) => {
        await ordersRepo.deletePendingCheckout(txRef, client);
        await ordersRepo.updatePayment(paymentRecord.id, { status: 'failed' }, client);
      });
      return res.status(502).json({
        success: false,
        error: 'We couldn’t start the payment with Chapa. Please check your details and try again in a moment.',
      });
    };

    let chapaData: any;
    try {
      const chapaResponse = await fetch('https://api.chapa.co/v1/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chapaKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: totalAmount,
          currency: 'ETB',
          email: customer.email,
          first_name: customer.firstName,
          last_name: customer.lastName,
          phone_number: customer.phoneNumber,
          tx_ref: txRef,
          callback_url: `${appUrl}/api/payment/callback`,
          return_url: `${appUrl}/?view=order_confirm&tx_ref=${txRef}`,
          // Chapa limits: title max 16 chars; description only letters, numbers,
          // spaces, hyphens, underscores and dots.
          customization: {
            title: 'Plenty Pre-Order',
            description: (serviceType === 'dine_in'
              ? `Dine-in ${pickup.pickupDate}`
              : `Delivery to floor ${pickup.floorNumber} ${pickup.pickupDate}`
            ).replace(/[^\w\s.-]/g, ''),
          },
        }),
      });
      chapaData = await chapaResponse.json();
    } catch (err: any) {
      return failInitialize(err?.message || 'network error');
    }

    const checkoutUrl: string | undefined = chapaData?.data?.checkout_url;
    if (chapaData?.status !== 'success' || !checkoutUrl || !checkoutUrl.startsWith('https://checkout.chapa.co/')) {
      return failInitialize(JSON.stringify(chapaData?.message ?? chapaData));
    }

    await ordersRepo.updatePayment(paymentRecord.id, { checkoutUrl });
    res.json({ success: true, provider: 'Chapa', txRef, checkoutUrl, totalAmount, currency: 'ETB' });
  })
);

// 5. Payment confirmation & official order creation
// An order only exists once Chapa's own API says the payment succeeded for the right amount.
// The customer's return from Chapa and Chapa's webhook can arrive at the same moment (or on two
// servers): the payment row is locked while the order is created, so it's created exactly once.
type FinalizeResult =
  | { ok: true; order: Order; payment: Payment }
  | { ok: false; status: number; error: string; retryable?: boolean };

// Also de-duplicate concurrent calls within this process to avoid asking Chapa twice.
const finalizeInFlight = new Map<string, Promise<FinalizeResult>>();

function finalizePayment(txRef: string): Promise<FinalizeResult> {
  const running = finalizeInFlight.get(txRef);
  if (running) return running;
  const job = doFinalizePayment(txRef).finally(() => finalizeInFlight.delete(txRef));
  finalizeInFlight.set(txRef, job);
  return job;
}

const KNOWN_METHODS = ['telebirr', 'cbe_birr', 'card', 'chapa_wallet'];

async function doFinalizePayment(txRef: string): Promise<FinalizeResult> {
  const payment = await ordersRepo.getPaymentByTxRef(txRef);
  if (!payment) return { ok: false, status: 404, error: 'Payment transaction reference not found.' };

  // Already done: return the existing order
  if (payment.status === 'successful' && payment.orderId) {
    const existing = await ordersRepo.getOrder(payment.orderId);
    if (existing) return { ok: true, order: existing, payment };
  }

  const chapaKey = getChapaKey();
  if (!chapaKey) return { ok: false, status: 503, error: 'Online payment isn’t configured.', retryable: true };

  let verifyData: any;
  try {
    const verifyRes = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(txRef)}`, {
      headers: { Authorization: `Bearer ${chapaKey}` },
    });
    verifyData = await verifyRes.json();
  } catch (err: any) {
    console.error('Chapa verification call failed:', err?.message);
    return { ok: false, status: 502, error: 'Couldn’t reach Chapa to confirm the payment.', retryable: true };
  }

  const chapaStatus = String(verifyData?.data?.status || '').toLowerCase();
  if (verifyData?.status !== 'success' || chapaStatus !== 'success') {
    // Only a definite failure is recorded as failed; "pending" may still complete.
    if (['failed', 'cancelled', 'reversed'].includes(chapaStatus) && payment.status === 'pending') {
      await ordersRepo.updatePayment(payment.id, { status: 'failed' });
    }
    return {
      ok: false,
      status: 400,
      error: 'Payment verification failed. Payment was not completed or amount did not match.',
      retryable: chapaStatus === 'pending' || !chapaStatus,
    };
  }

  if (verifyData.data.currency !== 'ETB' || Math.abs(Number(verifyData.data.amount) - payment.amount) >= 1) {
    console.error(`Chapa amount mismatch for ${txRef}: expected ${payment.amount} ETB, got`, verifyData.data.amount, verifyData.data.currency);
    await ordersRepo.updatePayment(payment.id, { status: 'failed' });
    return { ok: false, status: 400, error: 'Payment amount did not match the order.' };
  }

  const method = String(verifyData.data.method || verifyData.data.payment_method || '').toLowerCase().replace(/\s+/g, '_');

  const result = await transaction<FinalizeResult | { capacityFull: true; order: null }>(async (client) => {
    // Lock this payment: a second confirmation for the same tx_ref waits here, then sees the order.
    const locked = await ordersRepo.getPaymentByTxRef(txRef, client, true);
    if (!locked) return { ok: false, status: 404, error: 'Payment transaction reference not found.' };
    if (locked.status === 'successful' && locked.orderId) {
      const existing = await ordersRepo.getOrder(locked.orderId, client);
      if (existing) return { ok: true, order: existing, payment: locked };
    }

    const pending = await ordersRepo.getPendingCheckout(txRef, client);
    if (!pending) return { ok: false, status: 400, error: 'Provisional order details expired or already processed.' };

    // Serialise bookings for this pickup slot so two payments can't both take the last place.
    await query('SELECT pg_advisory_xact_lock(hashtext($1))', [`slot:${pending.pickup.pickupDate}|${pending.pickup.pickupTime}`], client);
    const settings = await settingsRepo.getSettings(client);
    const inSlot = await ordersRepo.countActiveInSlot(pending.pickup.pickupDate, pending.pickup.pickupTime, client);
    if (inSlot >= settings.maxOrdersPerSlot) {
      await ordersRepo.updatePayment(
        locked.id,
        { status: 'refunded', refundReason: 'Slot reached capacity during payment execution' },
        client
      );
      return { capacityFull: true, order: null };
    }

    const now = new Date().toISOString();
    const order: Order = {
      id: newId('ord'),
      orderNumber: await ordersRepo.nextOrderNumber(client),
      customer: pending.customer,
      pickup: pending.pickup,
      items: pending.items,
      subtotal: pending.subtotal,
      taxOrFees: pending.taxOrFees,
      totalAmount: pending.totalAmount,
      status: 'pending',
      paymentId: locked.id,
      paymentStatus: 'successful',
      soundAlertDismissed: false, // Triggers the continuous sound alert in the kitchen
      createdAt: now,
      updatedAt: now,
    };
    await ordersRepo.insertOrder(order, client);

    const updatedPayment = await ordersRepo.updatePayment(
      locked.id,
      {
        status: 'successful',
        orderId: order.id,
        orderNumber: order.orderNumber,
        chapaReference: verifyData.data.reference || locked.chapaReference,
        paymentMethod: (KNOWN_METHODS.includes(method) ? method : 'other') as Payment['paymentMethod'],
        paidAt: now,
      },
      client
    );
    await ordersRepo.deletePendingCheckout(txRef, client);

    await addAudit(
      {
        adminId: 'system',
        adminName: 'Payment Gateway (Chapa)',
        action: 'PAYMENT_VERIFIED_ORDER_CREATED',
        relatedOrderId: order.id,
        previousValue: `Payment ${locked.id} status: pending`,
        newValue: `Order ${order.orderNumber} created, status: pending, amount: ${order.totalAmount} ETB`,
      },
      client
    );

    return { ok: true, order, payment: updatedPayment!, isNew: true } as FinalizeResult & { isNew: true };
  });

  if ('capacityFull' in result) {
    return {
      ok: false,
      status: 409,
      error: 'Slot reached capacity before payment was finalized. Your payment will be refunded.',
    };
  }

  if (result.ok && (result as any).isNew) {
    dispatchTeamsNotification(result.order, 'NEW_ORDER');
    notifyCustomer(result.order, 'confirmed');
  }
  return result;
}

// Called by the site when the customer comes back from Chapa's checkout page
app.get(
  '/api/payment/verify',
  route(async (req, res) => {
    const txRef = String(req.query.tx_ref || '');
    if (!txRef) {
      return res.status(400).json({ success: false, error: 'Missing transaction reference (tx_ref).' });
    }
    const result = await finalizePayment(txRef);
    // retryable = Chapa hasn't finished yet (e.g. telebirr still confirming), so the site keeps checking
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: result.error, retryable: !!result.retryable });
    }
    res.json({ success: true, order: result.order, payment: result.payment });
  })
);

// 6. Chapa webhook: Chapa calls this when a payment completes, even if the customer closed the tab.
// Set the same secret in the Chapa dashboard (Settings → Webhooks → Secret hash) and in
// CHAPA_WEBHOOK_SECRET. Unsigned or wrongly signed calls are rejected. Even a valid call is
// only a hint: the payment is still confirmed directly with Chapa's API before any order exists.
function hmacHex(secret: string, data: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

app.post(
  '/api/payment/webhook',
  route(async (req, res) => {
    const secret = process.env.CHAPA_WEBHOOK_SECRET || '';
    if (!secret) {
      console.warn('[webhook] Rejected: CHAPA_WEBHOOK_SECRET is not set.');
      return res.status(503).json({ success: false, error: 'Webhook not configured.' });
    }

    const rawBody: Buffer = (req as any).rawBody || Buffer.from('');
    const payloadSig = String(req.headers['x-chapa-signature'] || '');
    const secretSig = String(req.headers['chapa-signature'] || '');
    const valid =
      (payloadSig && safeEqualHex(payloadSig, hmacHex(secret, rawBody))) ||
      (secretSig && safeEqualHex(secretSig, hmacHex(secret, secret)));

    if (!valid) {
      console.warn('[webhook] Rejected: missing or invalid Chapa signature.');
      return res.status(401).json({ success: false, error: 'Invalid Chapa signature.' });
    }

    const txRef = String(req.body?.tx_ref || req.body?.trx_ref || '');
    const event = String(req.body?.event || req.body?.status || '');
    console.log(`[webhook] Chapa ${event || 'event'} for ${txRef || 'unknown tx_ref'}`);
    if (!txRef || !(await ordersRepo.paymentExists(txRef))) {
      return res.sendStatus(200); // Not one of ours (or not a payment event): acknowledge and ignore
    }

    const result = await finalizePayment(txRef);
    if (result.ok) {
      console.log(`[webhook] ${txRef} confirmed → order ${result.order.orderNumber}`);
      return res.sendStatus(200);
    }
    // Ask Chapa to retry later only when the problem may be temporary
    return res.sendStatus(result.retryable ? 503 : 200);
  })
);

// 6b. Chapa callback: Chapa sends a GET request to the callback_url given for each payment
// (?trx_ref=...&status=...). It isn't signed, so it's only a nudge: finalizePayment confirms the
// payment with Chapa's API before anything changes, and unknown references are ignored.
app.get(
  '/api/payment/callback',
  route(async (req, res) => {
    const txRef = String(req.query.trx_ref || req.query.tx_ref || '').slice(0, 100);
    if (!txRef || !(await ordersRepo.paymentExists(txRef))) return res.sendStatus(200);
    console.log(`[callback] Chapa callback for ${txRef}`);
    const result = await finalizePayment(txRef);
    if (result.ok) console.log(`[callback] ${txRef} confirmed → order ${result.order.orderNumber}`);
    return res.sendStatus(result.ok || !result.retryable ? 200 : 503);
  })
);

// 7. Orders List & Filter (Admin)
app.get(
  '/api/orders',
  requireStaff(),
  route(async (req, res) => {
    const q = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
    const orders = await ordersRepo.listOrders({
      status: q('status'),
      paymentStatus: q('paymentStatus'),
      date: q('date') && /^\d{4}-\d{2}-\d{2}$/.test(q('date')!) ? q('date') : undefined,
      floor: q('floor'),
      search: q('search'),
    });
    res.json({ success: true, orders });
  })
);

// 8. Order Details
app.get(
  '/api/orders/:id',
  requireStaff(),
  route(async (req, res) => {
    const order = await ordersRepo.getOrderByIdOrNumber(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    const payment = await ordersRepo.getPaymentForOrder(order);
    const auditLogs = await auditForOrder(order.id);
    res.json({ success: true, order, payment, auditLogs });
  })
);

// 9. Admin Accepts Order with Estimated Preparation Time
app.post(
  '/api/orders/:id/accept',
  requireStaff(...MANAGERS),
  route(async (req, res) => {
    const existing = await ordersRepo.getOrder(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Order not found' });

    const minutes = Number(req.body?.prepTimeMinutes) || 30;
    // In Addis Ababa time, whatever time zone the server runs in (e.g. '11:06 PM')
    const readyTimeStr = formatTime12(restaurantNow(new Date(Date.now() + minutes * 60000)).minutes);

    const order = (await ordersRepo.updateOrder(existing.id, {
      status: 'accepted',
      estimatedPrepMinutes: minutes,
      estimatedReadyTime: readyTimeStr,
      acceptedAt: new Date().toISOString(),
      soundAlertDismissed: true, // Stops the continuous sound alert for this order
    }))!;

    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: 'ORDER_ACCEPTED',
      relatedOrderId: order.id,
      previousValue: `Status: ${existing.status}`,
      newValue: `Status: accepted, Est Prep Time: ${minutes}m, Ready ~${readyTimeStr}`,
    });

    dispatchTeamsNotification(order, 'ORDER_ACCEPTED');
    notifyCustomer(order, 'accepted');
    res.json({ success: true, order });
  })
);

// 10. Admin Declines Order with Reason & Refund
app.post(
  '/api/orders/:id/decline',
  requireStaff(...MANAGERS),
  route(async (req, res) => {
    const declineReason = String(req.body?.declineReason || '').trim();
    if (!declineReason) {
      return res.status(400).json({ success: false, error: 'A decline reason is mandatory.' });
    }

    const existing = await ordersRepo.getOrder(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Order not found' });

    const now = new Date().toISOString();
    const { order, payment } = await transaction(async (client) => {
      let order = (await ordersRepo.updateOrder(
        existing.id,
        { status: 'declined', declinedReason: declineReason, declinedAt: now, soundAlertDismissed: true },
        client
      ))!;
      let payment = await ordersRepo.getPaymentForOrder(order, client, true);
      if (payment && payment.status === 'successful') {
        payment = await ordersRepo.updatePayment(
          payment.id,
          {
            status: 'refunded',
            refundReference: `CHP-REFUND-${Date.now().toString().slice(-6)}`,
            refundReason: declineReason,
            refundAmount: payment.amount,
            refundedAt: now,
          },
          client
        );
        order = (await ordersRepo.updateOrder(order.id, { paymentStatus: 'refunded' }, client))!;
      }
      return { order, payment };
    });

    // Ask Chapa to refund (outcome not yet tracked; see refunds follow-up)
    const chapaSecretKey = getChapaKey();
    if (payment && payment.status === 'refunded' && chapaSecretKey) {
      try {
        await fetch(`https://api.chapa.co/v1/refund/${encodeURIComponent(payment.txRef)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${chapaSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ reason: declineReason, amount: String(payment.amount) }),
        });
      } catch (err: any) {
        console.warn('Chapa refund API call warning:', err?.message);
      }
    }

    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: 'ORDER_DECLINED_REFUNDED',
      relatedOrderId: order.id,
      previousValue: `Status: ${existing.status}`,
      newValue: `Status: declined. Reason: ${declineReason}. Refund: ${order.totalAmount} ETB`,
    });

    dispatchTeamsNotification(order, 'ORDER_DECLINED');
    notifyCustomer(order, 'declined');
    res.json({ success: true, order, payment });
  })
);

// 11. Admin Updates Order Status (preparing -> ready -> completed)
const ORDER_STATUSES: OrderStatus[] = ['pending', 'accepted', 'preparing', 'ready', 'completed', 'declined', 'cancelled'];

app.post(
  '/api/orders/:id/status',
  requireStaff(...MANAGERS),
  route(async (req, res) => {
    const status = req.body?.status as OrderStatus;
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Unknown order status.' });
    }
    const existing = await ordersRepo.getOrder(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Order not found' });

    const order = (await ordersRepo.updateOrder(existing.id, {
      status,
      ...(status === 'completed' ? { completedAt: new Date().toISOString() } : {}),
    }))!;

    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: `STATUS_CHANGE_TO_${status.toUpperCase()}`,
      relatedOrderId: order.id,
      previousValue: `Status: ${existing.status}`,
      newValue: `Status: ${status}`,
    });
    // Tell the customer when their food is ready (once, on the change to "ready")
    if (status === 'ready' && existing.status !== 'ready') notifyCustomer(order, 'ready');
    res.json({ success: true, order });
  })
);

// 11b. Public order tracking: customers need their order number AND the email used at
// checkout. Order numbers are sequential, so the number alone must never be enough.
function normalizeOrderNumber(raw: unknown): string {
  const s = String(raw || '').trim().toUpperCase();
  return s.startsWith('#') ? s : `#${s}`;
}

async function findCustomerOrder(orderNumber: unknown, email: unknown): Promise<Order | null> {
  const num = normalizeOrderNumber(orderNumber);
  const mail = String(email || '').trim().toLowerCase();
  if (!mail || num.length < 3) return null;
  return ordersRepo.findCustomerOrder(num, mail);
}

app.post(
  '/api/track',
  route(async (req, res) => {
    if (isRateLimited(`track:${req.ip}`, 30, 15 * 60 * 1000)) {
      return res.status(429).json({ success: false, error: 'Too many lookups. Try again in a few minutes.' });
    }
    const order = await findCustomerOrder(req.body?.orderNumber, req.body?.email);
    if (!order) {
      return res.status(404).json({ success: false, error: 'We couldn’t find an order with that number and email.' });
    }
    res.json({ success: true, order });
  })
);

// 12. Customer Cancellation Request (must prove ownership with the checkout email)
app.post(
  '/api/orders/:id/cancel-request',
  route(async (req, res) => {
    const { reason, email } = req.body || {};
    const match = await ordersRepo.getOrder(req.params.id);
    const owned = match ? await findCustomerOrder(match.orderNumber, email) : null;
    if (!match || !owned || owned.id !== match.id) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (match.status === 'completed' || match.status === 'declined' || match.status === 'cancelled') {
      return res.status(400).json({ success: false, error: `Order cannot be cancelled in status: ${match.status}` });
    }

    const cancellationReason = String(reason || '').trim() || 'Customer requested cancellation';
    const order = await transaction(async (client) => {
      if (match.status !== 'pending') {
        // Already accepted: record the request for the kitchen to review
        return (await ordersRepo.updateOrder(match.id, { cancellationReason }, client))!;
      }
      // Still pending: cancel straight away and mark the payment refunded
      const now = new Date().toISOString();
      let order = (await ordersRepo.updateOrder(
        match.id,
        { cancellationReason, status: 'cancelled', cancelledAt: now, soundAlertDismissed: true },
        client
      ))!;
      const payment = await ordersRepo.getPaymentForOrder(order, client, true);
      if (payment) {
        await ordersRepo.updatePayment(
          payment.id,
          {
            status: 'refunded',
            refundAmount: payment.amount,
            refundReason: 'Customer cancelled before acceptance',
            refundReference: `CHP-CAN-${Date.now().toString().slice(-6)}`,
            refundedAt: now,
          },
          client
        );
        order = (await ordersRepo.updateOrder(order.id, { paymentStatus: 'refunded' }, client))!;
      }
      return order;
    });

    await addAudit({
      adminId: 'customer',
      adminName: `${order.customer.firstName} ${order.customer.lastName}`,
      action: 'CANCELLATION_REQUESTED',
      relatedOrderId: order.id,
      previousValue: 'Active order',
      newValue: `Reason: ${cancellationReason}`,
    });
    if (order.status === 'cancelled') notifyCustomer(order, 'cancelled');
    res.json({ success: true, order });
  })
);

// 13. Super Admin Manual Refund
app.post(
  '/api/orders/:id/refund',
  requireStaff('super_admin'),
  route(async (req, res) => {
    const { refundReason, refundAmount } = req.body || {};
    const existing = await ordersRepo.getOrder(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Order not found' });

    const result = await transaction(async (client) => {
      const payment = await ordersRepo.getPaymentForOrder(existing, client, true);
      if (!payment) return null;
      const amount = Number(refundAmount) || payment.amount;
      const status: Payment['status'] = amount < payment.amount ? 'partially_refunded' : 'refunded';
      const updatedPayment = await ordersRepo.updatePayment(
        payment.id,
        {
          status,
          refundAmount: amount,
          refundReason: refundReason || 'Admin authorized refund',
          refundReference: `CHP-AUTH-REF-${Date.now().toString().slice(-6)}`,
          refundedAt: new Date().toISOString(),
        },
        client
      );
      const order = await ordersRepo.updateOrder(existing.id, { paymentStatus: status }, client);
      return { payment: updatedPayment!, order: order!, amount };
    });
    if (!result) return res.status(404).json({ success: false, error: 'Payment record not found' });

    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: 'MANUAL_REFUND_EXECUTED',
      relatedOrderId: existing.id,
      previousValue: `Payment Status: successful`,
      newValue: `Refund Amount: ${result.amount} ETB. Reason: ${refundReason}`,
    });
    res.json({ success: true, payment: result.payment, order: result.order });
  })
);

// 14. Sound Alert Engine (paid orders the kitchen hasn't handled yet)
app.get(
  '/api/admin/alerts',
  requireStaff(),
  route(async (_req, res) => {
    const activeOrders = await ordersRepo.unhandledPaidOrders();
    res.json({ success: true, hasActiveAlert: activeOrders.length > 0, count: activeOrders.length, activeOrders });
  })
);

// 15. Dashboard Metrics & KPI summary
app.get(
  '/api/admin/metrics',
  requireStaff(),
  route(async (_req, res) => {
    const today = new Date().toISOString().split('T')[0];
    res.json({ success: true, metrics: await ordersRepo.dashboardMetrics(today) });
  })
);

// 16. Reporting & Analytics API
app.get(
  '/api/admin/reports',
  requireStaff(),
  route(async (_req, res) => {
    res.json({ success: true, ...(await ordersRepo.reports()) });
  })
);

// 17. Staff accounts
app.get(
  '/api/admin/users',
  requireStaff('super_admin'),
  route(async (_req, res) => {
    res.json({ success: true, users: (await staffRepo.listStaff()).map(staffRepo.publicStaff) });
  })
);

app.post(
  '/api/admin/users',
  requireStaff('super_admin'),
  route(async (req, res) => {
    const name = cleanText(req.body?.name, 80);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = req.body?.role as AdminRole;
    const { isActive, password } = req.body || {};

    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['super_admin', 'restaurant_admin', 'reporting'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Name, a valid email, and a role are required.' });
    }
    if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 10)) {
      return res.status(400).json({ success: false, error: 'Passwords need at least 10 characters.' });
    }

    let user = await staffRepo.findStaffByEmail(email);
    if (user) {
      if (user.id === req.staff!.id && (role !== 'super_admin' || isActive === false)) {
        return res.status(400).json({ success: false, error: 'You can’t remove your own super admin access.' });
      }
      user = await staffRepo.updateStaff(user.id, {
        name,
        role,
        ...(typeof isActive === 'boolean' ? { isActive } : {}),
      });
    } else {
      if (!password) {
        return res.status(400).json({ success: false, error: 'Set a starting password for the new staff member.' });
      }
      user = await staffRepo.insertStaff({ id: newId('usr'), name, email, role, isActive: isActive !== false });
    }
    if (password) await staffRepo.setStaffPassword(user!.id, hashPassword(password));

    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: 'ADMIN_USER_UPDATED',
      newValue: `User: ${user!.name} (${user!.email}) Role: ${user!.role}`,
    });
    res.json({ success: true, user: staffRepo.publicStaff((await staffRepo.findStaffById(user!.id))!) });
  })
);

// 17b. Email settings check (owner only). Settings live in .env; the password is never shown.
app.get(
  '/api/admin/email/status',
  requireStaff('super_admin'),
  route(async (_req, res) => {
    res.json({ success: true, email: emailStatus() });
  })
);

app.post(
  '/api/admin/email/test',
  requireStaff('super_admin'),
  route(async (req, res) => {
    if (isRateLimited(`email-test:${req.staff!.id}`, 5, 10 * 60 * 1000)) {
      return res.status(429).json({ success: false, error: 'Too many test emails. Try again in a few minutes.' });
    }
    const to = String(req.body?.to || req.staff!.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
    }
    // Sign in first, so a bad password or disabled SMTP gives a clear message
    const connection = await verifyEmailConnection();
    if (!connection.ok) return res.status(400).json({ success: false, error: connection.error });

    const result = await sendEmail(testEmail(to, req.staff!.name));
    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: result.ok ? 'TEST_EMAIL_SENT' : 'TEST_EMAIL_FAILED',
      newValue: result.ok ? `To ${to}` : `To ${to}: ${result.error}`,
    });
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, to });
  })
);

// 17c. Teams direct messages to customers (owner only). The workflow link is never shown.
app.get(
  '/api/admin/teams/status',
  requireStaff('super_admin'),
  route(async (_req, res) => {
    res.json({ success: true, teams: teamsDirectStatus() });
  })
);

app.post(
  '/api/admin/teams/test',
  requireStaff('super_admin'),
  route(async (req, res) => {
    if (isRateLimited(`teams-test:${req.staff!.id}`, 5, 10 * 60 * 1000)) {
      return res.status(429).json({ success: false, error: 'Too many test messages. Try again in a few minutes.' });
    }
    const to = String(req.body?.to || req.staff!.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ success: false, error: 'Enter a valid work email address.' });
    }
    const result = await sendTeamsDirect(to, testTeamsCard(req.staff!.name));
    const who = actor(req);
    await addAudit({
      adminId: who.id,
      adminName: who.name,
      action: result.ok ? 'TEST_TEAMS_SENT' : 'TEST_TEAMS_FAILED',
      newValue: result.ok ? `To ${to}` : `To ${to}: ${result.error}`,
    });
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, to });
  })
);

// 18. Audit Logs & Notifications
app.get(
  '/api/admin/audit-logs',
  requireStaff(),
  route(async (_req, res) => {
    res.json({ success: true, logs: await listAudit() });
  })
);

app.get(
  '/api/admin/notifications',
  requireStaff(),
  route(async (_req, res) => {
    res.json({ success: true, notifications: await listNotifications() });
  })
);

// Health check for hosting platforms and uptime monitors
app.get(
  '/api/health',
  route(async (_req, res) => {
    await query('SELECT 1');
    res.json({ success: true, database: 'ok' });
  })
);

// Unknown API routes return JSON, never the website's HTML
app.use('/api', (_req: Request, res: Response) => notFound(res));

// Any error thrown in a route ends here: log it, return a generic message.
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'That file or request is too large.' });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err?.message || err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, error: 'Something went wrong on our side. Please try again.' });
});

// ==========================================
// STARTUP: database, then web server
// ==========================================
async function startServer() {
  try {
    const applied = await runMigrations();
    if (applied.length) console.log(`[db] Applied migrations: ${applied.join(', ')}`);
    await settingsRepo.ensureSettings();
    const seeded = await seedIfEmpty();
    clearCache(); // the seed writes inside a transaction, bypassing the per-write invalidation
    if (seeded === 'imported') console.log('[db] Imported existing data from data/plenty_db.json into PostgreSQL.');
    if (seeded === 'seeded') console.log('[db] Empty database: added the starter menu, settings and staff list.');
    await bootstrapStaffCredentials();
    console.log(isEmailConfigured() ? `[email] Sending from ${emailStatus().from} via ${emailStatus().host}` : '[email] Not set up yet: customer emails are logged as skipped. Add SMTP settings to .env.');
  } catch (err: any) {
    console.error(`\n[db] Could not prepare the database: ${err.message}`);
    console.error('[db] Check DATABASE_URL in .env and that PostgreSQL is running.\n');
    process.exit(1);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Plenty Restaurant platform running on port ${PORT}`);
  });

  // Finish in-flight requests and close database connections on shutdown
  const shutdown = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
