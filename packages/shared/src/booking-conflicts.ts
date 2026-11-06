/** 人の予約で保存されている受付経路。import から媒体名は推測しない。 */
export type BookingReceptionSource = 'liff' | 'phone' | 'counter' | 'operator' | 'import';

export interface BookingConflictReservation {
  bookingId: string;
  customerName: string;
  menuName: string;
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  source: BookingReceptionSource;
  sourceLabel: string;
  version: number;
}

export interface BookingConflict {
  // 既存の利用側と担当への通知が使っている項目は維持する。
  staffId: string;
  staffName: string;
  bookingId: string;
  otherBookingId: string;
  startsAt: string;
  endsAt: string;
  otherStartsAt: string;
  otherEndsAt: string;
  version: number;
  otherVersion: number;
  bookings: [BookingConflictReservation, BookingConflictReservation];
  reasonCode: 'same_staff_time_overlap';
  reason: string;
  /** 有効な連携設定の有無。Google 側での認証成功を保証する値ではない。 */
  calendarConnected: boolean;
  guidance: string | null;
}

export interface BookingConflictsResponse {
  conflicts: BookingConflict[];
  notifyConflicts: boolean;
}

export interface BookingReassignInput {
  staffId: string;
  notifyCustomer: boolean;
}

export interface BookingCustomerNotification {
  channel: 'line' | 'phone';
  status: 'queued' | 'action_required' | 'not_requested' | 'sending_stopped';
  guidance: string | null;
}
