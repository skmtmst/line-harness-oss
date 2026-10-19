import { jstCalendar as japanCalendar } from '@line-crm/shared';


// ----------------------------------------------------------------
// LIFF: create booking
// ----------------------------------------------------------------

export interface EventDbRow {
  id: string;
  name: string;
  venue_address: string | null;
  venue_name: string | null;
  venue_url: string | null;
  confirmation_message_extra: string | null;
  requires_approval: number;
  approval_deadline_hours: number;
  current_published_version_id: string | null;
  max_bookings_per_friend: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  /** 公開対象を絞るタグ。null なら友だち全員 */
  visible_tag_id: string | null;
  /** 満席のあとキャンセル待ちを受けるか */
  waitlist_enabled: number;
  /** 申込の締め切り（開始の何時間前まで）。null なら開始まで受ける */
  entry_cutoff_hours_before: number | null;
  /** 申込時のカスタム質問定義 (#841)。未設定なら NULL。 */
  questions_json: string | null;
}

export interface SlotDbRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  is_active: number;
  deleted_at: string | null;
}


export const JST_OFFSET_MS = 9 * 3600_000;

export function startsAtJst(utcIso: string): string {
  const jst = japanCalendar(new Date(utcIso)).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}
