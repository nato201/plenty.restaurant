/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'declined'
  | 'cancelled';

export type PaymentStatus =
  | 'pending'
  | 'successful'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type PaymentMethod =
  | 'telebirr'
  | 'cbe_birr'
  | 'card'
  | 'chapa_wallet'
  | 'other';

export type AdminRole = 'super_admin' | 'restaurant_admin' | 'reporting';

export type FloorNumber = 2 | 8 | 10 | 11 | 12 | 13;

export type ServiceType = 'delivery' | 'dine_in';

export interface Topping {
  id: string;
  name: string;
  price: number; // in ETB
  quantity?: number; // quantity of this extra (e.g. 2x extra egg)
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  groupLabel?: string;
  description: string;
  price: number; // in ETB
  available: boolean;
  imageUrl?: string;
  isVegetarian?: boolean;
  isFasting?: boolean;
  isSpecial?: boolean;
  availableToppings?: Topping[];
}

export interface CartItem {
  cartItemId: string;
  menuItem: MenuItem;
  quantity: number;
  selectedToppings: Topping[];
  specialNotes?: string;
  itemTotal: number; // in ETB
}

export interface OrderItem {
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  selectedToppings: Topping[];
  specialNotes?: string;
  totalPrice: number;
}

export interface Order {
  id: string;
  orderNumber: string; // e.g. #PLT-2026-1042
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
  };
  pickup: {
    pickupDate: string; // YYYY-MM-DD
    pickupTime: string; // e.g. "12:15 PM"
    /** 'delivery' = brought to their floor; 'dine_in' = eaten at a table in the restaurant. */
    serviceType: ServiceType;
    floorNumber?: FloorNumber; // delivery only
    specialInstructions?: string;
  };
  items: OrderItem[];
  subtotal: number; // ETB
  taxOrFees: number; // ETB (if any)
  totalAmount: number; // ETB
  status: OrderStatus;
  paymentId: string;
  paymentStatus: PaymentStatus;
  estimatedPrepMinutes?: number;
  estimatedReadyTime?: string;
  acceptedAt?: string;
  declinedReason?: string;
  declinedAt?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  completedAt?: string;
  soundAlertDismissed?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  orderId?: string;
  orderNumber?: string;
  provider: 'Chapa';
  txRef: string; // Unique transaction reference (e.g. PLT-TX-...)
  chapaReference?: string;
  amount: number; // in ETB
  currency: 'ETB';
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  checkoutUrl?: string;
  paidAt?: string;
  refundReference?: string;
  refundReason?: string;
  refundAmount?: number;
  refundedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PickupSlot {
  slotId: string;
  pickupDate: string;
  startTime: string; // e.g. "12:00 PM"
  endTime: string; // e.g. "12:15 PM"
  maxCapacity: number;
  currentCapacity: number;
  isAvailable: boolean;
  reason?: string;
}

/** Opening hours for one day of the week. Times are 24-hour "HH:MM" in Addis Ababa time. */
export interface DaySchedule {
  isOpen: boolean;
  openTime: string; // "09:00"
  closeTime: string; // "23:30"
}

export interface RestaurantSettings {
  /** Seven entries, index 0 = Sunday … 6 = Saturday. This is what the site and checkout use. */
  weeklySchedule: DaySchedule[];
  /** @deprecated Replaced by weeklySchedule; kept so older saved settings still load. */
  operatingHours: {
    openTime: string; // "07:30"
    closeTime: string; // "20:30"
  };
  /** @deprecated Replaced by weeklySchedule. */
  availableDays: number[]; // 0 = Sunday, 1 = Mon, ..., 6 = Sat
  pickupIntervalMinutes: number; // 15 or 30
  minPrepTimeMinutes: number; // e.g. 30
  maxAdvanceOrderingDays: number; // e.g. 7
  orderCutoffMinutesBeforeClose: number; // e.g. 45
  isOrderingEnabled: boolean;
  pauseReason?: string;
  maxOrdersPerSlot: number; // e.g. 5
  maxDailyOrders: number; // e.g. 80
  holidays: string[]; // ['2026-01-07', '2026-01-19']
  chapaMode: 'sandbox' | 'live';
  teamsWebhookUrl?: string;
  adminNotificationEmail?: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  relatedOrderId?: string;
  previousValue?: string;
  newValue?: string;
  timestamp: string;
}

export interface NotificationLog {
  id: string;
  orderId: string;
  orderNumber: string;
  channel: 'sound' | 'email' | 'teams';
  title: string;
  message: string;
  timestamp: string;
  /** 'skipped' = not sent because that channel isn't set up */
  status: 'sent' | 'pending' | 'failed' | 'skipped';
  /** Email address it was sent to (email channel only) */
  recipient?: string;
  /** Why sending failed or was skipped */
  error?: string;
}

export interface DashboardMetrics {
  totalOrdersToday: number;
  totalRevenueTodayETB: number;
  pendingOrdersCount: number;
  acceptedOrdersCount: number;
  declinedOrdersCount: number;
  completedOrdersCount: number;
  failedPaymentsCount: number;
  refundedOrdersCount: number;
  upcomingPickupsCount: number;
  unhandledPaidAlertsCount: number;
}
