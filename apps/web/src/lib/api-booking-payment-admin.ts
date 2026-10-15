import { ApiError, fetchApi } from './api';

/*
 * 予約のお支払い（管理画面）の、まだ Worker に無い口の形（B-305・B-315）。
 * 画面（予約設定 › お支払い・メニューごとの支払い・お支払いの記録）が先に呼ぶ。
 * 口が来るまでは 404 などで落ち、画面は「現在準備中です」を出す（B-314）。
 * 口の中身は Codex（API 組）が作る。名前と形を変えるときは画面と一緒に直す。
 */

type Result<T> = { success: true; data: T };
const q = (accountId: string, extra?: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams({ account_id: accountId });
  for (const [key, value] of Object.entries(extra ?? {})) if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
};

export type BookingPaymentMode = 'none' | 'onsite' | 'online' | 'customer_choice';

/** Stripe のつなぎの状態。鍵の値は返さない（末尾の数文字だけ）。 */
export interface StripeConnection {
  connected: boolean;
  testMode: boolean;
  accountIdTail: string | null;
  connectedAt: string | null;
  dashboardUrl: string | null;
}

/** メニュー（予約メニュー・コース・クラス）ごとの上書き。上書きの無いメニューは返さない。 */
export interface MenuPaymentOverride {
  menuId: string;
  mode: BookingPaymentMode;
}

export type PaymentRecordStatus = 'paid' | 'pending' | 'refunded' | 'expired' | 'onsite';

export interface PaymentRecord {
  id: string;
  bookingId: string | null;
  friendId: string | null;
  friendName: string | null;
  bookingStartsAt: string | null;
  bookingLabel: string | null;
  bookingNote: string | null;
  amount: number;
  status: PaymentRecordStatus;
  method: string | null;
  createdAt: string;
  receiptUrl: string | null;
}

export interface PaymentSummary {
  paidAmount: number;
  paidCount: number;
  refundedAmount: number;
  refundedCount: number;
  expiredCount: number;
  pendingCount: number;
  holdMinutes: number;
}

export interface PaymentRecordsPage {
  summary: PaymentSummary;
  items: PaymentRecord[];
  total: number;
}

export type PaymentEventResult = 'applied' | 'duplicate' | 'failed';

export interface PaymentEvent {
  id: string;
  receivedAt: string;
  kind: 'paid' | 'refunded' | 'expired' | 'other';
  amount: number | null;
  repeat: boolean;
  bookingId: string | null;
  bookingLabel: string | null;
  note: string | null;
  result: PaymentEventResult;
}

export const bookingPaymentAdminApi = {
  connection: (accountId: string) =>
    fetchApi<Result<StripeConnection>>(`/api/booking/admin/payment-connection?${q(accountId)}`),
  menuOverrides: (accountId: string) =>
    fetchApi<Result<{ menus: MenuPaymentOverride[] }>>(`/api/booking/admin/menu-payments?${q(accountId)}`),
  records: (accountId: string, filter: { q?: string; status?: string; method?: string; period?: string; limit?: number; offset?: number } = {}) =>
    fetchApi<Result<PaymentRecordsPage>>(`/api/booking/admin/payments?${q(accountId, filter)}`),
  events: (accountId: string, filter: { result?: string; period?: string; limit?: number } = {}) =>
    fetchApi<Result<{ items: PaymentEvent[]; total: number }>>(`/api/booking/admin/payment-events?${q(accountId, filter)}`),
  replayEvent: (accountId: string, id: string) =>
    fetchApi<Result<PaymentEvent>>(`/api/booking/admin/payment-events/${encodeURIComponent(id)}/replay?${q(accountId)}`, { method: 'POST', body: '{}' }),
  /** 今ある口：支払い済みの返金。 */
  refund: (paymentId: string) =>
    fetchApi<Result<{ payment: unknown }>>(`/api/booking/payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST', body: '{}' }),
  /** 飲食のコース（restaurant-test のメニュー）とイベントのクラスの支払い。予約メニューは bookingApi.saveMenuPayment。 */
  courseMode: (accountId: string, menuId: string) =>
    fetchApi<Result<{ mode: BookingPaymentMode | null }>>(`/api/restaurant-test/menus/${encodeURIComponent(menuId)}/payment?${q(accountId)}`),
  saveCourseMode: (accountId: string, menuId: string, mode: BookingPaymentMode | null) =>
    fetchApi<Result<{ mode: BookingPaymentMode | null }>>(`/api/restaurant-test/menus/${encodeURIComponent(menuId)}/payment?${q(accountId)}`, { method: 'PUT', body: JSON.stringify({ mode }) }),
  eventMode: (accountId: string, eventId: string) =>
    fetchApi<Result<{ mode: BookingPaymentMode | null }>>(`/api/events/admin/events/${encodeURIComponent(eventId)}/payment?${q(accountId)}`),
  saveEventMode: (accountId: string, eventId: string, mode: BookingPaymentMode | null) =>
    fetchApi<Result<{ mode: BookingPaymentMode | null }>>(`/api/events/admin/events/${encodeURIComponent(eventId)}/payment?${q(accountId)}`, { method: 'PUT', body: JSON.stringify({ mode }) }),
};

/** 口がまだ無い・表がまだ無い（B-314 の「現在準備中です」で出す）か。 */
export function isNotReadyError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 404 || error.status === 405 || error.status === 501) return true;
  return error.status === 503 && /not_ready|storage/.test(error.code ?? '');
}
