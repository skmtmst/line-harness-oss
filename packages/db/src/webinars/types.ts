


export interface Webinar {
  id: string;
  cta_version?: number;
  cta_updated_by?: string | null;
  cta_updated_at?: string | null;
  account_id: string | null;
  title: string;
  slug: string;
  status: 'draft' | 'active' | 'archived';
  video_prefix: string | null;
  duration_seconds: number;
  schedule_json: string;
  cta_json: string | null;
  tag_on_attend: string | null;
  tag_on_cta_click: string | null;
  folder_id: string | null;
  publication_starts_at: string | null;
  publication_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebinarComment {
  id: string;
  webinar_id: string;
  at_seconds: number;
  author_name: string;
  body: string;
  created_at: string;
}

export interface WebinarViewer {
  id: string;
  webinar_id: string;
  friend_id: string;
  session_start_at: number;
  joined_at: string;
  last_position_seconds: number;
  cta_clicked_at: string | null;
}

export interface WebinarUserComment {
  id: string;
  webinar_id: string;
  friend_id: string;
  session_start_at: number;
  at_seconds: number;
  body: string;
  created_at: string;
  friend_name?: string | null;
  picture_url?: string | null;
}

export interface WebinarSessionStat {
  session_start_at: number;
  viewers: number;
  avg_watched_seconds: number;
  cta_clicks: number;
}

export interface WebinarParticipantStat {
  friend_id: string;
  friend_name: string | null;
  picture_url: string | null;
  sessions: number;
  first_joined_at: string;
  latest_joined_at: string;
  max_watched_seconds: number;
  cta_clicked_at: string | null;
  registered: number;
  form_submitted_at: string | null;
}

export interface WebinarDailyStat {
  stat_date: string;
  reservations: number;
  viewers: number;
  cta_clicks: number;
  form_submissions: number;
}

export interface WebinarAnalyticsSummaryRow {
  reservations: number;
  viewers: number;
  registered_and_joined: number;
  watched_5m: number;
  watched_15m: number;
  completed: number;
  avg_watched_seconds: number;
  cta_clicks: number;
  form_submissions: number;
}

export interface WebinarOverviewMetric {
  value: number | null;
  state: 'available' | 'unavailable';
  reason: string | null;
}

export interface WebinarOverview {
  state: 'partial';
  registrationMode: 'people';
  metrics: {
    webinars: WebinarOverviewMetric;
    activeWebinars: WebinarOverviewMetric;
    registrations: WebinarOverviewMetric;
    registrationBookings: WebinarOverviewMetric;
    viewers: WebinarOverviewMetric;
    viewRate: WebinarOverviewMetric;
    averageWatchSeconds: WebinarOverviewMetric;
    ctaUniquePeople: WebinarOverviewMetric;
    ctaTotalClicks: WebinarOverviewMetric;
  };
}

export type WebinarFunnelEventType =
  | 'cta_impression'
  | 'cta_click'
  | 'form_open'
  | 'form_start'
  | 'field_complete'
  | 'submit_attempt'
  | 'submit_success'
  | 'submit_error';

export interface WebinarFormFunnelStats {
  cta_impressions: number;
  cta_clicks: number;
  form_opens: number;
  form_starts: number;
  submit_attempts: number;
  submit_successes: number;
  submit_errors: number;
  field_completions: Array<{ field_name: string; users: number }>;
}

export interface WebinarCreateInput {
  accountId?: string | null;
  title: string;
  slug: string;
  status?: string;
  videoPrefix?: string | null;
  durationSeconds?: number;
  scheduleJson?: string;
  ctaJson?: string | null;
  tagOnAttend?: string | null;
  tagOnCtaClick?: string | null;
  folderId?: string | null;
  publicationStartsAt?: string | null;
  publicationEndsAt?: string | null;
}

export interface WebinarListRow extends Webinar {
  folder_name: string | null;
  registration_count: number;
  viewer_count: number | null;
}

export interface WebinarListScope {
  allowedAccountIds: string[];
  canSeeUnassigned: boolean;
  accountId?: string;
}

export type WebinarActionTrigger = 'completed' | 'cta_clicked' | 'unviewed';
export type WebinarActionType =
  | 'add_tag' | 'remove_tag'
  | 'start_scenario' | 'stop_scenario' | 'resume_scenario'
  | 'send_message' | 'send_webhook'
  | 'switch_rich_menu' | 'remove_rich_menu';

export interface WebinarAction {
  id: string;
  webinar_id: string;
  trigger: WebinarActionTrigger;
  action_type: WebinarActionType;
  config_json: string;
  position: number;
  version: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface WebinarActionInput {
  trigger: WebinarActionTrigger;
  actionType: WebinarActionType;
  config: Record<string, unknown>;
  enabled?: boolean;
}

export type WebinarDeliveryKind = 'on_demand' | 'scheduled' | 'external';
export type WebinarMissingResultPolicy = 'escalate' | 'retry_next_day';

export interface WebinarEditorSettings {
  webinar_id: string;
  version: number;
  delivery_kind: WebinarDeliveryKind;
  viewing_condition_json: string;
  public_description: string;
  registration_form_id: string | null;
  notification_messages_json: string;
  notification_test_json: string | null;
  action_template_body: string;
  missing_result_policy: WebinarMissingResultPolicy;
  public_page_test_json: string | null;
  published_version: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebinarEditorSettingsInput {
  deliveryKind?: WebinarDeliveryKind;
  viewingCondition?: Record<string, unknown>;
  publicDescription?: string;
  registrationFormId?: string | null;
  notificationMessages?: Record<string, string>;
  notificationTest?: Record<string, unknown> | null;
  actionTemplateBody?: string;
  missingResultPolicy?: WebinarMissingResultPolicy;
  publicPageTest?: Record<string, unknown> | null;
}

export interface WebinarViewSegmentCoverage {
  start_seconds: number;
  end_seconds: number;
  viewers: number;
}

export interface WebinarParticipantOperation extends WebinarParticipantStat {
  action_status: string | null;
  action_error: string | null;
  integration_status: 'completed' | 'needs_attention' | 'pending';
  /** 開催時間内に入場した回数（ライブ視聴）。 */
  live_sessions: number;
  /** 開催終了後に専用リンクで入場した回数（録画視聴）。 */
  replay_sessions: number;
  /** 直近の入場がライブか録画か。参加記録がなければ null。 */
  last_join_kind: 'live' | 'replay' | null;
}

/**
 * 参加者の分類。未参加＝申込はあるが入場記録なし、途中離脱＝入場したが
 * 完了閾値未満、完了＝閾値以上、計測外＝外部動画などで個人の視聴を
 * 取得できないため分類しない（視聴データが無いことを未視聴と断定しない）。
 */
export type WebinarParticipantClassification =
  'unviewed' | 'dropped_off' | 'completed' | 'unmeasured';

export interface WebinarParticipantQueryOptions {
  /** ライブ／録画の境界に使う動画の長さ（秒）。0 以下は区別不能として全てライブ扱い。 */
  durationSeconds: number;
  /** 完了とみなす最大視聴秒数（呼び出し側で duration×0.9 等を決める）。 */
  completionThresholdSeconds: number;
  /** false のとき全員「計測外」。未参加・離脱・完了の絞り込みは空を返す。 */
  measured: boolean;
  /** 指定時はその分類だけを返す。 */
  classification?: WebinarParticipantClassification | null;
}

export interface WebinarMonitoringSummary {
  notification_failures: number;
  duplicate_registrations: number;
  view_segment_failures: number;
  action_failures: number;
}

export interface WebinarListFilters {
  q?: string;
  folderId?: string | null;
  status?: 'active' | 'draft' | 'archived';
  sort?: 'updated' | 'created' | 'name';
}

export interface WebinarListPaging {
  limit: number;
  offset: number;
}

export type WebinarHeartbeatPlayerState =
  | 'playing'
  | 'paused'
  | 'hidden'
  | 'buffering'
  | 'seeking';

export type WebinarHeartbeatRejectReason =
  | 'position_jump'
  | 'negative_gap'
  | 'invalid_rate';

export interface WebinarHeartbeatInput {
  webinarId: string;
  friendId: string;
  sessionStartAt: number;
  positionSeconds: number;
  playerState?: WebinarHeartbeatPlayerState | string | null;
  playbackRate?: number | null;
  clientAtMs?: number | null;
  receivedAtEpoch?: number | null;
}

export type WebinarHeartbeatResult =
  | { status: 'recorded' }
  | { status: 'not_counted' }
  | { status: 'moved' }
  | { status: 'rejected'; reason: WebinarHeartbeatRejectReason };

export interface WebinarHeartbeatOptions {
  playbackRate?: number | null;
  clientAtMs?: number | null;
  windowSeconds?: number | null;
}

export interface WebinarRetentionPoint {
  at_seconds: number;
  viewers: number;
}

export type WebinarActionExecutionStatus =
  | 'queued' | 'claimed' | 'succeeded' | 'skipped'
  | 'retry_wait' | 'permanent_failed' | 'cancelled';

export interface WebinarActionExecutionInput {
  webinarActionId: string;
  webinarId: string;
  friendId: string;
  sessionStartAt: number | null;
  trigger: WebinarActionTrigger;
  status: WebinarActionExecutionStatus;
  idempotencyKey: string;
  lastError?: string | null;
}

// ─── Webinar CTA cards ───────────────────────────────────

export interface WebinarCta {
  id: string;
  webinar_id: string;
  at_seconds: number;
  kind: 'form' | 'url';
  title: string;
  body: string | null;
  button_label: string;
  auto_open: number;
  form_id: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
}

// ---- セッション予約 (webinar_registrations) ----

export interface WebinarRegistration {
  id: string;
  webinar_id: string;
  friend_id: string;
  session_start_at: number;
  notified_at: string | null;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  created_at: string;
}

// ---- N: 動画の準備・開催回の定員・見逃し配信・保管 ----

export type WebinarVideoStage =
  | 'uploaded'
  | 'inspecting'
  | 'converting'
  | 'packaging'
  | 'thumbnail'
  | 'ready'
  | 'failed';

export interface WebinarVideoAsset {
  id: string;
  webinar_id: string;
  stage: WebinarVideoStage;
  provider: string;
  duration_seconds: number;
  checksum: string | null;
  error_code: string | null;
  expires_at: string | null;
  purged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebinarSessionRow {
  id: string;
  webinar_id: string;
  session_start_at: number;
  capacity: number | null;
  reserved_count: number;
  state: 'open' | 'full' | 'closed';
  created_at: string;
  updated_at: string;
}
