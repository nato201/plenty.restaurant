/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Clock,
  Building,
  User,
  Mail,
  Phone,
  ShieldCheck,
  AlertCircle,
  CreditCard,
  CheckCircle2,
  ChevronRight,
  ArrowLeft,
  Loader2,
  Truck,
  UtensilsCrossed,
} from 'lucide-react';
import { CartItem, FloorNumber, PickupSlot, RestaurantSettings, ServiceType } from '../types.ts';
import { FLOORS, isServiceType } from '../utils/service.ts';
import { addDays, getWeeklySchedule, nextOrderableDate, restaurantNow } from '../utils/schedule.ts';
import { normalizeEthiopianMobile, PHONE_HINT } from '../utils/phone.ts';
import { APPROVED_EMAIL_DOMAINS, APPROVED_EMAIL_HINT, isApprovedCompanyEmail } from '../utils/companyEmail.ts';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  onPaymentInitiated: (txRef: string, checkoutUrl: string) => void;
  /** Opening hours and ordering limits, so the date picker starts on a day the restaurant is open */
  settings?: Partial<RestaurantSettings>;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  cart,
  onPaymentInitiated,
  settings,
}) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Customer Details (Remembered from localStorage or pre-filled)
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [rememberDetails, setRememberDetails] = useState(true);
  const [hasRememberedEmail, setHasRememberedEmail] = useState(false);

  // Load remembered customer details on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedEmail = localStorage.getItem('plenty_saved_email');
        const savedInfo = localStorage.getItem('plenty_saved_customer_info');
        const rememberPref = localStorage.getItem('plenty_remember_pref');
        
        if (rememberPref !== null) {
          setRememberDetails(rememberPref === 'true');
        }

        if (savedInfo) {
          const parsed = JSON.parse(savedInfo);
          if (parsed.firstName) setFirstName(parsed.firstName);
          if (parsed.lastName) setLastName(parsed.lastName);
          if (parsed.email) {
            setEmail(parsed.email);
            setHasRememberedEmail(true);
          }
          if (parsed.phoneNumber) setPhoneNumber(parsed.phoneNumber);
          if (parsed.floorNumber) setFloorNumber(parsed.floorNumber);
          if (isServiceType(parsed.serviceType)) setServiceType(parsed.serviceType);
        } else if (savedEmail) {
          setEmail(savedEmail);
          setHasRememberedEmail(true);
        }
      } catch (e) {
        console.error('Error reading saved customer details:', e);
      }
    }
  }, [isOpen]);

  // Pickup Details
  // Dates are in the restaurant's time zone (Addis Ababa), not the visitor's
  const todayStr = restaurantNow().date;
  const maxDaysAhead = settings?.maxAdvanceOrderingDays ?? 7;
  const lastDateStr = addDays(todayStr, maxDaysAhead);
  const [pickupDate, setPickupDate] = useState(todayStr);

  // Each time checkout opens, start on the next day the restaurant is open and taking orders
  useEffect(() => {
    if (!isOpen || !settings) return;
    setPickupDate(
      nextOrderableDate(getWeeklySchedule(settings), {
        holidays: settings.holidays,
        maxDaysAhead,
        cutoffMinutes: settings.orderCutoffMinutesBeforeClose,
        minPrepMinutes: settings.minPrepTimeMinutes,
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  const [pickupTime, setPickupTime] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType | null>(null); // customer must choose
  const [floorNumber, setFloorNumber] = useState<FloorNumber>(11);
  const [specialInstructions, setSpecialInstructions] = useState('');

  // Available slots from backend
  const [slots, setSlots] = useState<PickupSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const allowedFloors = FLOORS;

  const subtotal = cart.reduce((sum, item) => sum + item.itemTotal, 0);

  // Save customer details helper
  const saveCustomerPreferences = () => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('plenty_remember_pref', String(rememberDetails));
      if (rememberDetails) {
        localStorage.setItem('plenty_saved_email', email.trim());
        localStorage.setItem(
          'plenty_saved_customer_info',
          JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            phoneNumber: phoneNumber.trim(),
            floorNumber,
            serviceType,
          })
        );
        setHasRememberedEmail(true);
      } else {
        localStorage.removeItem('plenty_saved_email');
        localStorage.removeItem('plenty_saved_customer_info');
        setHasRememberedEmail(false);
      }
    } catch (e) {}
  };

  // Fetch slots whenever pickupDate changes
  useEffect(() => {
    if (!isOpen) return;
    setSlotsLoading(true);
    setSlotError(null);

    fetch(`/api/pickup-slots?date=${pickupDate}`)
      .then((res) => res.json())
      .then((data) => {
        setSlotsLoading(false);
        if (data.success) {
          if (data.orderingDisabled) {
            setSlotError(data.reason || 'Ordering is unavailable for this date.');
            setSlots([]);
          } else {
            setSlots(data.slots || []);
            // If currently selected time is not in available slots, select first available
            const firstAvailable = (data.slots || []).find((s: PickupSlot) => s.isAvailable);
            if (firstAvailable) {
              setPickupTime(firstAvailable.startTime);
            } else {
              setPickupTime('');
            }
          }
        } else {
          setSlotError(data.error || 'Failed to fetch slots.');
        }
      })
      .catch((err) => {
        setSlotsLoading(false);
        setSlotError('Error connecting to scheduling service.');
      });
  }, [pickupDate, isOpen]);

  if (!isOpen) return null;

  // Validation
  const isCustomerValid =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    isApprovedCompanyEmail(email) &&
    !!normalizeEthiopianMobile(phoneNumber);

  // Flag the phone only once enough digits are typed
  const showPhoneError = phoneNumber.replace(/\D/g, '').length >= 9 && !normalizeEthiopianMobile(phoneNumber);

  // Only flag the email once it looks complete, so typing isn't interrupted
  const showEmailError = email.trim().length > 0 && email.includes('@') && !isApprovedCompanyEmail(email);

  const isPickupValid =
    pickupDate &&
    pickupTime &&
    !!serviceType &&
    (serviceType === 'dine_in' || allowedFloors.includes(floorNumber));

  const handleProceedToPayment = async () => {
    saveCustomerPreferences();
    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      const payload = {
        customer: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phoneNumber: phoneNumber.trim(),
        },
        pickup: {
          pickupDate,
          pickupTime,
          serviceType,
          ...(serviceType === 'delivery' ? { floorNumber } : {}),
          specialInstructions: specialInstructions.trim(),
        },
        items: cart.map((item) => ({
          menuItemId: item.menuItem.id,
          name: item.menuItem.name,
          unitPrice: item.menuItem.price,
          quantity: item.quantity,
          selectedToppings: item.selectedToppings,
          specialNotes: item.specialNotes,
        })),
      };

      const res = await fetch('/api/payment/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setIsSubmitting(false);

      if (data.success && data.txRef && data.checkoutUrl) {
        onPaymentInitiated(data.txRef, data.checkoutUrl);
      } else {
        setSubmissionError(data.error || 'Failed to initiate Chapa payment. Please try again.');
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setSubmissionError(err.message || 'Network error initiating checkout.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 my-8">
        {/* Header */}
        <div className="bg-ink text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-white/70 hover:text-white p-1 rounded-full hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
            <span>Plenty Pre-Order Checkout</span>
            <span>•</span>
            <span>Step {currentStep} of 3</span>
          </div>

          <h3 className="font-serif text-2xl font-bold mt-1 text-white">
            {currentStep === 1 && '1. Contact & Customer Details'}
            {currentStep === 2 && '2. When & How'}
            {currentStep === 3 && '3. Order Summary & Payment'}
          </h3>

          {/* Stepper Progress Bar */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 1 ? 'bg-accent' : 'bg-white/20'}`} />
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 2 ? 'bg-accent' : 'bg-white/20'}`} />
            <div className={`h-1.5 rounded-full transition-all ${currentStep >= 3 ? 'bg-accent' : 'bg-white/20'}`} />
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 sm:p-8 space-y-6 max-h-[65vh] overflow-y-auto">
          {submissionError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{submissionError}</span>
            </div>
          )}

          {/* STEP 1: CUSTOMER DETAILS */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    First Name *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Bethlehem"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Last Name *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Tadesse"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Approved Company Email Address *
                  </label>
                  {hasRememberedEmail && !showEmailError && (
                    <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Remembered on this device
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    placeholder={`name@${APPROVED_EMAIL_DOMAINS[0]}`}
                    value={email}
                    aria-invalid={showEmailError}
                    aria-describedby="checkout-email-help"
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (hasRememberedEmail) setHasRememberedEmail(false);
                    }}
                    className={`w-full pl-9 pr-3 py-2.5 bg-slate-50 border rounded-xl text-sm focus:outline-none focus:ring-2 ${
                      showEmailError ? 'border-red-400 focus:ring-red-300' : 'border-slate-200 focus:ring-accent'
                    }`}
                  />
                </div>
                {showEmailError ? (
                  <p id="checkout-email-help" role="alert" className="text-[12px] text-red-600 mt-1">
                    {APPROVED_EMAIL_HINT} Ordering is only open to company staff.
                  </p>
                ) : (
                  <p id="checkout-email-help" className="text-[11px] text-slate-400 mt-1">
                    {APPROVED_EMAIL_HINT} Receipts and pickup updates are sent here.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Phone Number (Ethiopian Mobile) *
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    required
                    placeholder="0911 234 567"
                    aria-invalid={showPhoneError}
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
                <p className={`text-[11px] mt-1 ${showPhoneError ? 'text-red-600' : 'text-slate-400'}`}>
                  {showPhoneError ? PHONE_HINT : 'Used by Chapa for telebirr and CBE Birr payments.'}
                </p>
              </div>

              {/* Remember Email & Contact Details Checkbox */}
              <div className="pt-2">
                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100/70 transition-colors">
                  <input
                    type="checkbox"
                    checked={rememberDetails}
                    onChange={(e) => {
                      setRememberDetails(e.target.checked);
                      if (!e.target.checked) {
                        try {
                          localStorage.removeItem('plenty_saved_email');
                          localStorage.removeItem('plenty_saved_customer_info');
                          localStorage.setItem('plenty_remember_pref', 'false');
                          setHasRememberedEmail(false);
                        } catch (err) {}
                      }
                    }}
                    className="w-4 h-4 mt-0.5 rounded text-accent focus:ring-accent accent-accent"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-800">
                      Remember my email & contact details
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Save this email address ({email || 'your email'}) and phone number on this device so you don't have to retype them for future pre-orders.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* STEP 2: PICKUP SCHEDULING & FLOOR */}
          {currentStep === 2 && (
            <div className="space-y-5">
              {/* Pickup Date */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Select Date *
                </label>
                <div className="relative">
                  <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="date"
                    min={todayStr}
                    max={lastDateStr}
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>

              {/* Time Slots with Realtime Capacity */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Select Time *
                  </label>
                  {slotsLoading && (
                    <span className="text-[11px] text-accent flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking capacity...
                    </span>
                  )}
                </div>

                {slotError ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
                    {slotError}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto p-1 border border-slate-100 rounded-xl">
                    {slots.map((slot) => {
                      const isSelected = pickupTime === slot.startTime;
                      const remaining = Math.max(0, slot.maxCapacity - slot.currentCapacity);
                      return (
                        <button
                          key={slot.slotId}
                          type="button"
                          disabled={!slot.isAvailable}
                          onClick={() => setPickupTime(slot.startTime)}
                          className={`p-2.5 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'border-accent bg-accent text-white shadow'
                              : slot.isAvailable
                              ? 'border-slate-200 hover:border-accent bg-slate-50 text-slate-800'
                              : 'border-slate-100 bg-slate-100/60 text-slate-400 cursor-not-allowed opacity-60'
                          }`}
                        >
                          <div className="font-mono font-bold text-xs">{slot.startTime}</div>
                          <div className="text-[10px] mt-0.5">
                            {slot.isAvailable ? (
                              <span className={isSelected ? 'text-white/80' : 'text-emerald-600 font-semibold'}>
                                {remaining} spot{remaining > 1 ? 's' : ''} left
                              </span>
                            ) : (
                              <span className="text-red-500 font-medium">Fully booked</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Delivery or dine-in */}
              <div>
                <span id="service-type-label" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  How would you like your food? *
                </span>
                <div role="radiogroup" aria-labelledby="service-type-label" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {([
                    { value: 'delivery', title: 'Delivery', body: 'We bring it to your floor', Icon: Truck },
                    { value: 'dine_in', title: 'Eat at the restaurant', body: 'Your table is ready at your time', Icon: UtensilsCrossed },
                  ] as const).map(({ value, title, body, Icon }) => {
                    const selected = serviceType === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setServiceType(value)}
                        className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all ${
                          selected ? 'border-accent bg-ink text-white shadow-md' : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${selected ? 'text-accent' : 'text-slate-500'}`} />
                        <span>
                          <span className="block font-bold text-sm">{title}</span>
                          <span className={`block text-[12px] mt-0.5 ${selected ? 'text-white/70' : 'text-slate-500'}`}>{body}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Floor Selection (delivery only) */}
              {serviceType === 'delivery' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Deliver to floor *
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {allowedFloors.map((floor) => (
                    <button
                      key={floor}
                      type="button"
                      onClick={() => setFloorNumber(floor)}
                      className={`py-3 rounded-xl border font-bold text-sm transition-all flex flex-col items-center justify-center gap-1 ${
                        floorNumber === floor
                          ? 'border-accent bg-ink text-white shadow-md'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Building className="w-3.5 h-3.5 opacity-70" />
                      <span>Floor {floor}</span>
                    </button>
                  ))}
                </div>
              </div>
              )}

              {/* Special Instructions */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Dietary Preferences / Special Instructions (Optional)
                </label>
                <textarea
                  rows={2}
                  value={specialInstructions}
                  onChange={(e) => setSpecialInstructions(e.target.value)}
                  placeholder={serviceType === 'dine_in' ? 'e.g. Fasting preparation, table for 2...' : 'e.g. Fasting preparation, leave at reception desk...'}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>
          )}

          {/* STEP 3: ORDER REVIEW & PAYMENT INITIATION */}
          {currentStep === 3 && (
            <div className="space-y-5">
              {/* Pickup & Contact Summary Card */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 text-xs space-y-2">
                <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px] border-b border-slate-200 pb-1 flex justify-between">
                  <span>When &amp; How</span>
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="text-accent hover:underline normal-case font-normal"
                  >
                    Edit
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-600">
                  <div>
                    <span className="text-slate-400 block text-[10px]">CUSTOMER</span>
                    <span className="font-medium text-slate-800">{firstName} {lastName}</span>
                    <div className="text-slate-500">{email}</div>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">SCHEDULED FOR</span>
                    <span className="font-medium text-slate-800">{pickupDate} at {pickupTime}</span>
                                        <div className="font-semibold text-accent">
                      {serviceType === 'dine_in' ? 'Dine-in at the restaurant' : `Delivery to floor ${floorNumber}`}
                    </div>
                  </div>
                </div>
              </div>

              {/* Itemized Cart List */}
              <div className="border border-slate-200 rounded-2xl p-4 space-y-2.5 text-xs max-h-40 overflow-y-auto">
                <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px] pb-1 border-b border-slate-100">
                  Itemized Order ({cart.length} item{cart.length > 1 ? 's' : ''})
                </div>
                {cart.map((item) => (
                  <div key={item.cartItemId} className="flex justify-between items-start py-1">
                    <div>
                      <span className="font-semibold text-slate-800">{item.quantity}x {item.menuItem.name}</span>
                      {item.selectedToppings.length > 0 && (
                        <div className="text-[10px] text-slate-500">
                          {item.selectedToppings
                            .map((t) => `${t.quantity && t.quantity > 1 ? `${t.quantity}x ` : ''}${t.name}`)
                            .join(', ')}
                        </div>
                      )}
                    </div>
                    <span className="font-mono font-bold text-slate-800">
                      {item.itemTotal.toLocaleString()} ETB
                    </span>
                  </div>
                ))}
              </div>

              {/* Financial Totals in ETB */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-2">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-mono font-bold text-slate-800">{subtotal.toLocaleString()} ETB</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>VAT & Service Charges</span>
                  <span>Included</span>
                </div>
                <div className="flex justify-between text-base font-bold text-ink pt-2 border-t border-amber-500/30">
                  <span>Total Amount Payable</span>
                  <span className="font-mono text-xl text-accent">{subtotal.toLocaleString()} ETB</span>
                </div>
              </div>

              {/* Payment Gateway Notice */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-start gap-3 text-xs text-slate-600">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-slate-800 block">Chapa Secure Online Payment</strong>
                  All transactions are verified through the official Chapa payment gateway in Ethiopian Birr (ETB).
                  Supports <strong>Telebirr</strong>, <strong>CBE Birr</strong>, and cards.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          {currentStep > 1 ? (
            <button
              onClick={() => setCurrentStep((currentStep - 1) as any)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-slate-200/60 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          ) : (
            <button
              onClick={onClose}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-2"
            >
              Cancel
            </button>
          )}

          {currentStep === 1 && (
            <button
              disabled={!isCustomerValid}
              onClick={() => {
                saveCustomerPreferences();
                setCurrentStep(2);
              }}
              className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-bold text-xs px-6 py-3 rounded-xl shadow transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>Continue to Pickup Details</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {currentStep === 2 && (
            <button
              disabled={!isPickupValid || !!slotError}
              onClick={() => setCurrentStep(3)}
              className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-bold text-xs px-6 py-3 rounded-xl shadow transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>Review Order</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {currentStep === 3 && (
            <button
              disabled={isSubmitting}
              onClick={handleProceedToPayment}
              className="bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-bold text-xs px-7 py-3.5 rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer active:scale-95"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Connecting to Chapa...</span>
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  <span>Pay {subtotal.toLocaleString()} ETB Online</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
