import type { FormLayout } from '@line-crm/shared';
import type { LiffLookApiSettings } from './liff-look.js';



export interface MenuItem {
  id: string;
  name: string;
  category_label: string | null;
  description: string | null;
  duration_minutes: number;
  buffer_after_minutes: number;
  base_price: number;
  price_mode?: 'fixed' | 'free' | 'inquiry';
  payment_mode?: 'none' | 'onsite' | 'online';
  sort_order: number;
  /** キャンセル期限 (開始の何時間前まで)。null は店の既定を使う。 */
  cancel_deadline_hours_before?: number | null;
  intake_question?: string | null;
}


export interface StaffItem {
  id: string;
  display_name: string;
  role: string | null;
  profile_image_url: string | null;
  bio: string | null;
  is_designation_optional: number;
  price: number;
  price_mode?: 'fixed' | 'free' | 'inquiry';
  duration_minutes: number;
}


export interface AvailabilityResponse {
  by_staff: Array<{
    staff_id: string;
    display_name: string;
    slots: Array<{
      date: string;
      start: string;
      end: string;
      /** 残り枠。0 は埋まった枠（カレンダーの「満」の判定に使う）。無いときは空きありと扱う。 */
      remaining?: number;
      /** 枠の状態（Worker が付ける。'full' は埋まった枠）。 */
      state?: 'available' | 'limited' | 'full' | 'closed';
      /** 店のタイムゾーン名（date・start はこの zone の暦日・壁時刻）。 */
      timeZone?: string;
      /** 開始の瞬間（offset 付き ISO）。予約・待ちの登録はこれを送る。 */
      startUtc?: string;
      /** 終了の瞬間（offset 付き ISO）。 */
      endUtc?: string;
    }>;
  }>;
  /** 休みの日（お店・担当が閉めている日）。カレンダーの「休」の印に使う。 */
  closed_dates?: string[];
}


/**
 * LIFF 予約の設定（日時を選ぶ段の最初の形と受付期間＋見た目）。
 * 見た目の欄（型・店の色・カレンダーの出し方・空きの点）は M3 が足す。
 * 来ない欄は呼び側が既定に倒す。
 */
export interface LiffBookingSettings extends LiffLookApiSettings {
  liff_date_view: 'list' | 'calendar';
  booking_window_days: number;
  /** 予約のルール「お店が承認してから確定する」。無いときは承認あり扱い。 */
  approval_mode?: 'automatic' | 'manual';
  cancel_deadline_minutes_before?: number;
}


/** 予約作成の応答。お支払いありの店・メニューだけ payment が付く。 */
export interface CreateBookingResponse {
  booking_id: string;
  status: string;
  payment_required?: boolean;
  payment?: { id: string; status: string; holdUntil: string | null } | null;
  /** 無断キャンセルが続いている人への前払いのみの案内。対象のときだけ付く。 */
  prepayNotice?: string;
}


/** 前回と同じで予約：本人の前回の予約。無い・使えないときは available=false。 */
export interface LastBookingResponse {
  available: boolean;
  reason?: string;
  booking?: {
    id: string;
    starts_at: string;
    status: string;
    menu: { id: string; name: string };
    staff: { id: string; display_name: string; profile_image_url: string | null };
  };
}


/** 自分のキャンセル待ち登録。無いときは entry: null。 */
export interface WaitlistMineResponse {
  entry: { id: string; status: string; created_at: string } | null;
}


/** お客さまが見る支払いの状態。 */
export interface BookingPayment {
  id: string;
  status: 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded' | 'expired';
  amount?: number | null;
  currency?: string | null;
  hold_until?: string | null;
  /** 領収書のページ（Stripe）。返す口ができるまで無い（組1 に依頼中）。 */
  receipt_url?: string | null;
}


/** 本人の回数券・月謝（組3 の GET /api/liff/booking/entitlements の 1 件）。 */
export interface BookingEntitlement {
  id: string;
  name: string;
  kind: 'ticket' | 'monthly';
  menuId: string | null;
  remaining: number | null;
  monthlyLimit: number | null;
  monthAllowance: number | null;
  monthUsed: number | null;
  monthRemaining: number | null;
  validFrom: string | null;
  expiresAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  usable: boolean;
}


/** お知らせの受け取り（組1 の 16。637 を共用）。 */
export type NotificationPurpose = 'booking_reminders' | 'marketing';

export interface NotificationPreferenceItem {
  purpose: NotificationPurpose;
  label: string;
  state: 'granted' | 'revoked' | 'unknown';
  enabled: boolean | null;
  recorded: boolean;
  version: number;
  updatedAt: string | null;
}

export interface NotificationPreferences {
  items: NotificationPreferenceItem[];
  /** 送る側が目的ごとに止められるようになったら true。false の間は画面で切り替えさせない。 */
  purposeSpecificEnforcement?: boolean;
}


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


/**
 * 申込の返し。席が取れたときは {id, status} (status は requested=承認待ち /
 * confirmed=確定)。満席で待ちに入ったときは 200 で {waitlisted: true} が
 * 返る (Worker events.ts runBookingFlow/enterWaitlist)。409 だと画面側が
 * 失敗として扱い「キャンセル待ちに入りました」を出せないための形。
 */
export type CreateEventBookingResponse =
  | { id: string; status: string }
  | { waitlisted: true; slot_id: string };


export interface EventBookingMine {
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



// ============================================================
// 回答フォーム
// ============================================================

/** 公開して良い範囲だけを返した回答フォーム。 */
export interface PublicForm {
  id: string;
  name: string;
  description: string | null;
  layout: FormLayout;
  isActive: boolean;
  /** P（試し回答）：true は下書きの試し。集計に入らず、後処理も動かない。 */
  isTest?: boolean;
  availability?: import('@line-crm/shared').FormAvailability;
}


/** F-11：郵便番号検索の結果。status が matched/multiple のとき候補から選ぶ。 */
export interface PostalCodeCandidate {
  postalCode: string;
  prefecture: string;
  city: string;
  town: string;
}


export interface PostalCodeSearchResponse {
  success: boolean;
  data: {
    query: string;
    normalized: string | null;
    status: 'invalid' | 'none' | 'matched' | 'multiple';
    candidates: PostalCodeCandidate[];
  };
}


/** フォーム回答の送信結果。未完のとき data.complete が false で返る。 */
export interface FormSubmitResponse {
  success: boolean;
  data?: Record<string, unknown> & { complete?: boolean; pendingEffects?: string[] };
  retryable?: boolean;
  error?: string;
  code?: string;
  idempotencyKey?: string;
}
