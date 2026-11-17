/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  Download,
  Shield,
  DollarSign,
  AlertTriangle,
  RotateCcw,
  Users,
  Settings,
  FileText,
  Building,
  UtensilsCrossed,
  Eye,
  Calendar,
  Check,
  Send,
  Loader2,
  RefreshCw,
  ExternalLink,
  KeyRound,
  LogOut,
  BookOpen,
} from 'lucide-react';
import { PlentyLogo } from './Header.tsx';
import {
  Order,
  Payment,
  RestaurantSettings,
  AdminUser,
  AuditLog,
  NotificationLog,
  AdminRole,
  OrderStatus,
  DashboardMetrics,
} from '../types.ts';
import { soundAlert } from '../utils/audioAlert.ts';
import { StaffUser } from '../staff/types.ts';
import { serviceLong, serviceOf } from '../utils/service.ts';
import { optimistic, showToast } from '../utils/optimistic.ts';
import { MenuManager } from '../staff/MenuManager.tsx';
import { StaffUsersPanel } from '../staff/StaffUsersPanel.tsx';
import { OpeningHoursCard } from '../staff/OpeningHoursCard.tsx';
import { EmailSettingsCard } from '../staff/EmailSettingsCard.tsx';
import { TeamsSettingsCard } from '../staff/TeamsSettingsCard.tsx';

interface AdminPortalProps {
  /** The signed-in staff member; their role is also enforced on the server. */
  currentUser: StaffUser;
  onSignOut: () => void;
  onChangePassword: () => void;
}

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Owner',
  restaurant_admin: 'Manager',
  reporting: 'Viewer',
};

export const AdminPortal: React.FC<AdminPortalProps> = ({ currentUser, onSignOut, onChangePassword }) => {
  const [activeTab, setActiveTab] = useState<
    'orders' | 'menu' | 'capacity' | 'payments' | 'reports' | 'users' | 'audit' | 'settings'
  >('orders');

  // Live Data States
  const [orders, setOrders] = useState<Order[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const savedSettingsRef = useRef<RestaurantSettings | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);
  const [reportsData, setReportsData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Sound settings state
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.8);
  const [activeAlertCount, setActiveAlertCount] = useState(0);

  // Filter states for orders tab
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Selected Order for Modal action
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [acceptPrepMinutes, setAcceptPrepMinutes] = useState<number>(30);
  const [customPrepMinutes, setCustomPrepMinutes] = useState<string>('');
  const [declineReason, setDeclineReason] = useState<string>('');
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Refund modal state
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundOrderTarget, setRefundOrderTarget] = useState<Order | null>(null);
  const [refundReason, setRefundReason] = useState('Customer cancellation approved');
  const [refundAmount, setRefundAmount] = useState<string>('');

  // Fetch all initial data
  const refreshAllData = async () => {
    setLoading(true);
    try {
      const [ordRes, metRes, setRes, usrRes, repRes, audRes, notRes, altRes] = await Promise.all([
        fetch('/api/orders').then((r) => r.json()),
        fetch('/api/admin/metrics').then((r) => r.json()),
        fetch('/api/settings').then((r) => r.json()),
        fetch('/api/admin/users').then((r) => r.json()),
        fetch('/api/admin/reports').then((r) => r.json()),
        fetch('/api/admin/audit-logs').then((r) => r.json()),
        fetch('/api/admin/notifications').then((r) => r.json()),
        fetch('/api/admin/alerts').then((r) => r.json()),
      ]);

      if (ordRes.success) setOrders(ordRes.orders);
      if (metRes.success) setMetrics(metRes.metrics);
      if (setRes.success) {
        setSettings(setRes.settings);
        savedSettingsRef.current = setRes.settings;
      }
      if (usrRes.success) setAdminUsers(usrRes.users);
      if (repRes.success) setReportsData(repRes);
      if (audRes.success) setAuditLogs(audRes.logs);
      if (notRes.success) setNotificationLogs(notRes.notifications);

      // Evaluate active continuous sound alerts
      if (altRes.success) {
        setActiveAlertCount(altRes.count);
        if (altRes.hasActiveAlert) {
          soundAlert.startContinuousAlert();
        } else {
          soundAlert.stopContinuousAlert();
        }
      }
    } catch (e) {
      console.error('Failed to load admin data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAllData();

    // Sound settings sync from manager
    const soundConf = soundAlert.getSettings();
    setSoundEnabled(soundConf.enabled);
    setSoundVolume(soundConf.volume);

    // Every 5 seconds: refresh the alert sound AND the order list + dashboard numbers, so new
    // orders and status changes show up without reloading the page.
    let polling = false;
    const poll = async () => {
      if (polling) return; // skip if the previous check is still running (slow network)
      polling = true;
      try {
        const [altRes, ordRes, metRes] = await Promise.all([
          fetch('/api/admin/alerts').then((r) => r.json()),
          fetch('/api/orders').then((r) => r.json()),
          fetch('/api/admin/metrics').then((r) => r.json()),
        ]);
        if (ordRes.success) {
          setOrders(ordRes.orders);
          // Keep an open order's details current too (e.g. another staff member accepted it)
          setSelectedOrder((cur) => (cur ? ordRes.orders.find((o: Order) => o.id === cur.id) ?? cur : cur));
        }
        if (metRes.success) setMetrics(metRes.metrics);
        if (altRes.success) {
          setActiveAlertCount(altRes.count);
          if (altRes.hasActiveAlert) {
            soundAlert.startContinuousAlert();
          } else {
            soundAlert.stopContinuousAlert();
          }
        }
      } catch (e) {
        // Network blip: try again on the next tick
      } finally {
        polling = false;
      }
    };
    const interval = setInterval(poll, 5000);
    // Catch up immediately when staff come back to the tab
    const onVisible = () => document.visibilityState === 'visible' && poll();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      soundAlert.stopContinuousAlert();
    };
  }, []);

  // Update sound controls
  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundAlert.setEnabled(next);
  };

  const handleVolumeChange = (vol: number) => {
    setSoundVolume(vol);
    soundAlert.setVolume(vol);
  };

  const handleTestSound = () => {
    soundAlert.testSound();
  };

  // Role permissions helpers
  const canModifyOrders = currentUser.role === 'super_admin' || currentUser.role === 'restaurant_admin';
  const canManageSettings = currentUser.role === 'super_admin';
  const canManageUsers = currentUser.role === 'super_admin';
  const canExecuteRefunds = currentUser.role === 'super_admin';

  // Handle Accept Order
  const handleAcceptOrder = async () => {
    if (!selectedOrder) return;
    setActionLoading(true);

    const minutes = customPrepMinutes ? parseInt(customPrepMinutes, 10) : acceptPrepMinutes;

    try {
      const res = await fetch(`/api/orders/${selectedOrder.id}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prepTimeMinutes: minutes }),
      });

      const data = await res.json();
      setActionLoading(false);

      if (data.success) {
        setShowAcceptModal(false);
        setSelectedOrder(null);
        refreshAllData();
      } else {
        alert(data.error || 'Failed to accept order.');
      }
    } catch (err: any) {
      setActionLoading(false);
      alert('Error accepting order.');
    }
  };

  // Handle Decline Order
  const handleDeclineOrder = async () => {
    if (!selectedOrder || !declineReason.trim()) {
      alert('Please provide a decline reason.');
      return;
    }
    setActionLoading(true);

    try {
      const res = await fetch(`/api/orders/${selectedOrder.id}/decline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ declineReason: declineReason.trim() }),
      });

      const data = await res.json();
      setActionLoading(false);

      if (data.success) {
        setShowDeclineModal(false);
        setSelectedOrder(null);
        setDeclineReason('');
        refreshAllData();
      } else {
        alert(data.error || 'Failed to decline order.');
      }
    } catch (err: any) {
      setActionLoading(false);
      alert('Error declining order.');
    }
  };

  // Handle Status Update (preparing -> ready -> completed)
  const handleUpdateOrderStatus = (orderId: string, newStatus: OrderStatus) => {
    const before = orders.find((o) => o.id === orderId);
    if (!before) return;
    const setStatus = (status: OrderStatus) => {
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
      setSelectedOrder((cur) => (cur && cur.id === orderId ? { ...cur, status } : cur));
    };
    optimistic<{ order: Order }>({
      apply: () => setStatus(newStatus),
      rollback: () => setStatus(before.status),
      request: () =>
        fetch(`/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        }),
      failMessage: `Couldn’t mark ${before.orderNumber} as ${newStatus}.`,
      onSuccess: (data) => {
        if (data.order) setOrders((prev) => prev.map((o) => (o.id === orderId ? data.order : o)));
        fetch('/api/admin/metrics')
          .then((r) => r.json())
          .then((m) => m.success && setMetrics(m.metrics))
          .catch(() => {});
      },
    });
  };

  /** Save some settings optimistically: show them now, put back only these keys if the save fails. */
  const saveSettings = (changes: Partial<RestaurantSettings>, label: string, okText?: string) => {
    const before: Partial<RestaurantSettings> = {};
    for (const key of Object.keys(changes) as (keyof RestaurantSettings)[]) {
      (before as any)[key] = savedSettingsRef.current?.[key];
    }
    return optimistic<{ settings: RestaurantSettings }>({
      apply: () => {
        setSettings((cur) => (cur ? { ...cur, ...changes } : cur));
        if (okText) showToast(okText, 'ok');
      },
      rollback: () => setSettings((cur) => (cur ? { ...cur, ...before } : cur)),
      request: () =>
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changes), // only what changed, not the whole settings object
        }),
      failMessage: `Couldn’t save ${label}.`,
      onSuccess: (data) => {
        if (data.settings) savedSettingsRef.current = data.settings;
      },
    });
  };

  // Handle Manual Refund
  const handleExecuteRefund = async () => {
    if (!refundOrderTarget) return;
    setActionLoading(true);

    try {
      const res = await fetch(`/api/orders/${refundOrderTarget.id}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refundReason,
          refundAmount: refundAmount ? parseFloat(refundAmount) : undefined,
        }),
      });

      const data = await res.json();
      setActionLoading(false);

      if (data.success) {
        setShowRefundModal(false);
        setRefundOrderTarget(null);
        refreshAllData();
      } else {
        alert(data.error || 'Failed to issue refund.');
      }
    } catch (e) {
      setActionLoading(false);
      alert('Error executing refund.');
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'Order Number',
      'Date',
      'Time',
      'Service',
      'Customer Name',
      'Email',
      'Phone',
      'Items & Extras',
      'Total Amount (ETB)',
      'Order Status',
      'Payment Status',
      'Chapa TxRef',
    ];

    const rows = orders.map((o) => {
      const itemsSummary = o.items
        .map((it) => {
          const tops = it.selectedToppings?.length
            ? ` [Extras: ${it.selectedToppings.map((t) => `${t.quantity && t.quantity > 1 ? `${t.quantity}x ` : ''}${t.name}`).join(', ')}]`
            : '';
          return `${it.quantity}x ${it.name}${tops}`;
        })
        .join('; ');

      return [
        `"${o.orderNumber}"`,
        `"${o.pickup.pickupDate}"`,
        `"${o.pickup.pickupTime}"`,
        `"${serviceLong(o.pickup)}"`,
        `"${o.customer.firstName} ${o.customer.lastName}"`,
        `"${o.customer.email}"`,
        `"${o.customer.phoneNumber}"`,
        `"${itemsSummary.replace(/"/g, '""')}"`,
        o.totalAmount,
        `"${o.status}"`,
        `"${o.paymentStatus}"`,
        `"${o.paymentId}"`,
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Plenty_Orders_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered orders list
  const filteredOrders = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (paymentFilter !== 'all' && o.paymentStatus !== paymentFilter) return false;
    if (floorFilter === 'dine_in' && serviceOf(o.pickup) !== 'dine_in') return false;
    if (floorFilter !== 'all' && floorFilter !== 'dine_in' && String(o.pickup.floorNumber) !== floorFilter) return false;
    if (dateFilter && o.pickup.pickupDate !== dateFilter) return false;
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase().trim();
      const matchOrder = o.orderNumber.toLowerCase().includes(q);
      const matchName = `${o.customer.firstName} ${o.customer.lastName}`.toLowerCase().includes(q);
      const matchEmail = o.customer.email.toLowerCase().includes(q);
      const matchPhone = o.customer.phoneNumber.includes(q);
      return matchOrder || matchName || matchEmail || matchPhone;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-slate-800">
      {/* Top Bar: Brand, signed-in user, Sound Alert Controls */}
      <div className="bg-ink text-white border-b border-white/10 px-4 sm:px-6 lg:px-8 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <PlentyLogo className="h-14" />
            <div className="border-l border-white/15 pl-3">
              <h1 className="sr-only">Plenty staff portal</h1>
              <p className="text-sm text-white/60">Staff portal</p>
            </div>
          </div>

          {/* Sound Notification Alert Controller */}
          <div className="flex flex-wrap items-center gap-3 bg-white/5 border border-white/10 p-2 rounded-2xl">
            <button
              onClick={handleToggleSound}
              className={`p-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                soundEnabled ? 'bg-emerald-600 text-white' : 'bg-white/10 text-white/60'
              }`}
              title={soundEnabled ? 'Sound alert enabled' : 'Sound alert disabled'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span className="hidden sm:inline">{soundEnabled ? 'Sound Alerts ON' : 'Muted'}</span>
            </button>

            {/* Volume slider */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-white/70">
              <span className="text-[10px]">Vol</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={soundVolume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-16 h-1 bg-white/20 rounded-lg accent-accent cursor-pointer"
              />
            </div>

            <button
              onClick={handleTestSound}
              className="text-xs bg-white/10 hover:bg-white/20 text-white px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
              title="Test notification tone"
            >
              <Play className="w-3 h-3 text-accent" />
              <span className="hidden sm:inline">Test Alert</span>
            </button>

            {/* Signed-in staff member */}
            <div className="flex items-center gap-3 pl-3 border-l border-white/20">
              <div className="text-right leading-tight">
                <div className="text-sm font-semibold">{currentUser.name}</div>
                <div className="text-[11px] text-white/50">{ROLE_LABELS[currentUser.role]}</div>
              </div>
              <button
                onClick={onChangePassword}
                className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                title="Change password"
                aria-label="Change password"
              >
                <KeyRound className="w-4 h-4" />
              </button>
              <button
                onClick={onSignOut}
                className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CONTINUOUS AUDIO ALERT BANNER (High Visibility) */}
      {activeAlertCount > 0 && (
        <div className="bg-red-600 text-white px-4 py-3 shadow-lg flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white text-red-600 rounded-full">
              <Bell className="w-5 h-5 animate-bounce" />
            </div>
            <div>
              <div className="font-bold text-sm">
                🚨 {activeAlertCount} UNHANDLED PAID ORDER{activeAlertCount > 1 ? 'S' : ''} AWAITING ACCEPTANCE!
              </div>
              <div className="text-xs text-white/90">
                Continuous audio alert is active until order is accepted or declined. Each order maintains its notification state.
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setActiveTab('orders');
              setStatusFilter('pending');
            }}
            className="bg-white text-red-600 font-bold text-xs px-4 py-2 rounded-xl shadow hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Review Orders Now
          </button>
        </div>
      )}

      {/* Admin Portal Navigation Tabs */}
      <div className="bg-white border-b border-slate-200 shadow-xs px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between overflow-x-auto">
          <div className="flex space-x-1 sm:space-x-4 py-2">
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'orders'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <UtensilsCrossed className="w-4 h-4" />
              <span>Live Orders</span>
              {activeAlertCount > 0 && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full">
                  {activeAlertCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('menu')}
              className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'menu'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Menu</span>
            </button>

            <button
              onClick={() => setActiveTab('capacity')}
              className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'capacity'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Hours &amp; capacity</span>
            </button>

            <button
              onClick={() => setActiveTab('payments')}
              className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'payments'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <DollarSign className="w-4 h-4" />
              <span>Payments & Chapa</span>
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'reports'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Reports & Analytics</span>
            </button>

            {canManageUsers && (
              <button
                onClick={() => setActiveTab('users')}
                className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === 'users'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Staff accounts</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'audit'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Audit Logs</span>
            </button>

            {canManageSettings && (
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </button>
            )}
          </div>

          <button
            onClick={refreshAllData}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100"
            title="Refresh All Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* METRICS DASHBOARD SUMMARY CARDS */}
        {metrics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Today's Orders
              </span>
              <span className="font-mono text-2xl font-black text-slate-900 mt-1 block">
                {metrics.totalOrdersToday}
              </span>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Revenue Today (ETB)
              </span>
              <span className="font-mono text-2xl font-black text-emerald-600 mt-1 block">
                {metrics.totalRevenueTodayETB.toLocaleString()}
              </span>
            </div>

            <div className={`rounded-2xl p-4 shadow-xs border transition-all ${
              metrics.pendingOrdersCount > 0
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-white border-slate-200'
            }`}>
              <span className="text-[11px] font-bold uppercase tracking-wider block">
                Pending Review
              </span>
              <span className="font-mono text-2xl font-black mt-1 block text-amber-700">
                {metrics.pendingOrdersCount}
              </span>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Accepted / In Prep
              </span>
              <span className="font-mono text-2xl font-black text-blue-600 mt-1 block">
                {metrics.acceptedOrdersCount}
              </span>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Refunded Orders
              </span>
              <span className="font-mono text-2xl font-black text-slate-700 mt-1 block">
                {metrics.refundedOrdersCount}
              </span>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Completed
              </span>
              <span className="font-mono text-2xl font-black text-slate-500 mt-1 block">
                {metrics.completedOrdersCount}
              </span>
            </div>
          </div>
        )}

        {/* MENU: add, edit, delete and stock dishes */}
        {activeTab === 'menu' && <MenuManager canEdit={canModifyOrders} />}

        {/* TAB 1: LIVE ORDERS QUEUE */}
        {activeTab === 'orders' && (
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden space-y-4 p-5">
            {/* Filter Bar */}
            <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
              <div className="flex-1 flex flex-wrap gap-2 items-center">
                <div className="relative min-w-[220px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search order #, customer, phone..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-accent"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold"
                >
                  <option value="all">All Order Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="accepted">Accepted</option>
                  <option value="preparing">Preparing</option>
                  <option value="ready">Ready for Pickup</option>
                  <option value="completed">Completed</option>
                  <option value="declined">Declined</option>
                  <option value="cancelled">Cancelled</option>
                </select>

                <select
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold"
                >
                  <option value="all">All Payment Statuses</option>
                  <option value="successful">Successful</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                  <option value="refunded">Refunded</option>
                </select>

                <select
                  value={floorFilter}
                  onChange={(e) => setFloorFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold"
                >
                  <option value="all">All Floors</option>
                  <option value="2">Floor 2</option>
                  <option value="8">Floor 8</option>
                  <option value="10">Floor 10</option>
                  <option value="11">Floor 11</option>
                  <option value="12">Floor 12</option>
                  <option value="13">Floor 13</option>
                  <option value="dine_in">Dine-in</option>
                </select>

                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs"
                />
                {dateFilter && (
                  <button
                    onClick={() => setDateFilter('')}
                    className="text-xs text-slate-400 hover:text-slate-600 underline"
                  >
                    Clear date
                  </button>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Export Orders (CSV/Excel)
                </button>
              </div>
            </div>

            {/* Orders Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-bold">
                    <th className="p-3">Order Number</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Items & Extras</th>
                    <th className="p-3">Pickup Slot & Floor</th>
                    <th className="p-3">Amount (ETB)</th>
                    <th className="p-3">Payment</th>
                    <th className="p-3">Order Status</th>
                    <th className="p-3">Prep Estimate</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400">
                        No orders match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((ord) => (
                      <tr
                        key={ord.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          ord.status === 'pending' ? 'bg-amber-50/40' : ''
                        }`}
                      >
                        <td className="p-3">
                          <span className="font-mono font-bold text-ink">{ord.orderNumber}</span>
                          <div className="text-[10px] text-slate-400">
                            {new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>

                        <td className="p-3">
                          <div className="font-semibold text-slate-800">
                            {ord.customer.firstName} {ord.customer.lastName}
                          </div>
                          <div className="text-[11px] text-slate-500">{ord.customer.email}</div>
                          <div className="text-[10px] text-slate-400">{ord.customer.phoneNumber}</div>
                        </td>

                        {/* Items & Extras column */}
                        <td className="p-3 max-w-xs">
                          <div className="space-y-1">
                            {ord.items.map((it, idx) => (
                              <div key={idx} className="text-xs">
                                <span className="font-semibold text-slate-800">
                                  {it.quantity}x {it.name}
                                </span>
                                {it.selectedToppings && it.selectedToppings.length > 0 && (
                                  <div className="text-[10px] text-accent font-medium flex flex-wrap gap-1 mt-0.5">
                                    {it.selectedToppings.map((t, ti) => (
                                      <span key={ti} className="bg-orange-50 px-1.5 py-0.2 rounded border border-orange-200">
                                        +{t.quantity && t.quantity > 1 ? `${t.quantity}x ` : ''}{t.name}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>

                        <td className="p-3">
                          <div className="font-medium text-slate-800">
                            {ord.pickup.pickupDate} • {ord.pickup.pickupTime}
                          </div>
                          <div
                            className={`font-bold text-xs ${serviceOf(ord.pickup) === 'dine_in' ? 'text-emerald-700' : 'text-accent'}`}
                          >
                            {serviceOf(ord.pickup) === 'dine_in' ? 'Dine-in' : `Delivery · Floor ${ord.pickup.floorNumber}`}
                          </div>
                          {ord.pickup.specialInstructions && (
                            <div className="text-[10px] text-amber-800 truncate max-w-xs italic">
                              "{ord.pickup.specialInstructions}"
                            </div>
                          )}
                        </td>

                        <td className="p-3 font-mono font-bold text-slate-900">
                          {ord.totalAmount.toLocaleString()} ETB
                        </td>

                        <td className="p-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              ord.paymentStatus === 'successful'
                                ? 'bg-emerald-100 text-emerald-800'
                                : ord.paymentStatus === 'refunded'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {ord.paymentStatus.toUpperCase()} (Chapa)
                          </span>
                        </td>

                        <td className="p-3">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${
                              ord.status === 'pending'
                                ? 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
                                : ord.status === 'accepted'
                                ? 'bg-blue-100 text-blue-800'
                                : ord.status === 'preparing'
                                ? 'bg-purple-100 text-purple-800'
                                : ord.status === 'ready'
                                ? 'bg-emerald-100 text-emerald-800 font-extrabold'
                                : ord.status === 'declined'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {ord.status.toUpperCase()}
                          </span>
                        </td>

                        <td className="p-3 text-xs">
                          {ord.estimatedPrepMinutes ? (
                            <div>
                              <span className="font-bold text-emerald-700">{ord.estimatedPrepMinutes} mins</span>
                              <div className="text-[10px] text-slate-500">Ready ~{ord.estimatedReadyTime}</div>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">—</span>
                          )}
                        </td>

                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* PENDING ACTIONS: ACCEPT OR DECLINE */}
                            {ord.status === 'pending' && canModifyOrders && (
                              <>
                                <button
                                  onClick={() => {
                                    setSelectedOrder(ord);
                                    setShowAcceptModal(true);
                                  }}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 transition-all cursor-pointer shadow-xs"
                                >
                                  <Check className="w-3.5 h-3.5" /> Accept
                                </button>

                                <button
                                  onClick={() => {
                                    setSelectedOrder(ord);
                                    setShowDeclineModal(true);
                                  }}
                                  className="bg-red-600 hover:bg-red-700 text-white font-bold px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1 transition-all cursor-pointer shadow-xs"
                                >
                                  <XCircle className="w-3.5 h-3.5" /> Decline
                                </button>
                              </>
                            )}

                            {/* ACCEPTED / PREPARING ACTIONS */}
                            {ord.status === 'accepted' && canModifyOrders && (
                              <button
                                onClick={() => handleUpdateOrderStatus(ord.id, 'preparing')}
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-2.5 py-1 rounded-lg text-xs"
                              >
                                Start Prep
                              </button>
                            )}

                            {ord.status === 'preparing' && canModifyOrders && (
                              <button
                                onClick={() => handleUpdateOrderStatus(ord.id, 'ready')}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2.5 py-1 rounded-lg text-xs"
                              >
                                Mark Ready
                              </button>
                            )}

                            {ord.status === 'ready' && canModifyOrders && (
                              <button
                                onClick={() => handleUpdateOrderStatus(ord.id, 'completed')}
                                className="bg-slate-700 hover:bg-slate-900 text-white font-bold px-2.5 py-1 rounded-lg text-xs"
                              >
                                Mark Picked Up
                              </button>
                            )}

                            {/* SUPER ADMIN REFUND BUTTON */}
                            {canExecuteRefunds && ord.paymentStatus === 'successful' && (
                              <button
                                onClick={() => {
                                  setRefundOrderTarget(ord);
                                  setRefundAmount(String(ord.totalAmount));
                                  setShowRefundModal(true);
                                }}
                                className="text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 p-1.5 rounded-lg text-[11px] font-bold border border-purple-200"
                                title="Issue Authorized Refund"
                              >
                                Refund
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: KITCHEN CAPACITY & SCHEDULING */}
        {activeTab === 'capacity' && settings && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Weekly opening hours: drives pickup times, the homepage and the footer */}
            <div className="lg:col-span-2">
              <OpeningHoursCard settings={settings} canEdit={canModifyOrders} onSaved={setSettings} />
            </div>

            {/* Storefront Emergency Pause & Operating Hours */}
            <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="font-serif font-bold text-lg text-slate-900">Ordering & capacity</h3>
                  <p className="text-xs text-slate-500">Configure pickup timing and daily cutoff limits</p>
                </div>
                {canManageSettings ? (
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">
                    Configurable
                  </span>
                ) : (
                  <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded">
                    Read-Only
                  </span>
                )}
              </div>

              {/* Pause Ordering Killswitch */}
              <div className={`p-4 rounded-xl border flex items-center justify-between ${
                settings.isOrderingEnabled
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-red-50 border-red-200'
              }`}>
                <div>
                  <div className="font-bold text-sm">
                    {settings.isOrderingEnabled ? '🟢 Ordering is Live & Active' : '🔴 Ordering is Paused'}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    {settings.isOrderingEnabled
                      ? 'Customers can schedule pickups within operating hours.'
                      : settings.pauseReason || 'Paused by kitchen management.'}
                  </div>
                </div>

                {canManageSettings && (
                  <button
                    onClick={() => {
                      const newStatus = !settings.isOrderingEnabled;
                      saveSettings(
                        {
                          isOrderingEnabled: newStatus,
                          pauseReason: newStatus ? '' : 'Kitchen temporarily overloaded. Re-opening shortly.',
                        },
                        newStatus ? 'the change, so ordering is still paused.' : 'the change, so ordering is still live.'
                      );
                    }}
                    className={`font-bold text-xs px-4 py-2 rounded-xl transition-all ${
                      settings.isOrderingEnabled
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    {settings.isOrderingEnabled ? 'Pause New Orders' : 'Resume Ordering'}
                  </button>
                )}
              </div>

              {/* Parameters Grid */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Pickup Interval (Minutes)
                  </label>
                  <select
                    disabled={!canManageSettings}
                    value={settings.pickupIntervalMinutes}
                    onChange={(e) => saveSettings({ pickupIntervalMinutes: Number(e.target.value) }, 'the pickup interval')}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  >
                    <option value={15}>Every 15 Minutes</option>
                    <option value={30}>Every 30 Minutes</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Max Orders Per Interval
                  </label>
                  <SettingNumber
                    disabled={!canManageSettings}
                    value={settings.maxOrdersPerSlot}
                    onCommit={(val) => saveSettings({ maxOrdersPerSlot: val }, 'the orders-per-interval limit')}
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Daily Maximum Orders
                  </label>
                  <SettingNumber
                    disabled={!canManageSettings}
                    value={settings.maxDailyOrders}
                    onCommit={(val) => saveSettings({ maxDailyOrders: val }, 'the daily order limit')}
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Min Prep Time (Minutes)
                  </label>
                  <SettingNumber
                    disabled={!canManageSettings}
                    value={settings.minPrepTimeMinutes}
                    onCommit={(val) => saveSettings({ minPrepTimeMinutes: val }, 'the minimum prep time')}
                  />
                </div>
              </div>
            </div>

            {/* Sold-out toggles now live in the Menu tab, where they actually save */}
            <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-3">
              <h3 className="font-serif font-bold text-lg text-slate-900">Sold out of something?</h3>
              <p className="text-sm text-slate-500">
                Mark dishes sold out, change prices, or add new dishes from the Menu tab. Customers see changes
                within seconds.
              </p>
              <button
                onClick={() => setActiveTab('menu')}
                className="text-sm font-semibold text-accent hover:text-accent-dark"
              >
                Open the menu →
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: PAYMENTS & CHAPA LEDGER */}
        {activeTab === 'payments' && reportsData && (
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-serif font-bold text-lg text-slate-900">
                  Payment Ledger & Chapa Transactions
                </h3>
                <p className="text-xs text-slate-500">
                  All transactions processed in Ethiopian Birr (ETB) with transaction references
                </p>
              </div>
              <span className="text-xs font-mono font-bold bg-[#00BA77]/10 text-[#00BA77] border border-[#00BA77]/30 px-3 py-1 rounded-full">
                Gateway: Chapa
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-bold">
                    <th className="p-3">Tx Reference</th>
                    <th className="p-3">Order Number</th>
                    <th className="p-3">Customer</th>
                    <th className="p-3">Amount (ETB)</th>
                    <th className="p-3">Method</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Refund Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportsData.payments?.map((pay: Payment) => (
                    <tr key={pay.id} className="hover:bg-slate-50/80">
                      <td className="p-3 font-mono font-semibold text-slate-800 text-[11px]">
                        {pay.txRef}
                        {pay.chapaReference && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            Ref: {pay.chapaReference}
                          </div>
                        )}
                      </td>

                      <td className="p-3 font-mono font-bold text-ink">
                        {pay.orderNumber || 'Provisional'}
                      </td>

                      <td className="p-3">
                        <div className="font-semibold text-slate-800">{pay.customerName}</div>
                        <div className="text-[10px] text-slate-400">{pay.customerEmail}</div>
                      </td>

                      <td className="p-3 font-mono font-black text-slate-900">
                        {pay.amount.toLocaleString()} ETB
                      </td>

                      <td className="p-3 font-bold uppercase text-[11px] text-slate-700">
                        {pay.paymentMethod}
                      </td>

                      <td className="p-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            pay.status === 'successful'
                              ? 'bg-emerald-100 text-emerald-800'
                              : pay.status === 'refunded'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {pay.status.toUpperCase()}
                        </span>
                      </td>

                      <td className="p-3 text-[11px] text-slate-500">
                        {new Date(pay.createdAt).toLocaleDateString()}
                      </td>

                      <td className="p-3 font-mono text-[10px] text-purple-800">
                        {pay.refundReference || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: REPORTS & ANALYTICS */}
        {activeTab === 'reports' && reportsData && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Most Popular Food Items */}
              <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-4">
                <h3 className="font-serif font-bold text-lg text-slate-900">Most Popular Dishes</h3>
                <div className="space-y-2.5 max-h-80 overflow-y-auto">
                  {reportsData.popularItems?.slice(0, 8).map((it: any, i: number) => (
                    <div
                      key={it.name}
                      className="p-3 rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-accent/10 text-accent font-bold flex items-center justify-center font-mono">
                          {i + 1}
                        </span>
                        <div>
                          <div className="font-bold text-slate-800">{it.name}</div>
                          <div className="text-[10px] text-slate-400">{it.category}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-slate-900">{it.quantity} orders</div>
                        <div className="font-mono text-[11px] text-emerald-600">{it.revenueETB.toLocaleString()} ETB</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Orders by Floor Breakdown */}
              <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-4">
                <h3 className="font-serif font-bold text-lg text-slate-900">Orders by Floor &amp; Dine-in</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[2, 8, 10, 11, 12, 13].map((f) => (
                    <div key={f} className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-center">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Floor {f}
                      </span>
                      <span className="font-mono text-2xl font-black text-accent mt-1 block">
                        {reportsData.floorCounts?.[f] || 0}
                      </span>
                      <span className="text-[10px] text-slate-500">Deliveries</span>
                    </div>
                  ))}
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200/80 text-center">
                    <span className="text-[10px] font-bold text-emerald-700/70 uppercase tracking-wider block">Dine-in</span>
                    <span className="font-mono text-2xl font-black text-emerald-700 mt-1 block">{reportsData.dineInCount || 0}</span>
                    <span className="text-[10px] text-slate-500">At the restaurant</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: ADMIN USERS (RBAC) */}
        {activeTab === 'users' && canManageUsers && <StaffUsersPanel currentUserId={currentUser.id} />}

        {/* TAB 6: AUDIT LOGS & NOTIFICATIONS */}
        {activeTab === 'audit' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Audit Logs */}
            <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-4">
              <div>
                <h3 className="font-serif font-bold text-lg text-slate-900">Administrator Audit Trail</h3>
                <p className="text-xs text-slate-500">Immutable ledger of order acceptances, declines, and refunds</p>
              </div>

              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl border border-slate-100 bg-slate-50 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">{log.action}</span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      By: <strong>{log.adminName}</strong>
                    </div>
                    {log.newValue && (
                      <div className="text-[10px] font-mono text-slate-700 bg-white p-1.5 rounded border border-slate-200">
                        {log.newValue}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Notification Dispatch Log (Teams & Customer Emails) */}
            <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 space-y-4">
              <div>
                <h3 className="font-serif font-bold text-lg text-slate-900">Dispatched Notifications</h3>
                <p className="text-xs text-slate-500">Live Microsoft Teams webhook alerts & customer email dispatches</p>
              </div>

              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {notificationLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    No notifications recorded yet.
                  </div>
                ) : (
                  notificationLogs.map((n) => (
                    <div
                      key={n.id}
                      className="p-3 rounded-xl border border-slate-100 bg-slate-50 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          {n.channel === 'teams' ? 'Microsoft Teams' : n.recipient ? `Email to ${n.recipient}` : 'Customer email'}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                            n.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-800'
                              : n.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : n.status === 'pending'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {n.status === 'skipped' ? 'not sent' : n.status}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-700 text-[11px]">{n.title}</div>
                      {n.error ? (
                        <div className={`text-[11px] ${n.status === 'failed' ? 'text-red-600' : 'text-slate-500'}`}>{n.error}</div>
                      ) : (
                        <div className="text-[10px] text-slate-500 line-clamp-2">{n.message}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Customer email connection and test */}
        {activeTab === 'settings' && canManageSettings && (
          <div className="space-y-6">
            <EmailSettingsCard defaultTo={currentUser.email} />
            <TeamsSettingsCard defaultTo={currentUser.email} />
          </div>
        )}

        {/* TAB 7: CHAPA GATEWAY SETTINGS */}
        {activeTab === 'settings' && canManageSettings && settings && (
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200 max-w-2xl space-y-6">
            <div>
              <h3 className="font-serif font-bold text-lg text-slate-900">
                Chapa Payment Gateway & Integration Settings
              </h3>
              <p className="text-xs text-slate-500">
                Manage your Chapa API keys and webhook secrets for Ethiopian Birr transactions
              </p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Chapa Secret Key (Server-side)
                </label>
                <input
                  type="password"
                  placeholder="CHASECK_TEST-xxxxxxxxxxxxxxxx"
                  defaultValue="CHASECK_TEST-xxxxxxxxxxxxxxxx"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Used for server-to-server transaction initialize and verification calls.
                </p>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Chapa Webhook Secret (HMAC Hash)
                </label>
                <input
                  type="password"
                  placeholder="chapa_webhook_secret_hash"
                  defaultValue="chapa_webhook_secret_key"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Validates incoming x-chapa-signature headers.
                </p>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Microsoft Teams Incoming Webhook URL
                </label>
                <input
                  type="url"
                  placeholder="https://outlook.office.com/webhook/..."
                  value={settings.teamsWebhookUrl || ''}
                  onChange={(e) => setSettings({ ...settings, teamsWebhookUrl: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Admin Notification Email
                </label>
                <input
                  type="email"
                  value={settings.adminNotificationEmail || ''}
                  onChange={(e) => setSettings({ ...settings, adminNotificationEmail: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs"
                />
              </div>

              <button
                onClick={() =>
                  saveSettings(
                    { teamsWebhookUrl: settings.teamsWebhookUrl || '', adminNotificationEmail: settings.adminNotificationEmail || '' },
                    'these settings',
                    'Settings saved.'
                  )
                }
                className="bg-accent hover:bg-accent-dark text-white font-bold text-xs px-6 py-2.5 rounded-xl cursor-pointer"
              >
                Save Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ACCEPT ORDER MODAL (With Estimated Prep Time Selector) */}
      {showAcceptModal && selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in">
            <div>
              <div className="text-xs text-emerald-600 font-bold uppercase tracking-wider">
                Accept Order
              </div>
              <h3 className="font-serif text-xl font-bold text-slate-900 mt-0.5">
                {selectedOrder.orderNumber}
              </h3>
              <p className="text-xs text-slate-500">
                Customer: {selectedOrder.customer.firstName} {selectedOrder.customer.lastName} • {serviceLong(selectedOrder.pickup)}
              </p>
            </div>

            {/* Order Items & Extras Preview */}
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs space-y-1.5 max-h-36 overflow-y-auto">
              <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">
                Items to Prepare:
              </div>
              {selectedOrder.items.map((it, idx) => (
                <div key={idx} className="flex justify-between items-start text-xs border-b border-slate-200/50 pb-1 last:border-0 last:pb-0">
                  <div>
                    <span className="font-semibold text-slate-800">{it.quantity}x {it.name}</span>
                    {it.selectedToppings && it.selectedToppings.length > 0 && (
                      <div className="text-[10px] text-accent font-medium">
                        Extras: {it.selectedToppings.map((t) => `${t.quantity && t.quantity > 1 ? `${t.quantity}x ` : ''}${t.name}`).join(', ')}
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-slate-700 font-bold">{it.totalPrice} ETB</span>
                </div>
              ))}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Select Estimated Preparation Time:
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[15, 30, 45, 60].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => {
                      setAcceptPrepMinutes(mins);
                      setCustomPrepMinutes('');
                    }}
                    className={`py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      acceptPrepMinutes === mins && !customPrepMinutes
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {mins}m
                  </button>
                ))}
              </div>

              <div className="mt-3">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Or Custom Minutes:
                </label>
                <input
                  type="number"
                  placeholder="e.g. 20"
                  value={customPrepMinutes}
                  onChange={(e) => setCustomPrepMinutes(e.target.value)}
                  className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600 border border-slate-200">
              ℹ️ Accepting this order will:
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-[11px]">
                <li>Stop the continuous sound alert for this ticket.</li>
                <li>Send an acceptance email to {selectedOrder.customer.email}.</li>
                <li>Dispatch a Microsoft Teams card to the staff channel.</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAcceptModal(false)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-4 py-2"
              >
                Cancel
              </button>
              <button
                disabled={actionLoading}
                onClick={handleAcceptOrder}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Confirm Acceptance</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DECLINE ORDER MODAL (Mandatory Reason & Automatic Refund) */}
      {showDeclineModal && selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div>
              <div className="text-xs text-red-600 font-bold uppercase tracking-wider">
                Decline Order & Initiate Refund
              </div>
              <h3 className="font-serif text-xl font-bold text-slate-900 mt-0.5">
                {selectedOrder.orderNumber}
              </h3>
              <p className="text-xs text-slate-500">
                Declining an already-paid order ({selectedOrder.totalAmount} ETB) requires a mandatory reason and initiates a refund.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Mandatory Decline Reason *
              </label>
              <textarea
                rows={3}
                required
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="e.g. Kitchen ingredient shortage, pickup slot capacity exceeded..."
                className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs">
              ⚠️ The customer's payment of <strong>{selectedOrder.totalAmount} ETB</strong> will be marked for refund through Chapa, and the sound alert will be dismissed.
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowDeclineModal(false)}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-4 py-2"
              >
                Cancel
              </button>
              <button
                disabled={actionLoading || !declineReason.trim()}
                onClick={handleDeclineOrder}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl cursor-pointer"
              >
                {actionLoading ? 'Processing Refund...' : 'Decline & Issue Refund'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUPER ADMIN MANUAL REFUND MODAL */}
      {showRefundModal && refundOrderTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in">
            <div className="text-xs text-purple-700 font-bold uppercase tracking-wider">
              Super Admin Authorization
            </div>
            <h3 className="font-serif text-xl font-bold text-slate-900 mt-0.5">
              Issue Refund for {refundOrderTarget.orderNumber}
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Refund Amount (ETB)
                </label>
                <input
                  type="number"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Refund Reason
                </label>
                <input
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowRefundModal(false)}
                className="text-xs font-semibold text-slate-500 px-4 py-2"
              >
                Cancel
              </button>
              <button
                disabled={actionLoading}
                onClick={handleExecuteRefund}
                className="bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs px-5 py-2.5 rounded-xl"
              >
                {actionLoading ? 'Refunding...' : 'Confirm Refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** A number setting you can type into freely; it saves when you leave the field or press Enter. */
const SettingNumber: React.FC<{ value: number; disabled?: boolean; onCommit: (value: number) => void }> = ({
  value,
  disabled,
  onCommit,
}) => {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]); // follow saves and rollbacks
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) return setText(String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      disabled={disabled}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono"
    />
  );
};
