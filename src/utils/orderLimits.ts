/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Order size limits, shared by the website (so customers can't pick more) and the server
 * (which rejects anything outside them). Generous for a lunch order, small enough to stop abuse.
 */
export const ORDER_LIMITS = {
  /** Most of one dish in a single cart line */
  maxItemQuantity: 50,
  /** Most of one extra on one dish (e.g. 10 × extra egg) */
  maxExtraQuantity: 10,
  /** Most separate lines in one order */
  maxLines: 30,
  /** Longest note to the kitchen per dish */
  maxNoteLength: 300,
};

/** True for a whole number from min to max (inclusive). */
export function isWholeNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
