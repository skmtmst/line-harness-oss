import { fetchApi } from './api';

/*
 * ③-2 第2波のうち、口（Worker）がまだ無い物の呼び出し（B-314：形は残し、押すと「現在準備中です」）。
 * 形は docs/v8-requirements/gap-features/B4・B5 の「データと API の形の案」のとおり。口ができたら api-gap2.ts へ移す。
 * 読む口は試して、無ければ（404 など）その段・その列を出さない／準備中にする。
 */
type Result<T> = { success: true; data: T };
const e = encodeURIComponent;
const account = (path: string, id: string) => `${path}?account_id=${e(id)}`;

/** B5 同伴の組：人ごとのメニュー・担当・時間。 */
export type PartyMember = { bookingId: string; label: string; menuName: string; staffName: string; startsAt: string; endsAt: string; status: string };
export type BookingParty = { groupId: string; ownerName: string; members: PartyMember[]; version: number };
export const bookingPartyApi = {
  get: (id: string, bookingId: string) => fetchApi<Result<BookingParty | null>>(account(`/api/booking/admin/bookings/${e(bookingId)}/group`, id)),
};

/** B4 繰り返しの変更・取消の前もっての見込み（埋まっている回・キャンセル料）。 */
export type SeriesImpactItem = { bookingId: string; startsAt: string; after?: string | null; blocked?: boolean; fee?: { amount: number; percent: number; reason: string } | null };
export const seriesImpactApi = {
  impact: (id: string, seriesId: string, input: { scope: 'this' | 'following'; fromBookingId: string; change?: { startsAt?: string } }) =>
    fetchApi<Result<{ items: SeriesImpactItem[] }>>(account(`/api/booking/admin/series/${e(seriesId)}/impact`, id), { method: 'POST', body: JSON.stringify(input) }),
};
