export interface ReminderDeliveryResult {
  succeeded: number;
  skipped: number;
  retrying: number;
  failed: number;
  /** 緊急停止で claim せず残した登録数（復旧後に届く）。 */
  held: number;
}
