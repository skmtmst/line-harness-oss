// ============================================================
// Event-booking admin API
// ============================================================

export interface EventListItem {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  approval_deadline_hours: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  /** U: 保存する状態（下書き・公開中・一時停止・終了・中止）。旧応答には無いため optional。 */
  lifecycle_status?: EventLifecycleStatus | null;
  /** 入っているフォルダ（kind=event）。一覧の応答が folder_id から足す。旧応答には無いため optional。 */
  folderId?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  version: number;
  next_slot_starts_at: string | null;
  total_capacity: number | null;
  total_active: number;
  pending_count: number;
  /** 申込条件。null なら友だち全員に見える（094） */
  visible_tag_id: string | null;
  /** visible_tag_id のタグ名。ID があっても消されたタグなら null */
  visible_tag_name: string | null;
  // Multi-account fields (migration 040)
  target_type?: 'single' | 'multi-account-dedup';
  account_ids?: string | string[] | null;
  line_account_id?: string;
}

/** 申込時に聞く質問 (#841)。Worker 側で events.questions_json に保存される。 */
export interface EventQuestion {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'radio' | 'checkbox';
  required: boolean;
  /** radio / checkbox の選択肢。記述式では null。 */
  options?: string[] | null;
}

export interface EventDetail {
  folderId?: string | null;
  venue_address?: string | null;
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  approval_deadline_hours: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  /** U: 保存する状態。旧応答には無いため optional。 */
  lifecycle_status?: EventLifecycleStatus | null;
  sort_order: number;
  confirmation_message_extra: string | null;
  reminder_message_extra: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  /** 公開対象を絞るタグ。null なら友だち全員に見える */
  visible_tag_id?: string | null;
  /** 満席のあとキャンセル待ちを受けるか。0 なら締め切る */
  waitlist_enabled?: number;
  /** 申込の締め切り（開始の何時間前まで）。null なら開始まで受ける */
  entry_cutoff_hours_before?: number | null;
  // Multi-account fields (migration 040, broadcasts と同パターン)
  target_type?: 'single' | 'multi-account-dedup';
  // Worker は JSON 文字列で返す。UI 側で parse して string[] を扱う。
  account_ids?: string | string[] | null;
  dedup_priority?: string | string[] | null;
  line_account_id?: string;
  /**
   * Worker の応答では questions_json の生JSON文字列。送信時は配列の
   * questions を使い、読み込み時は questions_json を parse する
   * (account_ids と同じ扱い)。
   */
  questions_json?: string | null;
  questions?: EventQuestion[] | null;
  version?: number;
}

export interface EventSlot {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  active_count?: number;
  /** 一括追加の再送防止キー。サーバーが同じイベント内で一意に扱う(#1000)。 */
  client_key?: string | null;
  /** 再送で既存枠に解決された場合 true。新規作成分は false。 */
  deduplicated?: boolean;
  /** 枠の版。更新時はこの版を期待版として送り、古ければ409になる(m26g)。 */
  version?: number;
}

/** createSlots に渡す1枠分の入力。client_key は再送を吸収するための任意キー。 */
export interface EventSlotInput {
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active?: number;
  sort_order?: number;
  client_key?: string;
}

export interface EventBookingItem {
  id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  line_account_id: string;
  status: string;
  customer_note: string | null;
  internal_note: string | null;
  /** カスタム質問への回答 (#841)。{質問id: 回答} のJSON文字列。 */
  answer_snapshot_json?: string | null;
  requested_at: string;
  decided_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  slot_starts_at: string;
  slot_ends_at: string;
  friend_display_name: string | null;
  friend_line_user_id: string | null;
  /** 一覧の旧応答・拡張応答との互換。未接続なら画面は正直に「未取得」と出す。 */
  friend_name?: string | null;
  created_at?: string;
  companion_note?: string | null;
  companion_count?: number | null;
  is_first_time?: number | null;
  line_account_name?: string | null;
  /**
   * この予約に紐づく自動お知らせの予定と状態（IDEA-07）。
   * 開催回の移動・取消で止まった分も status で返るので、
   * 変更前後の通知と残存をこの配列から確かめられる。
   */
  reminders?: Array<{
    kind: 'day_before' | 'hours_before';
    scheduled_at: string;
    sent_at: string | null;
    status: 'pending' | 'sent' | 'failed' | 'failed_permanent' | 'cancelled';
  }>;
}

export interface EventBookingSummary {
  total: number;
  requested: number;
  confirmed: number;
  rejected: number;
  cancelled: number;
  expired: number;
  attended: number;
  noShow: number;
  waitlist: number;
  /**
   * IDEA-29: 状態ごとの人数(party_size 合計)。行数(件)と分けて返す。
   * 配備途中の旧応答には無いため、画面側は行数へ戻す。
   */
  requestedSeats?: number;
  confirmedSeats?: number;
  /** 待機中(並んでいる)の人数。席は消費しない。 */
  waitingSeats?: number;
  /** 案内中・受諾済みの人数。期限付きで席を保留中。 */
  offeredSeats?: number;
  /** 席を消費中の人数 = requested+confirmed+offered。 */
  activeSeats?: number;
  totalCapacity: number | null;
}

/**
 * イベント一覧の全体集計（R79/R80）。ページ切りとは別に、絞り込み条件に合う
 * 全イベントの「今後の開催枠」だけを数えたもの。Worker の
 * summarizeFutureEventSlots が作る。
 */
export interface EventListSummary {
  upcoming_slots: number;
  upcoming_active: number;
  upcoming_capacity: number | null;
  fill_rate: number | null;
  nearly_full: number;
  low_applications: number;
  nearest_upcoming_starts_at: string | null;
  nearest_low_starts_at: string | null;
}

export type EventListResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  sort: Array<{ field: string; direction: 'asc' | 'desc' }>;
  /** 全体集計。古い応答には無いため optional。無いときはページ内の行で数える。 */
  summary?: EventListSummary;
};

export interface EventWaitlistItem {
  id: string;
  slot_id: string;
  friend_id: string;
  /** waiting = 並んでいる / invited = 声をかけた */
  status: string;
  notified_at: string | null;
  created_at: string;
  slot_starts_at: string;
  friend_name: string | null;
}

/** 開催回ごとの予約・キャンセル待ち。画面表示と操作を同じ版で扱う。 */
export interface EventOccurrenceApplicant {
  source: 'booking' | 'waitlist';
  id: string;
  friendId: string;
  displayName: string | null;
  pictureUrl: string | null;
  status: string;
  partySize: number;
  appliedAt: string;
  answers: unknown | null;
  firstParticipation: { isFirst: boolean | null; attendedCount: number | null; checkedAt: string | null };
  offeredAt: string | null;
  offerExpiresAt: string | null;
}

export interface EventOccurrenceApplicants {
  occurrence: {
    id: string;
    eventId: string;
    startsAt: string;
    endsAt: string;
    capacity: number | null;
    activeSeats: number;
    version: number;
  };
  summary: {
    bookingCount: number;
    waitingCount: number;
    activeSeats: number;
    /** IDEA-29: 状態ごとの人数。旧応答には無いため optional。 */
    confirmedSeats?: number;
    requestedSeats?: number;
    waitingSeats?: number;
    offeredSeats?: number;
    remainingSeats?: number | null;
  };
  /**
   * IDEA-29: 繰上げ履歴。終了した待ち行(予約化・期限切れ・取消)を新しい順。
   * 旧応答には無いため optional。
   */
  waitlistHistory?: Array<{
    id: string;
    friendId: string;
    displayName: string | null;
    status: string;
    partySize: number;
    createdAt: string;
    offeredAt: string | null;
    offerExpiresAt: string | null;
    notifiedAt: string | null;
    updatedAt: string;
    convertedBookingId: string | null;
  }>;
  /** IDEA-29: 当日受付の記録。旧応答には無いため optional。 */
  attendance?: {
    attendedSeats: number;
    noShowSeats: number;
    entries: Array<{
      id: string;
      friendId: string;
      displayName: string | null;
      status: string;
      partySize: number;
      markedAt: string;
    }>;
  };
  applicants: EventOccurrenceApplicant[];
  /** 表示・CSV・一斉案内を同じ対象で扱う短期サーバースナップショット。 */
  snapshotId: string;
  snapshotExpiresAt: string;
}

export type EventWaitlistPromotionResult =
  | { kind: 'promoted'; occurrenceVersion: number; promoted: { waitlistId: string; friendId: string; partySize: number; status: 'offered'; offeredAt: string; expiresAt: string } }
  | { kind: 'noop'; occurrenceVersion: number; promoted: null; reason: string };

/**
 * U: イベントの保存する状態（管理画面-29 §11-2）。
 * 「満席」「申込が少ない」は保存せず、開催回・定員・日時からの計算で札を出す。
 */
export type EventLifecycleStatus = 'draft' | 'published' | 'paused' | 'ended' | 'cancelled';

export interface EventSlotChange {
  slot_id: string;
  starts_at?: string;
  ends_at?: string;
  capacity?: number | null;
  is_active?: number;
}

export interface EventChangeImpact {
  slot_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  confirmed_seats: number;
  waiting_seats: number;
  pending_reminders: number;
  errors: string[];
  notices: string[];
}

export interface EventChangePreview {
  event_id: string;
  impacts: EventChangeImpact[];
  event_notices: string[];
  blocked: boolean;
  total_confirmed: number;
  total_waiting: number;
  total_pending_reminders: number;
}

export interface EventChangeApplyResult {
  success: boolean;
  deduplicated?: boolean;
  version?: number;
  log_id: string;
  affected_confirmed?: number;
  affected_waiting?: number;
  notified?: number;
}

export interface EventLifecycleResult {
  success: boolean;
  deduplicated?: boolean;
  unchanged?: boolean;
  lifecycle_status: EventLifecycleStatus;
  version: number;
  log_id?: string;
}
