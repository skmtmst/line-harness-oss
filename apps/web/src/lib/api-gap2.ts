import { fetchApi } from './api';

/*
 * ③-2 第2弾（予約の広がり：繰り返し・同伴／複数メニュー・答えで行き先を分ける）の呼び出し。
 * 形は docs/v8-requirements/gap-features/B4〜B6 の「データと API の形の案」のとおり。
 * 口（Worker）は Codex の gap2 が作る。できるまでの撮影の見本は scripts/visual-qa/mock-api.mjs。
 */
type Result<T> = { success: true; data: T };
const e = encodeURIComponent;
const account = (path: string, id: string) => `${path}?account_id=${e(id)}`;
const json = (method: string, body: unknown, key?: string) => ({ method, body: JSON.stringify(body), ...(key ? { headers: { 'Idempotency-Key': key } } : {}) });

/** B4 繰り返し：毎週・隔週・毎月第 N 曜。 */
export type SeriesFreq = 'weekly' | 'biweekly' | 'monthly_nth';
export type SeriesRule = { freq: SeriesFreq; weekday: number; nth?: number; time: string; count?: number; until?: string };
export type SeriesOccurrence = {
  index: number;
  startsAt: string;
  available: boolean;
  /** 取れない理由（担当が休み・別の予約・お休み など）。 */
  reason?: string;
  /** 近い時間の候補（最大 3）。 */
  alternatives: string[];
};
export type SeriesPreview = { occurrences: SeriesOccurrence[]; unreadable?: boolean };
export type SeriesChoice = { index: number; action: 'keep' | 'skip' | 'alternative'; alternativeStartsAt?: string };
export type SeriesScope = 'this' | 'following';
export type SeriesScopeImpact = { bookingId: string; startsAt: string; after?: string | null; blocked?: boolean; fee?: { amount: number; percent: number; reason: string } | null };

export const bookingSeriesApi = {
  preview: (id: string, input: { menuId: string; staffId: string | null; startsAt: string; rule: SeriesRule }) =>
    fetchApi<Result<SeriesPreview>>(account('/api/booking/admin/series/preview', id), json('POST', input)),
  create: (id: string, input: { menuId: string; staffId: string | null; friendId: string; startsAt: string; rule: SeriesRule; choices: SeriesChoice[] }, key: string) =>
    fetchApi<Result<{ seriesId: string; created: number; skipped: number }> | { success: false; conflicts: number[] }>(account('/api/booking/admin/series', id), json('POST', input, key)),
  impact: (id: string, seriesId: string, input: { scope: SeriesScope; fromBookingId: string; change?: { startsAt?: string; staffId?: string } }) =>
    fetchApi<Result<{ items: SeriesScopeImpact[] }>>(account(`/api/booking/admin/series/${e(seriesId)}/impact`, id), json('POST', input)),
  change: (id: string, seriesId: string, input: { scope: SeriesScope; fromBookingId: string; change: { startsAt?: string; staffId?: string }; expectedVersion: number; notify: boolean }) =>
    fetchApi<Result<{ changed: number; blocked: number; version: number }>>(account(`/api/booking/admin/series/${e(seriesId)}`, id), json('PATCH', input)),
  cancel: (id: string, seriesId: string, input: { scope: SeriesScope; fromBookingId: string; notify: boolean }) =>
    fetchApi<Result<{ cancelled: number }>>(account(`/api/booking/admin/series/${e(seriesId)}/cancel`, id), json('POST', input)),
};

/** B5 同伴・複数メニュー。 */
export type PartyMember = { bookingId: string; label: string; menuName: string; staffName: string; startsAt: string; endsAt: string; status: string };
export type BookingParty = { groupId: string; ownerName: string; members: PartyMember[]; version: number };
export const bookingPartyApi = {
  get: (id: string, bookingId: string) => fetchApi<Result<BookingParty | null>>(account(`/api/booking/admin/bookings/${e(bookingId)}/group`, id)),
  cancel: (id: string, groupId: string, input: { scope: 'all' | 'member'; bookingId?: string; expectedVersion: number }) =>
    fetchApi<Result<{ cancelled: number }>>(account(`/api/booking/admin/groups/${e(groupId)}/cancel`, id), json('POST', input)),
};

/** B6 答えで行き先を分ける（フォームの版の JSON の routing）。 */
export type RoutingCondition = { questionId: string; op: 'is' | 'in' | 'between'; value: string | string[] | [number, number] };
export type RoutingTarget = { menuId: string; staffGroupId?: string | null; staffId?: string | null; meetingMode?: 'in_person' | 'online' | null };
export type RoutingRule = { id: string; conditions: RoutingCondition[]; target: RoutingTarget; unusable?: boolean };
export type FormRouting = { enabled: boolean; /** 分ける質問（ブロックの ID）。 */ questionId?: string; rules: RoutingRule[]; fallback: RoutingTarget };
export const formRoutingApi = {
  preview: (id: string, formId: string, answers: Record<string, string | string[] | number>) =>
    fetchApi<Result<{ matchedIndex: number; target: RoutingTarget; usable: boolean }>>(account(`/api/forms/${e(formId)}/routing/preview`, id), json('POST', { answers })),
};
