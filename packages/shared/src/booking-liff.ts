/** 本人確認済みの LIFF 予約履歴。変更・取消には取得した版をそのまま送る。 */
export interface BookingHistoryItem {
  meeting_mode?:'in_person'|'online'|null;
  meeting_url?:string|null;
  meeting_url_source?:'staff'|'menu'|'manual'|null;
  cancellationQuote?:import('./gap1.js').BookingCancellationQuote;
  id: string;
  starts_at: string;
  ends_at?:string;
  status: string;
  lock_version: number;
  /** メニューの指定が無いときは店の既定を適用した期限（UTC）。 */
  cancel_deadline_at?: string;
  cancel_deadline_minutes_before?: number;
  menu_id: string;
  staff_id: string;
  customer_note?: string | null;
  menu_name: string;
  staff_name: string;
  profile_image_url: string | null;
}

export interface BookingHistoryResponse {
  upcoming: BookingHistoryItem[];
  past: BookingHistoryItem[];
}

export interface LiffBookingChangeResponse {
  status: string;
  lock_version: number;
  calendar_sync: string;
  meet_sync: string;
}
