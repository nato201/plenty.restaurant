/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdminUser } from '../types.ts';

/** The signed-in staff member, as returned by /api/staff/me */
export type StaffUser = Pick<AdminUser, 'id' | 'name' | 'email' | 'role'>;
