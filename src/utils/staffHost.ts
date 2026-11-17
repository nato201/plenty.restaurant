/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** Subdomain that serves the staff portal. Must match STAFF_SUBDOMAIN on the server. */
export const STAFF_SUBDOMAIN = ((import.meta.env.VITE_STAFF_SUBDOMAIN as string | undefined) || 'admin').toLowerCase();

/** True when the page is opened on the staff subdomain, e.g. admin.plenty.restaurant or admin.localhost. */
export function isStaffHost(hostname: string = window.location.hostname): boolean {
  const host = hostname.toLowerCase();
  return host === STAFF_SUBDOMAIN || host.startsWith(`${STAFF_SUBDOMAIN}.`);
}
