/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Order } from '../../src/types.ts';
import { OutgoingEmail } from './mailer.ts';
import { serviceLong, serviceOf } from '../../src/utils/service.ts';

export type OrderEmailType = 'confirmed' | 'accepted' | 'ready' | 'declined' | 'cancelled';

const NAVY = '#152039';
const ORANGE = '#e8663f';
const CREAM = '#fdf3ea';
const MUTED = '#6b7280';
const LINE = '#ecdccc';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function appUrl(): string {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

/** Opens the order tracker on the site, already filled in */
function trackingUrl(order: Order): string {
  const num = order.orderNumber.replace(/^#/, '');
  return `${appUrl()}/?track=${encodeURIComponent(num)}&email=${encodeURIComponent(order.customer.email)}`;
}

function birr(n: number): string {
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} birr`;
}

/** '2026-11-16' → 'Monday 16 November' */
function niceDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

function pickupLine(order: Order): string {
  return `${niceDate(order.pickup.pickupDate)} at ${order.pickup.pickupTime}, ${serviceLong(order.pickup).toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function layout(opts: { preheader: string; heading: string; intro: string; body: string; cta?: { label: string; url: string } }): string {
  const button = opts.cta
    ? `<tr><td style="padding:8px 32px 32px">
         <a href="${esc(opts.cta.url)}" style="display:inline-block;background:${ORANGE};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:999px">${esc(opts.cta.label)}</a>
       </td></tr>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${NAVY}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
    <tr><td style="background:${NAVY};padding:22px 32px">
      <span style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:28px;color:#ffffff">Plenty</span>
    </td></tr>
    <tr><td style="padding:32px 32px 8px">
      <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.2;color:${NAVY}">${esc(opts.heading)}</h1>
      <p style="margin:12px 0 0;font-size:16px;line-height:1.55;color:#374151">${opts.intro}</p>
    </td></tr>
    <tr><td style="padding:16px 32px">${opts.body}</td></tr>
    ${button}
  </table>
  <p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:${MUTED}">
    You're getting this because you ordered from Plenty. Replies reach the restaurant.
  </p>
</td></tr></table></body></html>`;
}

function detailsTable(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};font-size:15px">
    ${rows
      .map(
        ([k, v]) => `<tr>
          <td style="padding:11px 0;border-bottom:1px solid ${LINE};color:${MUTED};width:38%">${esc(k)}</td>
          <td style="padding:11px 0;border-bottom:1px solid ${LINE};color:${NAVY};text-align:right">${esc(v)}</td>
        </tr>`
      )
      .join('')}
  </table>`;
}

function itemsTable(order: Order): string {
  const rows = order.items
    .map((it) => {
      const extras = (it.selectedToppings || [])
        .map((t) => `${t.quantity && t.quantity > 1 ? `${t.quantity}× ` : ''}${t.name}`)
        .join(', ');
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid ${LINE};vertical-align:top">
          <div style="color:${NAVY}">${esc(it.quantity)}× ${esc(it.name)}</div>
          ${extras ? `<div style="color:${MUTED};font-size:13px;margin-top:2px">${esc(extras)}</div>` : ''}
          ${it.specialNotes ? `<div style="color:${MUTED};font-size:13px;font-style:italic;margin-top:2px">“${esc(it.specialNotes)}”</div>` : ''}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid ${LINE};text-align:right;vertical-align:top;white-space:nowrap">${esc(birr(it.totalPrice))}</td>
      </tr>`;
    })
    .join('');
  return `<p style="margin:20px 0 6px;font-size:13px;color:${MUTED}">Your order</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};font-size:15px">
      ${rows}
      <tr><td style="padding:12px 0;font-weight:600">Paid</td>
          <td style="padding:12px 0;text-align:right;font-weight:600">${esc(birr(order.totalAmount))}</td></tr>
    </table>`;
}

function itemsText(order: Order): string {
  return order.items
    .map((it) => {
      const extras = (it.selectedToppings || []).map((t) => `${t.quantity && t.quantity > 1 ? `${t.quantity}x ` : ''}${t.name}`).join(', ');
      return `- ${it.quantity}x ${it.name}${extras ? ` (${extras})` : ''}: ${birr(it.totalPrice)}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Order emails
// ---------------------------------------------------------------------------

export function orderEmail(type: OrderEmailType, order: Order): OutgoingEmail {
  const name = order.customer.firstName;
  const num = order.orderNumber;
  const track = trackingUrl(order);
  const pickup = pickupLine(order);

  switch (type) {
    case 'confirmed':
      return {
        to: order.customer.email,
        subject: `Order ${num} received: ${niceDate(order.pickup.pickupDate)}, ${order.pickup.pickupTime}`,
        html: layout({
          preheader: `We've got your order and payment. ${pickup}.`,
          heading: `Thank you, ${name}.`,
          intro: 'Your payment went through and the kitchen has your order. We’ll email you again when they confirm it.',
          body: detailsTable([
            ['Order', num],
            ['When', `${niceDate(order.pickup.pickupDate)}, ${order.pickup.pickupTime}`],
            ['Service', serviceLong(order.pickup)],
          ]) + itemsTable(order),
          cta: { label: 'Follow your order', url: track },
        }),
        text: `Thank you, ${name}.\n\nYour payment went through and the kitchen has your order ${num}.\nWhen: ${pickup}\n\n${itemsText(order)}\nPaid: ${birr(order.totalAmount)}\n\nFollow your order: ${track}\n`,
      };

    case 'accepted':
      return {
        to: order.customer.email,
        subject: `Order ${num} confirmed: ready around ${order.estimatedReadyTime || order.pickup.pickupTime}`,
        html: layout({
          preheader: `The kitchen is on it. ${pickup}.`,
          heading: 'The kitchen is on it',
          intro: `Good news, ${esc(name)}: your order is confirmed and being prepared.`,
          body: detailsTable([
            ['Order', num],
            ['When', `${niceDate(order.pickup.pickupDate)}, ${order.pickup.pickupTime}`],
            ['Service', serviceLong(order.pickup)],
            ...(order.estimatedReadyTime ? ([['Ready around', order.estimatedReadyTime]] as [string, string][]) : []),
          ]),
          cta: { label: 'Follow your order', url: track },
        }),
        text: `Good news, ${name}: your order ${num} is confirmed and being prepared.\nWhen: ${pickup}\n${order.estimatedReadyTime ? `Ready around: ${order.estimatedReadyTime}\n` : ''}\nFollow your order: ${track}\n`,
      };

    case 'ready': {
      const dineIn = serviceOf(order.pickup) === 'dine_in';
      const floor = order.pickup.floorNumber;
      return {
        to: order.customer.email,
        subject: dineIn ? `Order ${num} is ready: your table is waiting` : `Order ${num} is ready and on its way to floor ${floor}`,
        html: layout({
          preheader: dineIn ? 'Your food is ready and your table is waiting.' : `Your food is ready and on its way to floor ${floor}.`,
          heading: 'Your order is ready',
          intro: dineIn
            ? `Come to the restaurant and show your order number <strong>${esc(num)}</strong>. Enjoy, ${esc(name)}!`
            : `It’s on its way to floor ${esc(floor)}. Have your order number <strong>${esc(num)}</strong> handy. Enjoy, ${esc(name)}!`,
          body: itemsTable(order),
        }),
        text: `Your order ${num} is ready, ${name}.\n${
          dineIn ? 'Come to the restaurant and show your order number.' : `It's on its way to floor ${floor}. Have your order number handy.`
        }\n\n${itemsText(order)}\n`,
      };
    }

    case 'declined':
      return {
        to: order.customer.email,
        subject: `We couldn't take order ${num}`,
        html: layout({
          preheader: 'Sorry, the kitchen couldn’t take this order. Your payment will be refunded.',
          heading: 'Sorry, we couldn’t take your order',
          intro: `The kitchen wasn’t able to prepare order ${esc(num)}${order.declinedReason ? `: ${esc(order.declinedReason)}` : '.'}`,
          body: `<p style="margin:0;font-size:15px;line-height:1.55;color:#374151">Your payment of <strong>${esc(
            birr(order.totalAmount)
          )}</strong> will be refunded in full to the account you paid with. If you have questions, just reply to this email.</p>`,
        }),
        text: `Sorry, ${name}. The kitchen wasn't able to prepare order ${num}${order.declinedReason ? `: ${order.declinedReason}` : '.'}\n\nYour payment of ${birr(order.totalAmount)} will be refunded in full to the account you paid with. Reply to this email with any questions.\n`,
      };

    case 'cancelled':
      return {
        to: order.customer.email,
        subject: `Order ${num} cancelled`,
        html: layout({
          preheader: 'Your order has been cancelled.',
          heading: 'Your order is cancelled',
          intro: `As you asked, order ${esc(num)} has been cancelled.`,
          body: `<p style="margin:0;font-size:15px;line-height:1.55;color:#374151">Your payment of <strong>${esc(
            birr(order.totalAmount)
          )}</strong> will be refunded in full to the account you paid with.</p>`,
        }),
        text: `Order ${num} has been cancelled, as you asked.\nYour payment of ${birr(order.totalAmount)} will be refunded in full to the account you paid with.\n`,
      };
  }
}

/** Sent from the staff portal to check the email settings work */
export function testEmail(to: string, sentBy: string): OutgoingEmail {
  return {
    to,
    subject: 'Plenty: test email',
    html: layout({
      preheader: 'Email from the Plenty ordering site is working.',
      heading: 'Email is working',
      intro: `This test was sent from the Plenty staff portal by ${esc(sentBy)}. Customers will now get order confirmations and updates from this address.`,
      body: '',
    }),
    text: `Email is working.\n\nThis test was sent from the Plenty staff portal by ${sentBy}. Customers will now get order confirmations and updates from this address.\n`,
  };
}
