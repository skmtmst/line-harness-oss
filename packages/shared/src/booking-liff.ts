/** 本人確認済みの LIFF 予約履歴。変更・取消には取得した版をそのまま送る。 */
export interface BookingHistoryItem {
  id: string;
  starts_at: string;
  status: string;
  lock_version: number;
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
