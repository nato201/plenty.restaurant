/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FloorNumber, ServiceType } from '../types.ts';

export const FLOORS: FloorNumber[] = [2, 8, 10, 11, 12, 13];

export const SERVICE_TYPES: ServiceType[] = ['delivery', 'dine_in'];

export const isServiceType = (v: unknown): v is ServiceType => v === 'delivery' || v === 'dine_in';

type Where = { serviceType?: ServiceType; floorNumber?: FloorNumber | null };

/** Old orders have no service type; they were all floor orders. */
export const serviceOf = (p: Where): ServiceType => (p.serviceType === 'dine_in' ? 'dine_in' : 'delivery');

/** Short label, e.g. "Floor 11" or "Dine-in". */
export function serviceShort(p: Where): string {
  return serviceOf(p) === 'dine_in' ? 'Dine-in' : `Floor ${p.floorNumber ?? '?'}`;
}

/** Full label, e.g. "Delivery to floor 11" or "Dine-in at the restaurant". */
export function serviceLong(p: Where): string {
  return serviceOf(p) === 'dine_in' ? 'Dine-in at the restaurant' : `Delivery to floor ${p.floorNumber ?? '?'}`;
}
