/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Order } from '../../src/types.ts';
import { serviceLong, serviceOf } from '../../src/utils/service.ts';
import { OrderEmailType } from '../email/templates.ts';

/**
 * Teams messages to the employee who ordered.
 *
 * Teams has no simple webhook that can message one person, so this posts to a Teams Workflow
 * (Power Automate) set in TEAMS_DM_WORKFLOW_URL. The workflow receives
 *   { recipient: "<work email>", summary: "<one line>", card: <Adaptive Card> }
 * and uses "Post card in a chat or channel" (Post as: Flow bot, Post in: Chat with Flow bot)
 * to deliver the card to that person. See README / .env.example for the setup steps.
 */

export function isTeamsDirectConfigured(): boolean {
  // https only; plain http is allowed just for a local test receiver
  return /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(process.env.TEAMS_DM_WORKFLOW_URL?.trim() || '');
}

/** Safe to show in the portal: never the full URL, which works like a password. */
export function teamsDirectStatus() {
  const url = process.env.TEAMS_DM_WORKFLOW_URL?.trim() || '';
  if (!isTeamsDirectConfigured()) return { configured: false };
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = 'workflow';
  }
  return { configured: true, host };
}

function appUrl(): string {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

function trackingUrl(order: Order): string {
  const num = order.orderNumber.replace(/^#/, '');
  return `${appUrl()}/?track=${encodeURIComponent(num)}&email=${encodeURIComponent(order.customer.email)}`;
}

const birr = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} birr`;

function niceDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`)
  );
}

type Tone = 'Good' | 'Attention' | 'Accent' | 'Default';

function headline(type: OrderEmailType, order: Order): { title: string; body: string; tone: Tone } {
  const name = order.customer.firstName;
  const dineIn = serviceOf(order.pickup) === 'dine_in';
  switch (type) {
    case 'confirmed':
      return { title: `Thank you, ${name}!`, body: 'Your payment went through and the kitchen has your order.', tone: 'Accent' };
    case 'accepted':
      return { title: 'The kitchen is on it', body: 'Your order is confirmed and being prepared.', tone: 'Good' };
    case 'ready':
      return dineIn
        ? { title: 'Your order is ready', body: 'Your table is waiting. Come to the restaurant and show your order number.', tone: 'Good' }
        : {
            title: 'Your order is ready',
            body: `It's on its way to floor ${order.pickup.floorNumber}. Have your order number handy.`,
            tone: 'Good',
          };
    case 'declined':
      return {
        title: 'Sorry, we couldn’t take your order',
        body: `The kitchen wasn’t able to prepare it${order.declinedReason ? `: ${order.declinedReason}` : '.'} Your payment of ${birr(
          order.totalAmount
        )} will be refunded to the account you paid with.`,
        tone: 'Attention',
      };
    case 'cancelled':
      return {
        title: 'Your order is cancelled',
        body: `As you asked, it has been cancelled. Your payment of ${birr(order.totalAmount)} will be refunded to the account you paid with.`,
        tone: 'Default',
      };
  }
}

/** An Adaptive Card (v1.4, what Teams supports) for one order update. */
export function orderTeamsCard(type: OrderEmailType, order: Order): { summary: string; card: object } {
  const h = headline(type, order);
  const facts = [
    { title: 'Order', value: order.orderNumber },
    { title: 'When', value: `${niceDate(order.pickup.pickupDate)}, ${order.pickup.pickupTime}` },
    { title: 'Service', value: serviceLong(order.pickup) },
    ...(type === 'accepted' && order.estimatedReadyTime ? [{ title: 'Ready around', value: order.estimatedReadyTime }] : []),
    { title: type === 'declined' || type === 'cancelled' ? 'Refund' : 'Paid', value: birr(order.totalAmount) },
  ];
  const showItems = type === 'confirmed' || type === 'ready';
  const link = trackingUrl(order);

  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    msteams: { width: 'Full' },
    body: [
      {
        type: 'Container',
        style: 'emphasis',
        bleed: true,
        items: [
          { type: 'TextBlock', text: 'PLENTY', weight: 'Bolder', size: 'Small', color: 'Accent', spacing: 'None' },
          { type: 'TextBlock', text: h.title, weight: 'Bolder', size: 'Large', wrap: true, spacing: 'Small', color: h.tone === 'Default' ? undefined : h.tone },
        ],
      },
      { type: 'TextBlock', text: h.body, wrap: true, spacing: 'Medium' },
      { type: 'FactSet', facts, spacing: 'Medium' },
      ...(showItems
        ? [
            { type: 'TextBlock', text: 'Your order', weight: 'Bolder', size: 'Small', spacing: 'Medium', isSubtle: true },
            ...order.items.map((it) => {
              const extras = (it.selectedToppings || [])
                .map((t) => `${t.quantity && t.quantity > 1 ? `${t.quantity}× ` : ''}${t.name}`)
                .join(', ');
              return {
                type: 'ColumnSet',
                spacing: 'Small',
                columns: [
                  {
                    type: 'Column',
                    width: 'stretch',
                    items: [
                      { type: 'TextBlock', text: `${it.quantity}× ${it.name}`, wrap: true, spacing: 'None' },
                      ...(extras ? [{ type: 'TextBlock', text: extras, wrap: true, size: 'Small', isSubtle: true, spacing: 'None' }] : []),
                    ],
                  },
                  { type: 'Column', width: 'auto', items: [{ type: 'TextBlock', text: birr(it.totalPrice), spacing: 'None' }] },
                ],
              };
            }),
          ]
        : []),
    ],
    actions: type === 'cancelled' ? [] : [{ type: 'Action.OpenUrl', title: 'Follow your order', url: link }],
  };

  return { summary: `${order.orderNumber}: ${h.title}`, card };
}

export function testTeamsCard(sentBy: string): { summary: string; card: object } {
  return {
    summary: 'Plenty: Teams messages are working',
    card: {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        { type: 'TextBlock', text: 'PLENTY', weight: 'Bolder', size: 'Small', color: 'Accent' },
        { type: 'TextBlock', text: 'Teams messages are working', weight: 'Bolder', size: 'Large', wrap: true },
        {
          type: 'TextBlock',
          wrap: true,
          text: `This test was sent from the Plenty staff portal by ${sentBy}. Employees will now get their order updates here in Teams.`,
        },
      ],
    },
  };
}

export type TeamsSendResult = { ok: true } | { ok: false; skipped?: boolean; error: string };

/**
 * Hand the card to the workflow. A 2xx answer means the workflow accepted it; whether Teams then
 * delivered it shows in the workflow's run history (e.g. if the person isn't in your organisation).
 */
export async function sendTeamsDirect(recipient: string, message: { summary: string; card: object }): Promise<TeamsSendResult> {
  if (!isTeamsDirectConfigured()) {
    return { ok: false, skipped: true, error: 'Teams messages aren’t set up yet (TEAMS_DM_WORKFLOW_URL missing in .env).' };
  }
  try {
    const res = await fetch(process.env.TEAMS_DM_WORKFLOW_URL!.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, summary: message.summary, card: message.card }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `The workflow refused the request (${res.status}). Check that its link is complete and that "Anyone" can trigger it.` };
    }
    if (res.status === 404) return { ok: false, error: 'The workflow link wasn’t found (404). It may have been deleted or turned off.' };
    return { ok: false, error: `The workflow answered ${res.status}${detail ? `: ${detail}` : ''}` };
  } catch (err: any) {
    return { ok: false, error: `Couldn’t reach the workflow (${err?.name === 'TimeoutError' ? 'timed out' : err?.message || err}).` };
  }
}
