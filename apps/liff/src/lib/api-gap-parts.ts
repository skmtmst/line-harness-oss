


// ============================================================
// Event booking types
// ============================================================

export interface EventQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'radio' | 'checkbox';
  required: boolean;
  options?: string[] | null;
}


export interface EventDetail {
  id: string;
  name: string;
  venue_name: string | null;
  venue_address?: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  /** 満席のあとキャンセル待ちを受けるか (GET /api/liff/events/:id が行ごと返す)。 */
  waitlist_enabled?: number | null;
  /** 申込時のカスタム質問 (#841)。定義が無いイベントは空配列。 */
  questions?: EventQuestion[];
}


export interface EventSlot {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  active_count: number;
  remaining: number | null;
}

export interface EventBookingMakeup { enabled: boolean; /** 振替がもらえるときの期限（この欠席なら）。 */ valid_until?: string | null; /** 欠席の連絡の締め（これを過ぎると振替の対象外）。 */ cutoff_at: string | null; plan_label?: string | null }


export interface EventBookingMine {
  makeup?: EventBookingMakeup;
  /** 従来の予約行は未指定。待ちの行は source: 'waitlist'。 */
  source?: 'booking' | 'waitlist';
  queue_position?: number | null;
  party_size?: number;
  slot_id?: string;
  offer_expires_at?: string | null;
  id: string;
  event_id: string;
  status: string;
  customer_note: string | null;
  event_name: string;
  event_image_url: string | null;
  venue_name: string | null;
  venue_address?: string | null;
  venue_url: string | null;
  cancel_deadline_hours_before: number | null;
  slot_starts_at: string;
  slot_ends_at: string;
}


// ===== Webinar =====

export interface WebinarCta {
  label: string;
  url: string;
  showAtSeconds: number;
}


export interface WebinarSakuraComment {
  atSeconds: number;
  authorName: string;
  body: string;
}


export type WebinarState =
  | {
      live: true;
      title: string;
      durationSeconds: number;
      sessionStartAt: number;
      offsetSeconds: number;
      playlistUrl: string;
      cta: WebinarCta | null;
      comments: WebinarSakuraComment[];
    }
  | { live: false; title: string; nextSessionAt: number | null };