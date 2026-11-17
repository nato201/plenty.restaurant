/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalise an Ethiopian mobile number to the 10-digit local format Chapa requires,
 * e.g. "+251 937 599 434", "251937599434", "937599434" → "0937599434".
 * Returns '' if it isn't a valid Ethiopian mobile number (09… Ethio Telecom, 07… Safaricom).
 */
export function normalizeEthiopianMobile(input: string): string {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('251')) digits = digits.slice(3);
  if (digits.length === 9) digits = `0${digits}`;
  return /^0[79]\d{8}$/.test(digits) ? digits : '';
}

export const PHONE_HINT = 'Enter an Ethiopian mobile number, like 0911 234 567.';
