/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Only staff of these companies can place orders. Shared by the checkout form and the
 * server, so the rule is enforced even if someone bypasses the form.
 */
export const APPROVED_EMAIL_DOMAINS = ['mmcy.com', 'mmcytech.com'];

/** Domain part of an email, lowercased, or '' if it isn't a plausible address. */
export function emailDomain(email: string): string {
  const match = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim().toLowerCase());
  return match ? match[1] : '';
}

/** True only for an exact approved domain, e.g. name@mmcy.com (not mmcy.com.evil.io). */
export function isApprovedCompanyEmail(email: string): boolean {
  return APPROVED_EMAIL_DOMAINS.includes(emailDomain(email));
}

export const APPROVED_EMAIL_HINT = `Use your company email ending in ${APPROVED_EMAIL_DOMAINS.map((d) => `@${d}`).join(' or ')}.`;
