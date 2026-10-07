export interface BookingSyncRules {
  lineAccountId: string;
  excludeCalendarBusy: true;
  writeLineBookingsToCalendar: true;
  autoAssign: boolean;
  notifyConflicts: boolean;
  notifyCalendarDisconnected: boolean;
  notifyDailyLimit: boolean;
  dailyLimit: number;
  nearLimitRemaining: number;
  version: number;
}
export type BookingSyncRulesInput = Omit<BookingSyncRules, 'lineAccountId'|'version'|'excludeCalendarBusy'|'writeLineBookingsToCalendar'> & {
  expectedVersion: number; excludeCalendarBusy?: true; writeLineBookingsToCalendar?: true;
};
export interface BookingSyncNotice {
  id: string; lineAccountId: string; staffId: string; date: string;
  kind: 'calendar_disconnected'|'daily_limit'|'conflict';
  status: 'open'|'done'|'resolved'; bookingId: string|null;
  bookingCount: number; dailyLimit: number|null; message: string;
  createdAt: string; updatedAt: string;
}
