import { fetchApi } from './api';

/*
 * ③-2 第1波（B-349）で、まだ Worker に口が無い所の「形の案」（要件 B1・B5 の「データと API の形の案」どおり）。
 * 画面が先に呼び、口が無い間は 404 などで落ちて画面は共通の準備中で出す。中身は Codex が作る。
 * 本物の口ができたら Codex の api-gap1.ts へ寄せ、このファイルは消す（B-319）。
 */
type Result<T> = { success: true; data: T };
const e = encodeURIComponent;
const account = (path: string, id: string) => `${path}?account_id=${e(id)}`;
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

/** デポジット（一部前払い）。kind=none／amount（円）／percent（%）。conditions は「すべて満たす」。 */
export interface DepositRule {
  kind: 'none' | 'amount' | 'percent';
  value: number | null;
  conditions: { always: boolean; minPeople: number | null; weekdays: number[] | null; timeBand: string | null };
  version: number;
}

/** キャンセル料のうち、gap1 の口に無い 2 つ（カードを登録してもらう条件・請求の仕方）。 */
export interface CancellationOptions {
  cardRequiredFor: 'all' | 'no_show_flagged' | 'conditions';
  chargeMode: 'manual' | 'auto';
  version: number;
}

/** 予約に登録されたカード（末尾 4 桁だけ。番号は持たない）。 */
export interface BookingCard { brand: string; last4: string; registeredAt: string | null }

/** 組の予約（B5）。同じ申込で入った人ごとの予約。 */
export interface BookingGroup {
  ownerName: string | null;
  members: Array<{ bookingId: string; personName: string; menuName: string; staffName: string | null; startsAt: string; endsAt: string; status: string }>;
}

export const gapDraftApi = {
  depositRule: (id: string) => fetchApi<Result<DepositRule>>(account('/api/booking/admin/deposit-rules', id)),
  saveDepositRule: (id: string, input: Omit<DepositRule, 'version'> & { expectedVersion: number }) =>
    fetchApi<Result<DepositRule>>(account('/api/booking/admin/deposit-rules', id), json('PUT', input)),
  menuDeposit: (id: string, menuId: string) => fetchApi<Result<DepositRule & { inherit: boolean }>>(account(`/api/booking/admin/menus/${e(menuId)}/deposit`, id)),
  saveMenuDeposit: (id: string, menuId: string, input: Omit<DepositRule, 'version'> & { inherit: boolean; expectedVersion: number }) =>
    fetchApi<Result<DepositRule & { inherit: boolean }>>(account(`/api/booking/admin/menus/${e(menuId)}/deposit`, id), json('PUT', input)),
  cancellationOptions: (id: string) => fetchApi<Result<CancellationOptions>>(account('/api/booking/admin/cancellation-options', id)),
  saveCancellationOptions: (id: string, input: Omit<CancellationOptions, 'version'> & { expectedVersion: number }) =>
    fetchApi<Result<CancellationOptions>>(account('/api/booking/admin/cancellation-options', id), json('PUT', input)),
  bookingCard: (id: string, bookingId: string) => fetchApi<Result<BookingCard | null>>(account(`/api/booking/admin/bookings/${e(bookingId)}/payment-method`, id)),
  bookingGroup: (id: string, bookingId: string) => fetchApi<Result<BookingGroup | null>>(account(`/api/booking/admin/bookings/${e(bookingId)}/group`, id)),
  cancelGroup: (id: string, bookingId: string, reason: string) =>
    fetchApi<Result<{ cancelled: number }>>(account(`/api/booking/admin/bookings/${e(bookingId)}/group/cancel`, id), json('POST', { reason })),
};
