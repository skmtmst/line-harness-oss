import { bookingApi } from './api';
import type { BookingSalesSummary } from '@line-crm/shared/audit4-api';

export type { BookingSalesSummary, BookingSalesMenu, BookingSalesWeekday, BookingSalesTotal } from '@line-crm/shared/audit4-api';

/** 既存の認証・エラー処理を共用し、入金額を含む予約売上の型を返す。 */
export const bookingSalesAuditApi = {
  getSalesSummary: (accountId: string, from: string, to: string) =>
    bookingApi.getSalesSummary(accountId, from, to) as Promise<{ success: true; data: BookingSalesSummary }>,
};
