import { jstNow } from './utils.js';

export interface Webinar {
  id: string;
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

export function classifyWebinarParticipant(
  row: { sessions: number; max_watched_seconds: number },
  options: { measured: boolean; completionThresholdSeconds: number },
): WebinarParticipantClassification {
  if (!options.measured) return 'unmeasured';
  if (row.sessions === 0) return 'unviewed';
  return row.max_watched_seconds >= options.completionThresholdSeconds
    ? 'completed'
    : 'dropped_off';
}

export interface WebinarMonitoringSummary {
  notification_failures: number;
  duplicate_registrations: number;
  view_segment_failures: number;
  action_failures: number;
}

export async function getWebinars(db: D1Database): Promise<Webinar[]> {
  const { results } = await db
    .prepare('SELECT * FROM webinars ORDER BY created_at DESC')
    .all<Webinar>();
  return results ?? [];
}

function webinarScopeWhere(scope: WebinarListScope, alias = 'w'): {
  sql: string;
  bindings: string[];
} {
  if (scope.accountId) {
    if (!scope.allowedAccountIds.includes(scope.accountId)) {
      return { sql: '1 = 0', bindings: [] };
    }
    return { sql: `${alias}.account_id = ?`, bindings: [scope.accountId] };
  }
  const accountSql = scope.allowedAccountIds.length > 0
    ? `${alias}.account_id IN (${scope.allowedAccountIds.map(() => '?').join(',')})`
    : null;
  if (accountSql && scope.canSeeUnassigned) {
    return {
      sql: `(${accountSql} OR ${alias}.account_id IS NULL)`,
      bindings: scope.allowedAccountIds,
    };
  }
  if (accountSql) return { sql: accountSql, bindings: scope.allowedAccountIds };
  return {
    sql: scope.canSeeUnassigned ? `${alias}.account_id IS NULL` : '1 = 0',
    bindings: [],
  };
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

const WEBINAR_LIST_SORT: Record<
  NonNullable<WebinarListFilters['sort']>,
  { order: string; field: string; direction: 'asc' | 'desc' }
> = {
  updated: { order: 'w.updated_at DESC, w.id DESC', field: 'updatedAt', direction: 'desc' },
  created: { order: 'w.created_at DESC, w.id DESC', field: 'createdAt', direction: 'desc' },
  /* 日本語の見出し順とは並びが違うことがある(SQLite のバイト順)。画面の名前順と完全一致はしない。 */
  name: { order: 'w.title ASC, w.id ASC', field: 'title', direction: 'asc' },
};

function webinarListFilterWhere(
  filters: WebinarListFilters,
  alias = 'w',
): { sql: string; bindings: string[] } {
  const conditions: string[] = [];
  const bindings: string[] = [];
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    conditions.push(`(LOWER(${alias}.title) LIKE ? ESCAPE '\\' OR LOWER(${alias}.slug) LIKE ? ESCAPE '\\')`);
    bindings.push(like, like);
  }
  if (filters.folderId !== undefined) {
    if (filters.folderId === null) {
      conditions.push(`${alias}.folder_id IS NULL`);
    } else {
      conditions.push(`${alias}.folder_id = ?`);
      bindings.push(filters.folderId);
    }
  }
  if (filters.status) {
    conditions.push(`${alias}.status = ?`);
    bindings.push(filters.status);
  }
  return { sql: conditions.length > 0 ? conditions.join(' AND ') : '1 = 1', bindings };
}

function webinarListWhere(
  scope: WebinarListScope,
  filters: WebinarListFilters,
): { sql: string; bindings: string[] } {
  const where = webinarScopeWhere(scope);
  const filter = webinarListFilterWhere(filters);
  return {
    sql: `${where.sql} AND ${filter.sql}${filters.status === 'archived' ? '' : " AND w.status <> 'archived'"}`,
    bindings: [...where.bindings, ...filter.bindings],
  };
}

/** V6一覧用。人数は予約枠数ではなく、ウェビナーごとの重複しない友だち数。 */
export async function getWebinarList(
  db: D1Database,
  scope: WebinarListScope,
  paging?: WebinarListPaging,
  filters: WebinarListFilters = {},
): Promise<WebinarListRow[]> {
  const where = webinarListWhere(scope, filters);
  const sort = WEBINAR_LIST_SORT[filters.sort ?? 'updated'];
  const bindings: Array<string | number> = [...where.bindings];
  // paging省略時は全件(旧契約の呼び出し形を保つ)。一覧APIは必ずpagingを渡す。
  const pageClause = paging ? 'LIMIT ? OFFSET ?' : '';
  if (paging) bindings.push(paging.limit, paging.offset);
  const result = await db.prepare(
    `SELECT w.*,
            f.name AS folder_name,
            (SELECT COUNT(DISTINCT r.friend_id)
               FROM webinar_registrations r
              WHERE r.webinar_id = w.id AND r.status = 'active') AS registration_count,
            (SELECT COUNT(DISTINCT v.friend_id)
               FROM webinar_viewers v
              WHERE v.webinar_id = w.id) AS viewer_count
       FROM webinars w
       LEFT JOIN folders f ON f.id = w.folder_id
                            AND f.kind = 'webinar'
                            AND f.account_id = w.account_id
      WHERE ${where.sql}
      ORDER BY ${sort.order}
      ${pageClause}`,
  ).bind(...bindings).all<WebinarListRow>();
  return result.results ?? [];
}

/** V6一覧の総件数。絞りは `getWebinarList` と同じ条件。 */
export async function countWebinarList(
  db: D1Database,
  scope: WebinarListScope,
  filters: WebinarListFilters = {},
): Promise<number> {
  const where = webinarListWhere(scope, filters);
  const row = await db.prepare(
    `SELECT COUNT(*) AS total FROM webinars w WHERE ${where.sql}`,
  ).bind(...where.bindings).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

/** 一覧の並び順の応答表示。共通一覧契約の `sort` に入れる。 */
export function webinarListSort(filters: WebinarListFilters): Array<{ field: string; direction: 'asc' | 'desc' }> {
  const sort = WEBINAR_LIST_SORT[filters.sort ?? 'updated'];
  return [{ field: sort.field, direction: sort.direction }];
}

/** GET /api/folders?kind=webinar の各フォルダに表示する、権限内の件数。 */
export async function getWebinarFolderCounts(
  db: D1Database,
  scope: WebinarListScope,
): Promise<Record<string, number>> {
  const where = webinarScopeWhere(scope);
  const result = await db.prepare(
    `SELECT w.folder_id, COUNT(*) AS item_count
       FROM webinars w
       JOIN folders f ON f.id = w.folder_id
                     AND f.kind = 'webinar'
                     AND f.account_id = w.account_id
      WHERE ${where.sql} AND w.status <> 'archived'
      GROUP BY w.folder_id`,
  ).bind(...where.bindings).all<{ folder_id: string; item_count: number }>();
  return Object.fromEntries(
    (result.results ?? []).map((row) => [row.folder_id, Number(row.item_count)]),
  );
}

export async function getWebinarOverview(
  db: D1Database,
  accountId: string,
): Promise<WebinarOverview> {
  const row = await db.prepare(
    `WITH visible_webinars AS (
       SELECT id, status
         FROM webinars
        WHERE account_id = ? AND status <> 'archived'
     )
     SELECT
       (SELECT COUNT(*) FROM visible_webinars) AS webinar_count,
       (SELECT COUNT(*) FROM visible_webinars WHERE status = 'active') AS active_webinar_count,
       (SELECT COUNT(DISTINCT r.friend_id)
          FROM webinar_registrations r
          JOIN visible_webinars w ON w.id = r.webinar_id
         WHERE r.status = 'active') AS registration_people,
       (SELECT COUNT(*)
          FROM webinar_registrations r
          JOIN visible_webinars w ON w.id = r.webinar_id
         WHERE r.status = 'active') AS registration_bookings,
       (SELECT COUNT(DISTINCT v.friend_id)
          FROM webinar_viewers v
          JOIN visible_webinars w ON w.id = v.webinar_id
         WHERE v.cta_clicked_at IS NOT NULL) AS cta_unique_people`,
  ).bind(accountId).first<{
    webinar_count: number;
    active_webinar_count: number;
    registration_people: number;
    registration_bookings: number;
    cta_unique_people: number;
  }>();

  const available = (value: number): WebinarOverviewMetric => ({
    value,
    state: 'available',
    reason: null,
  });
  const unavailable = (reason: string): WebinarOverviewMetric => ({
    value: null,
    state: 'unavailable',
    reason,
  });

  return {
    state: 'partial',
    registrationMode: 'people',
    metrics: {
      webinars: available(row?.webinar_count ?? 0),
      activeWebinars: available(row?.active_webinar_count ?? 0),
      registrations: available(row?.registration_people ?? 0),
      registrationBookings: available(row?.registration_bookings ?? 0),
      viewers: unavailable('実際に見た区間の記録をまだ集計できないため'),
      viewRate: unavailable('視聴人数を取得できないため'),
      averageWatchSeconds: unavailable('実際に見た時間の記録をまだ集計できないため'),
      ctaUniquePeople: available(row?.cta_unique_people ?? 0),
      ctaTotalClicks: unavailable('同じ視聴中の複数クリックを数える記録がないため'),
    },
  };
}

export async function getWebinarById(db: D1Database, id: string): Promise<Webinar | null> {
  return db.prepare('SELECT * FROM webinars WHERE id = ?').bind(id).first<Webinar>();
}

export async function getWebinarBySlug(db: D1Database, slug: string): Promise<Webinar | null> {
  return db.prepare('SELECT * FROM webinars WHERE slug = ?').bind(slug).first<Webinar>();
}

export async function createWebinar(db: D1Database, input: WebinarCreateInput): Promise<Webinar> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO webinars (id, account_id, title, slug, status, video_prefix,
         duration_seconds, schedule_json, cta_json, tag_on_attend, tag_on_cta_click,
         folder_id, publication_starts_at, publication_ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.accountId ?? null, input.title, input.slug, input.status ?? 'draft',
      input.videoPrefix ?? null, input.durationSeconds ?? 0, input.scheduleJson ?? '[]',
      input.ctaJson ?? null, input.tagOnAttend ?? null, input.tagOnCtaClick ?? null,
      input.folderId ?? null, input.publicationStartsAt ?? null, input.publicationEndsAt ?? null,
      now, now,
    )
    .run();
  return (await getWebinarById(db, id))!;
}

export async function updateWebinar(
  db: D1Database,
  id: string,
  patch: Partial<WebinarCreateInput>,
): Promise<Webinar | null> {
  const existing = await getWebinarById(db, id);
  if (!existing) return null;
  await db
    .prepare(
      `UPDATE webinars SET account_id = ?, title = ?, slug = ?, status = ?,
         video_prefix = ?, duration_seconds = ?, schedule_json = ?, cta_json = ?,
         tag_on_attend = ?, tag_on_cta_click = ?, folder_id = ?,
         publication_starts_at = ?, publication_ends_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.accountId !== undefined ? patch.accountId : existing.account_id,
      patch.title ?? existing.title,
      patch.slug ?? existing.slug,
      patch.status ?? existing.status,
      patch.videoPrefix !== undefined ? patch.videoPrefix : existing.video_prefix,
      patch.durationSeconds ?? existing.duration_seconds,
      patch.scheduleJson ?? existing.schedule_json,
      patch.ctaJson !== undefined ? patch.ctaJson : existing.cta_json,
      patch.tagOnAttend !== undefined ? patch.tagOnAttend : existing.tag_on_attend,
      patch.tagOnCtaClick !== undefined ? patch.tagOnCtaClick : existing.tag_on_cta_click,
      patch.folderId !== undefined ? patch.folderId : existing.folder_id,
      patch.publicationStartsAt !== undefined
        ? patch.publicationStartsAt : existing.publication_starts_at,
      patch.publicationEndsAt !== undefined ? patch.publicationEndsAt : existing.publication_ends_at,
      jstNow(), id,
    )
    .run();
  return getWebinarById(db, id);
}

export async function getWebinarEditorSettings(
  db: D1Database,
  webinarId: string,
): Promise<WebinarEditorSettings | null> {
  return db.prepare('SELECT * FROM webinar_editor_settings WHERE webinar_id = ?')
    .bind(webinarId)
    .first<WebinarEditorSettings>();
}

function webinarEditorSnapshot(row: WebinarEditorSettings): string {
  return JSON.stringify({
    deliveryKind: row.delivery_kind,
    viewingCondition: JSON.parse(row.viewing_condition_json),
    publicDescription: row.public_description,
    registrationFormId: row.registration_form_id,
    notificationMessages: JSON.parse(row.notification_messages_json),
    notificationTest: row.notification_test_json ? JSON.parse(row.notification_test_json) : null,
    actionTemplateBody: row.action_template_body,
    missingResultPolicy: row.missing_result_policy,
    publicPageTest: row.public_page_test_json ? JSON.parse(row.public_page_test_json) : null,
  });
}

/**
 * 編集設定を楽観ロック付きで保存する。公開版は webinar_versions に残し、
 * 同じ version の行を上書きしない。
 */
export async function saveWebinarEditorSettings(
  db: D1Database,
  webinarId: string,
  expectedVersion: number,
  patch: WebinarEditorSettingsInput,
): Promise<WebinarEditorSettings | null> {
  const existing = await getWebinarEditorSettings(db, webinarId);
  const now = jstNow();
  if (!existing) {
    if (expectedVersion !== 0) return null;
    await db.prepare(
      `INSERT INTO webinar_editor_settings
         (webinar_id, version, delivery_kind, viewing_condition_json, public_description,
          registration_form_id, notification_messages_json, notification_test_json,
          action_template_body, missing_result_policy, public_page_test_json,
          created_at, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      webinarId,
      patch.deliveryKind ?? 'on_demand',
      JSON.stringify(patch.viewingCondition ?? { kind: 'registered', label: '申込者向け' }),
      patch.publicDescription ?? '',
      patch.registrationFormId ?? null,
      JSON.stringify(patch.notificationMessages ?? {}),
      patch.notificationTest === undefined || patch.notificationTest === null
        ? null : JSON.stringify(patch.notificationTest),
      patch.actionTemplateBody ?? '',
      patch.missingResultPolicy ?? 'escalate',
      patch.publicPageTest === undefined || patch.publicPageTest === null
        ? null : JSON.stringify(patch.publicPageTest),
      now,
      now,
    ).run();
  } else {
    if (existing.version !== expectedVersion) return null;
    const result = await db.prepare(
      `UPDATE webinar_editor_settings
          SET version = version + 1,
              delivery_kind = ?, viewing_condition_json = ?, public_description = ?,
              registration_form_id = ?, notification_messages_json = ?,
              notification_test_json = ?, action_template_body = ?, missing_result_policy = ?,
              public_page_test_json = ?, updated_at = ?
        WHERE webinar_id = ? AND version = ?`,
    ).bind(
      patch.deliveryKind ?? existing.delivery_kind,
      JSON.stringify(patch.viewingCondition ?? JSON.parse(existing.viewing_condition_json)),
      patch.publicDescription ?? existing.public_description,
      patch.registrationFormId !== undefined ? patch.registrationFormId : existing.registration_form_id,
      JSON.stringify(patch.notificationMessages ?? JSON.parse(existing.notification_messages_json)),
      patch.notificationTest !== undefined
        ? (patch.notificationTest === null ? null : JSON.stringify(patch.notificationTest))
        : existing.notification_test_json,
      patch.actionTemplateBody ?? existing.action_template_body,
      patch.missingResultPolicy ?? existing.missing_result_policy,
      patch.publicPageTest !== undefined
        ? (patch.publicPageTest === null ? null : JSON.stringify(patch.publicPageTest))
        : existing.public_page_test_json,
      now,
      webinarId,
      expectedVersion,
    ).run();
    if ((result.meta.changes ?? 0) !== 1) return null;
  }
  const saved = await getWebinarEditorSettings(db, webinarId);
  if (!saved) return null;
  await db.prepare(
    `INSERT INTO webinar_versions
       (id, webinar_id, version, state, snapshot_json, created_at)
     VALUES (?, ?, ?, 'draft', ?, ?)`,
  ).bind(
    crypto.randomUUID(), webinarId, saved.version, webinarEditorSnapshot(saved), now,
  ).run();
  return saved;
}

export async function publishWebinarEditorVersion(
  db: D1Database,
  webinarId: string,
  expectedVersion: number,
): Promise<WebinarEditorSettings | null> {
  const settings = await getWebinarEditorSettings(db, webinarId);
  if (!settings || settings.version !== expectedVersion) return null;
  const now = jstNow();
  await db.batch([
    db.prepare(
      `UPDATE webinar_versions SET state = 'superseded'
       WHERE webinar_id = ? AND state = 'published'`,
    ).bind(webinarId),
    db.prepare(
      `UPDATE webinar_versions SET state = 'published', published_at = ?
       WHERE webinar_id = ? AND version = ?`,
    ).bind(now, webinarId, expectedVersion),
    db.prepare(
      `UPDATE webinar_editor_settings SET published_version = ?, published_at = ?, updated_at = ?
       WHERE webinar_id = ? AND version = ?`,
    ).bind(expectedVersion, now, now, webinarId, expectedVersion),
  ]);
  return getWebinarEditorSettings(db, webinarId);
}

export type WebinarHeartbeatPlayerState =
  | 'playing'
  | 'paused'
  | 'hidden'
  | 'buffering'
  | 'seeking';

export const WEBINAR_HEARTBEAT_PLAYER_STATES: readonly WebinarHeartbeatPlayerState[] = [
  'playing', 'paused', 'hidden', 'buffering', 'seeking',
];

/** heartbeat の送信間隔（秒）。再生中だけ15秒ごとに送る（J #821）。 */
export const WEBINAR_HEARTBEAT_WINDOW_SECONDS = 15;

/** 有効な視聴区間の合計がこの秒数以上で「視聴開始」とする（J #821）。 */
export const WEBINAR_VIEW_START_SECONDS = 30;

/** 離脱・維持率の集計バケット（秒）。設計 J-1 の「いちばん離れた所 12〜15分」に合わせる。 */
export const WEBINAR_RETENTION_BUCKET_SECONDS = 60;

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

export function parseWebinarHeartbeatPlayerState(
  value: unknown,
): WebinarHeartbeatPlayerState | null {
  if (value === undefined || value === null || value === '') return 'playing';
  return (WEBINAR_HEARTBEAT_PLAYER_STATES as readonly string[]).includes(String(value))
    ? (String(value) as WebinarHeartbeatPlayerState)
    : null;
}

async function insertWebinarHeartbeatReject(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number;
    reason: WebinarHeartbeatRejectReason;
    positionSeconds: number;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO webinar_heartbeat_rejects
       (id, webinar_id, friend_id, session_start_at, reason, position_seconds, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.webinarId, input.friendId, input.sessionStartAt,
    input.reason, input.positionSeconds, jstNow(),
  ).run();
}

/**
 * heartbeat を1件受け付ける（J #821）。
 *
 * - 基準はサーバー受信時刻。クライアント申告の時刻は記録だけで判定に使わない。
 * - 再生中（playing）だけ有効な視聴区間を作る。一時停止・非表示・
 *   読み込み待ちの時間は視聴に数えない。
 * - 位置の移動中（seeking）は区間を作らず位置だけ進める（移動の跳びを異常にしない）。
 * - 再生中の位置の進みが「経過時間の2倍」を超えたら異常として除外し、
 *   理由を残す（速度再生は速度ぶんだけ上限を広げる）。
 */
export async function recordWebinarHeartbeat(
  db: D1Database,
  input: WebinarHeartbeatInput,
): Promise<WebinarHeartbeatResult> {
  const receivedAt = Math.floor(input.receivedAtEpoch ?? Date.now() / 1000);
  const rate = input.playbackRate ?? 1;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 4) {
    await insertWebinarHeartbeatReject(db, {
      webinarId: input.webinarId,
      friendId: input.friendId,
      sessionStartAt: input.sessionStartAt,
      reason: 'invalid_rate',
      positionSeconds: input.positionSeconds,
    });
    return { status: 'rejected', reason: 'invalid_rate' };
  }
  const state = parseWebinarHeartbeatPlayerState(input.playerState) ?? 'playing';

  let viewer = await db.prepare(
    `SELECT last_position_seconds, last_heartbeat_at
       FROM webinar_viewers
      WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
  ).bind(input.webinarId, input.friendId, input.sessionStartAt)
    .first<{ last_position_seconds: number; last_heartbeat_at: number | null }>();
  if (!viewer) {
    await db.prepare(
      `INSERT OR IGNORE INTO webinar_viewers
         (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds, last_heartbeat_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL)`,
    ).bind(
      crypto.randomUUID(), input.webinarId, input.friendId,
      input.sessionStartAt, jstNow(),
    ).run();
    viewer = { last_position_seconds: 0, last_heartbeat_at: null };
  }

  const touchHeartbeat = async (position: number | null) => {
    if (position === null) {
      await db.prepare(
        `UPDATE webinar_viewers SET last_heartbeat_at = ?
          WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
      ).bind(receivedAt, input.webinarId, input.friendId, input.sessionStartAt).run();
    } else {
      await db.prepare(
        `UPDATE webinar_viewers
            SET last_position_seconds = MAX(last_position_seconds, ?),
                last_heartbeat_at = ?
          WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
      ).bind(position, receivedAt, input.webinarId, input.friendId, input.sessionStartAt).run();
    }
  };

  // 位置の移動中は跳びが当然なので、異常にせず位置だけ進める。
  if (state === 'seeking') {
    await touchHeartbeat(input.positionSeconds);
    return { status: 'moved' };
  }
  // 一時停止・非表示・読み込み待ちは視聴に数えない。受信時刻だけ進める。
  if (state !== 'playing') {
    await touchHeartbeat(null);
    return { status: 'not_counted' };
  }

  const elapsed = viewer.last_heartbeat_at === null
    ? null
    : Math.max(0, receivedAt - viewer.last_heartbeat_at);
  const delta = input.positionSeconds - viewer.last_position_seconds;
  if (elapsed !== null) {
    const bound = 2 * elapsed * Math.max(1, rate);
    if (delta > bound || delta < -bound) {
      await insertWebinarHeartbeatReject(db, {
        webinarId: input.webinarId,
        friendId: input.friendId,
        sessionStartAt: input.sessionStartAt,
        reason: delta > bound ? 'position_jump' : 'negative_gap',
        positionSeconds: input.positionSeconds,
      });
      // 時刻だけ進め、異常な位置を基準にしない。次回は長い経過で判定する。
      await touchHeartbeat(null);
      return { status: 'rejected', reason: delta > bound ? 'position_jump' : 'negative_gap' };
    }
  }
  await recordWebinarViewSegment(db, input.webinarId, input.friendId, input.sessionStartAt, input.positionSeconds, {
    playbackRate: rate,
    clientAtMs: input.clientAtMs ?? null,
    windowSeconds: WEBINAR_HEARTBEAT_WINDOW_SECONDS,
  });
  await touchHeartbeat(input.positionSeconds);
  return { status: 'recorded' };
}

/** 異常として除外した heartbeat の件数。異常値警告の母数にする。 */
export async function countWebinarHeartbeatRejects(
  db: D1Database,
  webinarId: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM webinar_heartbeat_rejects WHERE webinar_id = ?`,
  ).bind(webinarId).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface WebinarHeartbeatOptions {
  playbackRate?: number | null;
  clientAtMs?: number | null;
  windowSeconds?: number | null;
}

export async function getWebinarViewSegmentCoverage(
  db: D1Database,
  webinarId: string,
): Promise<WebinarViewSegmentCoverage[]> {
  const result = await db.prepare(
    `SELECT start_seconds, end_seconds, COUNT(DISTINCT friend_id) AS viewers
       FROM webinar_view_segments
      WHERE webinar_id = ?
      GROUP BY start_seconds, end_seconds
      ORDER BY start_seconds, end_seconds`,
  ).bind(webinarId).all<WebinarViewSegmentCoverage>();
  return result.results ?? [];
}

/**
 * ハートビート間の実視聴区間を冪等に記録する。
 * 既定の窓は heartbeat の送信間隔（15秒）。5引数の呼び出しは
 * 従来どおり30秒窓で動く（後方互換）。
 */
export async function recordWebinarViewSegment(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
  positionSeconds: number,
  options?: WebinarHeartbeatOptions,
): Promise<void> {
  const windowSeconds = Math.max(1, Math.floor(options?.windowSeconds ?? 30));
  const endSeconds = Math.max(1, Math.floor(positionSeconds));
  const startSeconds = Math.max(0, endSeconds - windowSeconds);
  const idempotencyKey = `${webinarId}:${friendId}:${sessionStartAt}:${startSeconds}:${endSeconds}`;
  const rate = options?.playbackRate ?? 1;
  const clientAtMs = options?.clientAtMs ?? null;
  try {
    await db.prepare(
      `INSERT OR IGNORE INTO webinar_view_segments
         (id, webinar_id, friend_id, session_start_at, start_seconds, end_seconds,
          received_at, idempotency_key, playback_rate, client_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), webinarId, friendId, sessionStartAt,
      startSeconds, endSeconds, jstNow(), idempotencyKey, rate, clientAtMs,
    ).run();
  } catch {
    // 507 より前の DB（列が無い）では従来の8列で入れる。
    await db.prepare(
      `INSERT OR IGNORE INTO webinar_view_segments
         (id, webinar_id, friend_id, session_start_at, start_seconds, end_seconds,
          received_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), webinarId, friendId, sessionStartAt,
      startSeconds, endSeconds, jstNow(), idempotencyKey,
    ).run();
  }
}

/**
 * 重なる区間を束ね、重複時間を足さない合計秒数を返す（J #821）。
 * 同じ区間の再送は呼び出し前に冪等キーで1行になっている前提。
 */
export function mergeWebinarWatchedSeconds(
  intervals: Array<{ start_seconds: number; end_seconds: number }>,
): number {
  const sorted = intervals
    .filter((item) => item.end_seconds > item.start_seconds)
    .sort((a, b) => a.start_seconds - b.start_seconds || a.end_seconds - b.end_seconds);
  let total = 0;
  let cursorStart: number | null = null;
  let cursorEnd = 0;
  for (const item of sorted) {
    if (cursorStart === null || item.start_seconds > cursorEnd) {
      if (cursorStart !== null) total += cursorEnd - cursorStart;
      cursorStart = item.start_seconds;
      cursorEnd = item.end_seconds;
    } else if (item.end_seconds > cursorEnd) {
      cursorEnd = item.end_seconds;
    }
  }
  if (cursorStart !== null) total += cursorEnd - cursorStart;
  return total;
}

/**
 * 視聴開始した人（有効な区間の合計が閾値以上）の人数（J #821）。
 * 一時停止・非表示の時間は区間が無いので数えない。
 */
export async function countWebinarStartedViewers(
  db: D1Database,
  webinarId: string,
  thresholdSeconds = WEBINAR_VIEW_START_SECONDS,
): Promise<number> {
  const { results } = await db.prepare(
    `SELECT friend_id, start_seconds, end_seconds
       FROM webinar_view_segments
      WHERE webinar_id = ?
      ORDER BY friend_id, start_seconds, end_seconds`,
  ).bind(webinarId).all<{ friend_id: string; start_seconds: number; end_seconds: number }>();
  const byFriend = new Map<string, Array<{ start_seconds: number; end_seconds: number }>>();
  for (const row of results ?? []) {
    const list = byFriend.get(row.friend_id) ?? [];
    list.push({ start_seconds: row.start_seconds, end_seconds: row.end_seconds });
    byFriend.set(row.friend_id, list);
  }
  let started = 0;
  for (const intervals of byFriend.values()) {
    if (mergeWebinarWatchedSeconds(intervals) >= thresholdSeconds) started += 1;
  }
  return started;
}

export interface WebinarRetentionPoint {
  at_seconds: number;
  viewers: number;
}

/**
 * 維持率の線の材料（J-1）。各バケットを見ていた人（区間が被る人）の数。
 * 分母は視聴開始した人の数。割合の計算は画面側で行う。
 */
export async function getWebinarRetention(
  db: D1Database,
  webinarId: string,
  bucketSeconds = WEBINAR_RETENTION_BUCKET_SECONDS,
): Promise<{ bucketSeconds: number; started: number; points: WebinarRetentionPoint[] }> {
  const { results } = await db.prepare(
    `SELECT friend_id, start_seconds, end_seconds
       FROM webinar_view_segments
      WHERE webinar_id = ?`,
  ).bind(webinarId).all<{ friend_id: string; start_seconds: number; end_seconds: number }>();
  const rows = results ?? [];
  const byFriend = new Map<string, Array<{ start_seconds: number; end_seconds: number }>>();
  for (const row of rows) {
    const list = byFriend.get(row.friend_id) ?? [];
    list.push({ start_seconds: row.start_seconds, end_seconds: row.end_seconds });
    byFriend.set(row.friend_id, list);
  }
  let started = 0;
  const watching = new Map<number, Set<string>>();
  let maxEnd = 0;
  for (const [friendId, intervals] of byFriend) {
    if (mergeWebinarWatchedSeconds(intervals) >= WEBINAR_VIEW_START_SECONDS) started += 1;
    const merged: Array<{ start: number; end: number }> = [];
    const sorted = intervals
      .filter((item) => item.end_seconds > item.start_seconds)
      .sort((a, b) => a.start_seconds - b.start_seconds);
    for (const item of sorted) {
      const last = merged[merged.length - 1];
      if (!last || item.start_seconds > last.end) merged.push({ start: item.start_seconds, end: item.end_seconds });
      else if (item.end_seconds > last.end) last.end = item.end_seconds;
    }
    for (const span of merged) {
      maxEnd = Math.max(maxEnd, span.end);
      const fromBucket = Math.floor(span.start / bucketSeconds);
      const toBucket = Math.floor((span.end - 1) / bucketSeconds);
      for (let bucket = fromBucket; bucket <= toBucket; bucket += 1) {
        const set = watching.get(bucket) ?? new Set<string>();
        set.add(friendId);
        watching.set(bucket, set);
      }
    }
  }
  const bucketCount = maxEnd > 0 ? Math.floor((maxEnd - 1) / bucketSeconds) + 1 : 0;
  const points: WebinarRetentionPoint[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    points.push({ at_seconds: bucket * bucketSeconds, viewers: watching.get(bucket)?.size ?? 0 });
  }
  return { bucketSeconds, started, points };
}

/**
 * 申込者∪入場者を friend 単位で返す。入場時刻が開催終了を過ぎた行は
 * 録画（replay）視聴としてライブと区別する。`options.classification` で
 * 未参加／途中離脱／完了／計測外に絞り込める。`measured = false`
 * （外部動画などで個人の視聴を取得できない）ときは分類不能を意味し、
 * 全員「計測外」になる——視聴データが無い人を未視聴と断定しない。
 */
export async function getWebinarParticipantOperations(
  db: D1Database,
  webinarId: string,
  limit = 100,
  offset = 0,
  options?: WebinarParticipantQueryOptions,
): Promise<WebinarParticipantOperation[]> {
  const durationSeconds = Math.max(0, options?.durationSeconds ?? 0);
  // 動画長が不明なら入場時刻だけでは録画と断定できない。境界を実質無限大にして
  // 全てライブ扱いにし、根拠のない録画判定を出さない。
  const replayBoundarySeconds = durationSeconds > 0 ? durationSeconds : 2_147_483_647;
  const measured = options?.measured ?? true;
  const classification = options?.classification ?? null;
  const threshold = Math.max(0, options?.completionThresholdSeconds ?? 0);

  const binds: unknown[] = [
    webinarId, webinarId,
    webinarId, webinarId, webinarId, webinarId, webinarId,
    webinarId,
    webinarId,
    webinarId, replayBoundarySeconds,
    webinarId, replayBoundarySeconds,
    replayBoundarySeconds, webinarId,
    webinarId, webinarId,
  ];
  let filterSql = '';
  if (classification === 'unmeasured') {
    // 計測可能なウェビナーに「計測外」の人はいない。
    if (measured) filterSql = 'WHERE 1 = 0';
  } else if (!measured) {
    // 計測不能のウェビナーでは未参加・離脱・完了を断定しない。
    if (classification) filterSql = 'WHERE 1 = 0';
  } else if (classification === 'unviewed') {
    filterSql = 'WHERE sessions = 0';
  } else if (classification === 'dropped_off') {
    filterSql = 'WHERE sessions > 0 AND max_watched_seconds < ?';
    binds.push(threshold);
  } else if (classification === 'completed') {
    filterSql = 'WHERE max_watched_seconds >= ?';
    binds.push(threshold);
  }
  binds.push(limit, offset);

  const result = await db.prepare(
    `WITH identities AS (
       SELECT friend_id FROM webinar_registrations WHERE webinar_id = ? AND status = 'active'
       UNION
       SELECT friend_id FROM webinar_viewers WHERE webinar_id = ?
     )
     SELECT * FROM (
       SELECT i.friend_id,
              f.display_name AS friend_name,
              f.picture_url,
              (SELECT COUNT(*) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id) AS sessions,
              COALESCE((SELECT MIN(v.joined_at) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id), '') AS first_joined_at,
              COALESCE((SELECT MAX(v.joined_at) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id), '') AS latest_joined_at,
              COALESCE((SELECT MAX(v.last_position_seconds) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id), 0) AS max_watched_seconds,
              (SELECT MAX(v.cta_clicked_at) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id) AS cta_clicked_at,
              EXISTS (
                SELECT 1 FROM webinar_registrations r
                WHERE r.webinar_id = ? AND r.friend_id = i.friend_id AND r.status = 'active'
              ) AS registered,
              (SELECT MAX(fs.created_at)
                 FROM form_submissions fs
                 JOIN webinar_ctas wc ON wc.form_id = fs.form_id
                WHERE wc.webinar_id = ? AND fs.friend_id = i.friend_id) AS form_submitted_at,
              (SELECT COUNT(*) FROM webinar_viewers v
                WHERE v.webinar_id = ? AND v.friend_id = i.friend_id
                  AND unixepoch(v.joined_at) < v.session_start_at + ?) AS live_sessions,
              (SELECT COUNT(*) FROM webinar_viewers v
                WHERE v.webinar_id = ? AND v.friend_id = i.friend_id
                  AND unixepoch(v.joined_at) >= v.session_start_at + ?) AS replay_sessions,
              (SELECT CASE WHEN unixepoch(v.joined_at) >= v.session_start_at + ?
                        THEN 'replay' ELSE 'live' END
                 FROM webinar_viewers v
                WHERE v.webinar_id = ? AND v.friend_id = i.friend_id
                ORDER BY v.joined_at DESC LIMIT 1) AS last_join_kind,
              (SELECT ae.status FROM webinar_action_executions ae
                WHERE ae.webinar_id = ? AND ae.friend_id = i.friend_id
                ORDER BY ae.updated_at DESC LIMIT 1) AS action_status,
              (SELECT ae.last_error FROM webinar_action_executions ae
                WHERE ae.webinar_id = ? AND ae.friend_id = i.friend_id
                ORDER BY ae.updated_at DESC LIMIT 1) AS action_error
         FROM identities i
         LEFT JOIN friends f ON f.id = i.friend_id
     )
     ${filterSql}
     ORDER BY latest_joined_at DESC, friend_id
     LIMIT ? OFFSET ?`,
  ).bind(...binds).all<Omit<WebinarParticipantOperation, 'integration_status'>>();
  return (result.results ?? []).map((row) => ({
    ...row,
    integration_status: row.action_status === 'succeeded'
      ? 'completed'
      : row.action_status === 'permanent_failed'
        ? 'needs_attention'
        : 'pending',
  }));
}

export async function getWebinarMonitoringSummary(
  db: D1Database,
  webinarId: string,
): Promise<WebinarMonitoringSummary> {
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM webinar_notification_jobs
         WHERE webinar_id = ? AND status = 'permanent_failed') AS notification_failures,
       (SELECT COUNT(*) FROM (
          SELECT friend_id, session_start_at
            FROM webinar_registrations
           WHERE webinar_id = ? AND status = 'active'
           GROUP BY friend_id, session_start_at HAVING COUNT(*) > 1
        )) AS duplicate_registrations,
       0 AS view_segment_failures,
       (SELECT COUNT(*) FROM webinar_action_executions
         WHERE webinar_id = ? AND status = 'permanent_failed') AS action_failures`,
  ).bind(webinarId, webinarId, webinarId).first<WebinarMonitoringSummary>();
  return row ?? {
    notification_failures: 0,
    duplicate_registrations: 0,
    view_segment_failures: 0,
    action_failures: 0,
  };
}

export async function getWebinarPublicAccount(
  db: D1Database,
  accountId: string | null,
): Promise<{ id: string; name: string; liff_id: string | null } | null> {
  if (!accountId) return null;
  return db.prepare('SELECT id, name, liff_id FROM line_accounts WHERE id = ? AND archived_at IS NULL')
    .bind(accountId)
    .first<{ id: string; name: string; liff_id: string | null }>();
}

/**
 * ウェビナーを一覧から外す。申込・視聴・CTA・分析の記録は消さない。
 *
 * V6では物理削除を禁止しているため、従来のDELETE経路もこの更新へ寄せる。
 */
export async function archiveWebinar(db: D1Database, id: string): Promise<Webinar | null> {
  const existing = await getWebinarById(db, id);
  if (!existing) return null;
  await db
    .prepare("UPDATE webinars SET status = 'archived', updated_at = ? WHERE id = ?")
    .bind(jstNow(), id)
    .run();
  return getWebinarById(db, id);
}

export async function getWebinarActions(db: D1Database, webinarId: string): Promise<WebinarAction[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM webinar_actions
       WHERE webinar_id = ? AND enabled = 1
       ORDER BY trigger, position`,
    )
    .bind(webinarId)
    .all<WebinarAction>();
  return results ?? [];
}

/**
 * 下書きのアクション一式を置き換える。実行履歴が参照する旧版は消さず、
 * 無効化して新版を追加する。
 */
export async function replaceWebinarActions(
  db: D1Database,
  webinarId: string,
  actions: WebinarActionInput[],
): Promise<WebinarAction[]> {
  const now = jstNow();
  // 有効な行をすべて外した後でも版番号を巻き戻さない。旧版との UNIQUE
  // 衝突を避けるだけでなく、実行履歴から設定変更の順序を追えるようにする。
  const latest = await db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM webinar_actions WHERE webinar_id = ?')
    .bind(webinarId)
    .first<{ version: number }>();
  const nextVersion = Number(latest?.version ?? 0) + 1;
  const statements = [
    db.prepare('UPDATE webinar_actions SET enabled = 0, updated_at = ? WHERE webinar_id = ? AND enabled = 1')
      .bind(now, webinarId),
    ...actions.map((action, position) => db.prepare(
      `INSERT INTO webinar_actions
         (id, webinar_id, trigger, action_type, config_json, position, version, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      crypto.randomUUID(), webinarId, action.trigger, action.actionType,
      JSON.stringify(action.config), position, nextVersion, now, now,
    )),
  ];
  await db.batch(statements);
  return getWebinarActions(db, webinarId);
}

/**
 * アクションが参照する設定（タグ・シナリオ・テンプレート・送信Webhook・
 * リッチメニューページ）が、対象ウェビナーのアカウント内で実在し
 * 使える状態かを調べる。参照を持たない種類（remove_rich_menu）は常に有効。
 *
 * 別アカウントの設定は「存在しない」と同じ扱いにして、呼び出し側が
 * 向こう側にそのIDがあるかを返り値から読み取れないようにする。
 * 検査と保存の間で参照が消えても安全側に止まれるよう、保存前だけでなく
 * 公開前の検証からも同じ関数を使う。返り値は参照先が無効だった
 * アクションの件数。0 ならすべて有効。
 */
export async function countInvalidWebinarActionReferences(
  db: D1Database,
  accountId: string | null,
  actions: ReadonlyArray<Pick<WebinarActionInput, 'actionType' | 'config'>>,
): Promise<number> {
  let invalid = 0;
  for (const action of actions) {
    if (!await webinarActionReferenceValid(db, accountId, action)) invalid += 1;
  }
  return invalid;
}

async function webinarActionReferenceValid(
  db: D1Database,
  accountId: string | null,
  action: Pick<WebinarActionInput, 'actionType' | 'config'>,
): Promise<boolean> {
  const ref = (key: string): string | null => {
    const value = action.config[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const exists = async (sql: string, id: string): Promise<boolean> =>
    Boolean(await db.prepare(sql).bind(id, accountId).first());
  switch (action.actionType) {
    case 'add_tag':
    case 'remove_tag': {
      const tagId = ref('tagId');
      return tagId !== null && await exists(
        `SELECT id FROM tags WHERE id = ? AND line_account_id = ? AND status = 'active'`,
        tagId,
      );
    }
    case 'start_scenario':
    case 'stop_scenario':
    case 'resume_scenario': {
      const scenarioId = ref('scenarioId');
      return scenarioId !== null && await exists(
        'SELECT id FROM scenarios WHERE id = ? AND line_account_id = ?',
        scenarioId,
      );
    }
    case 'send_message': {
      const templateId = ref('templateId');
      return templateId !== null && await exists(
        'SELECT id FROM templates WHERE id = ? AND line_account_id = ?',
        templateId,
      );
    }
    case 'send_webhook': {
      const webhookId = ref('webhookId');
      return webhookId !== null && await exists(
        'SELECT id FROM outgoing_webhooks WHERE id = ? AND line_account_id = ? AND is_active = 1 AND deleted_at IS NULL',
        webhookId,
      );
    }
    case 'switch_rich_menu': {
      const pageId = ref('richMenuPageId');
      return pageId !== null && await exists(
        `SELECT p.id FROM rich_menu_pages p
          JOIN rich_menu_groups g ON g.id = p.group_id
         WHERE p.id = ? AND g.account_id = ? AND g.status = 'published'`,
        pageId,
      );
    }
    case 'remove_rich_menu':
      return true;
    default:
      return false;
  }
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

/**
 * 視聴後アクションの実行記録を冪等キーで1件だけ残す。
 * 既に同じキーの記録がある再送は何も書かず false を返す。
 */
export async function insertWebinarActionExecutionIgnore(
  db: D1Database,
  input: WebinarActionExecutionInput,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_action_executions
         (id, webinar_action_id, webinar_id, friend_id, session_start_at,
          trigger, status, attempt, idempotency_key, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), input.webinarActionId, input.webinarId, input.friendId,
      input.sessionStartAt, input.trigger, input.status, input.idempotencyKey,
      input.lastError ?? null, now, now,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** 実行記録の結末を残す。冪等キーで1件だけ更新する。 */
export async function finishWebinarActionExecution(
  db: D1Database,
  idempotencyKey: string,
  status: WebinarActionExecutionStatus,
  lastError: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE webinar_action_executions
          SET status = ?, last_error = ?, updated_at = ?
        WHERE idempotency_key = ?`,
    )
    .bind(status, lastError, jstNow(), idempotencyKey)
    .run();
}

export async function getWebinarComments(
  db: D1Database,
  webinarId: string,
): Promise<WebinarComment[]> {
  const { results } = await db
    .prepare('SELECT * FROM webinar_comments WHERE webinar_id = ? ORDER BY at_seconds ASC')
    .bind(webinarId)
    .all<WebinarComment>();
  return results ?? [];
}

export async function replaceWebinarComments(
  db: D1Database,
  webinarId: string,
  comments: Array<{ atSeconds: number; authorName: string; body: string }>,
): Promise<number> {
  const now = jstNow();
  const stmts = [
    db.prepare('DELETE FROM webinar_comments WHERE webinar_id = ?').bind(webinarId),
    ...comments.map((cm) =>
      db
        .prepare(
          `INSERT INTO webinar_comments (id, webinar_id, at_seconds, author_name, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), webinarId, cm.atSeconds, cm.authorName, cm.body, now),
    ),
  ];
  await db.batch(stmts);
  return comments.length;
}

export async function upsertWebinarViewer(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<{ firstJoin: boolean }> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_viewers
         (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .bind(crypto.randomUUID(), webinarId, friendId, sessionStartAt, jstNow())
    .run();
  return { firstJoin: (result.meta?.changes ?? 0) > 0 };
}

export async function updateWebinarViewerPosition(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
  positionSeconds: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE webinar_viewers
       SET last_position_seconds = MAX(last_position_seconds, ?)
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(positionSeconds, webinarId, friendId, sessionStartAt)
    .run();
}

export async function recordWebinarCtaClick(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE webinar_viewers
       SET cta_clicked_at = COALESCE(cta_clicked_at, ?)
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(jstNow(), webinarId, friendId, sessionStartAt)
    .run();
}

/**
 * CTA→フォームの途中離脱を friend 単位で計測する。
 * INSERT OR IGNORE により再入場・連打・React の再描画でも重複計上しない。
 */
export async function recordWebinarFunnelEvent(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number;
    eventType: WebinarFunnelEventType;
    ctaId?: string | null;
    formId?: string | null;
    fieldName?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_funnel_events
         (id, webinar_id, friend_id, session_start_at, event_type,
          cta_id, form_id, field_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.webinarId,
      input.friendId,
      input.sessionStartAt,
      input.eventType,
      input.ctaId ?? '',
      input.formId ?? '',
      input.fieldName ?? '',
      jstNow(),
    )
    .run();
}

export async function getWebinarFormFunnelStats(
  db: D1Database,
  webinarId: string,
): Promise<WebinarFormFunnelStats> {
  const [summary, fields] = await Promise.all([
    db
      .prepare(
        `WITH config AS (
           SELECT enabled_at FROM webinar_followup_configs WHERE webinar_id = ?
         ), first_cta AS (
           SELECT MIN(at_seconds) AS at_seconds FROM webinar_ctas WHERE webinar_id = ?
         ), tracked_forms AS (
           SELECT DISTINCT form_id FROM webinar_ctas
           WHERE webinar_id = ? AND form_id IS NOT NULL
         )
         SELECT
           (SELECT COUNT(DISTINCT v.friend_id)
            FROM webinar_viewers v, config, first_cta
            WHERE v.webinar_id = ?
              AND datetime(v.joined_at) >= datetime(config.enabled_at)
              AND v.last_position_seconds >= first_cta.at_seconds) AS cta_impressions,
           (SELECT COUNT(DISTINCT v.friend_id)
            FROM webinar_viewers v, config
            WHERE v.webinar_id = ? AND v.cta_clicked_at IS NOT NULL
              AND datetime(v.cta_clicked_at) >= datetime(config.enabled_at)) AS cta_clicks,
           (SELECT COUNT(DISTINCT fo.friend_id)
            FROM form_opens fo, config
            WHERE fo.form_id IN (SELECT form_id FROM tracked_forms)
              AND fo.friend_id IS NOT NULL
              AND datetime(fo.opened_at) >= datetime(config.enabled_at)) AS form_opens,
           (SELECT COUNT(DISTINCT e.friend_id) FROM webinar_funnel_events e
            WHERE e.webinar_id = ? AND e.event_type = 'form_start') AS form_starts,
           (SELECT COUNT(DISTINCT e.friend_id) FROM webinar_funnel_events e
            WHERE e.webinar_id = ? AND e.event_type = 'submit_attempt') AS submit_attempts,
           (SELECT COUNT(DISTINCT fs.friend_id)
            FROM form_submissions fs, config
            WHERE fs.form_id IN (SELECT form_id FROM tracked_forms)
              AND datetime(fs.created_at) >= datetime(config.enabled_at)) AS submit_successes,
           (SELECT COUNT(DISTINCT e.friend_id) FROM webinar_funnel_events e
            WHERE e.webinar_id = ? AND e.event_type = 'submit_error') AS submit_errors`,
      )
      .bind(
        webinarId, webinarId, webinarId, webinarId, webinarId,
        webinarId, webinarId, webinarId,
      )
      .first<Omit<WebinarFormFunnelStats, 'field_completions'>>(),
    db
      .prepare(
        `SELECT field_name, COUNT(DISTINCT friend_id) AS users
         FROM webinar_funnel_events
         WHERE webinar_id = ? AND event_type = 'field_complete' AND field_name <> ''
         GROUP BY field_name
         ORDER BY users DESC, field_name ASC`,
      )
      .bind(webinarId)
      .all<{ field_name: string; users: number }>(),
  ]);
  return {
    cta_impressions: summary?.cta_impressions ?? 0,
    cta_clicks: summary?.cta_clicks ?? 0,
    form_opens: summary?.form_opens ?? 0,
    form_starts: summary?.form_starts ?? 0,
    submit_attempts: summary?.submit_attempts ?? 0,
    submit_successes: summary?.submit_successes ?? 0,
    submit_errors: summary?.submit_errors ?? 0,
    field_completions: fields.results ?? [],
  };
}

export async function insertWebinarUserComment(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number;
    atSeconds: number;
    body: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO webinar_user_comments
         (id, webinar_id, friend_id, session_start_at, at_seconds, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), input.webinarId, input.friendId, input.sessionStartAt,
      input.atSeconds, input.body, jstNow(),
    )
    .run();
}

export async function countSessionUserComments(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM webinar_user_comments
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(webinarId, friendId, sessionStartAt)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getWebinarUserComments(
  db: D1Database,
  webinarId: string,
  limit = 200,
): Promise<WebinarUserComment[]> {
  const { results } = await db
    .prepare(
      `SELECT wuc.*, f.display_name AS friend_name
              , f.picture_url
       FROM webinar_user_comments wuc
       LEFT JOIN friends f ON f.id = wuc.friend_id
       WHERE wuc.webinar_id = ?
       ORDER BY wuc.created_at DESC, wuc.id DESC LIMIT ?`,
    )
    .bind(webinarId, limit)
    .all<WebinarUserComment>();
  return results ?? [];
}

export async function getWebinarSessionStats(
  db: D1Database,
  webinarId: string,
): Promise<WebinarSessionStat[]> {
  const { results } = await db
    .prepare(
      `SELECT session_start_at,
              COUNT(*) AS viewers,
              CAST(AVG(last_position_seconds) AS INTEGER) AS avg_watched_seconds,
              SUM(CASE WHEN cta_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS cta_clicks
       FROM webinar_viewers
       WHERE webinar_id = ?
       GROUP BY session_start_at
       ORDER BY session_start_at DESC`,
    )
    .bind(webinarId)
    .all<WebinarSessionStat>();
  return results ?? [];
}

/**
 * 離脱位置分布（J #821）。
 * 離脱の位置＝最後の有効な区間の終わり。最後に報告された位置
 * （last_position_seconds）では決めつけない。区間が無い人
 * （見ていない・異常だけの人）は数えない。
 */
export async function getWebinarDropoff(
  db: D1Database,
  webinarId: string,
  bucketSeconds = WEBINAR_RETENTION_BUCKET_SECONDS,
): Promise<Array<{ bucket_start: number; viewers: number }>> {
  const { results } = await db
    .prepare(
      `SELECT friend_id, MAX(end_seconds) AS last_end
         FROM webinar_view_segments
        WHERE webinar_id = ?
        GROUP BY friend_id`,
    )
    .bind(webinarId)
    .all<{ friend_id: string; last_end: number }>();
  const buckets = new Map<number, number>();
  for (const row of results ?? []) {
    const end = Math.max(1, Math.floor(row.last_end));
    const bucket = Math.floor((end - 1) / bucketSeconds) * bucketSeconds;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket_start, viewers]) => ({ bucket_start, viewers }));
}

/** 参加者を friend 単位にまとめる。再入場・複数セッションは1人として表示する。 */
export async function getWebinarParticipantStats(
  db: D1Database,
  webinarId: string,
  limit = 200,
): Promise<WebinarParticipantStat[]> {
  const { results } = await db
    .prepare(
      `SELECT v.friend_id,
              f.display_name AS friend_name,
              f.picture_url,
              COUNT(*) AS sessions,
              MIN(v.joined_at) AS first_joined_at,
              MAX(v.joined_at) AS latest_joined_at,
              MAX(v.last_position_seconds) AS max_watched_seconds,
              MAX(v.cta_clicked_at) AS cta_clicked_at,
              CASE WHEN EXISTS (
                SELECT 1 FROM webinar_registrations r
                WHERE r.webinar_id = v.webinar_id AND r.friend_id = v.friend_id
              ) THEN 1 ELSE 0 END AS registered,
              (
                SELECT MAX(fs.created_at)
                FROM form_submissions fs
                JOIN webinar_ctas wc ON wc.form_id = fs.form_id
                JOIN webinars wf ON wf.id = wc.webinar_id
                WHERE wc.webinar_id = v.webinar_id
                  AND fs.friend_id = v.friend_id
                  AND fs.created_at >= wf.created_at
              ) AS form_submitted_at
       FROM webinar_viewers v
       LEFT JOIN friends f ON f.id = v.friend_id
       WHERE v.webinar_id = ?
       GROUP BY v.webinar_id, v.friend_id, f.display_name, f.picture_url
       ORDER BY latest_joined_at DESC
       LIMIT ?`,
    )
    .bind(webinarId, limit)
    .all<WebinarParticipantStat>();
  return results ?? [];
}

/** KPI は全参加者で集計し、顔写真付き一覧の表示件数に左右されないようにする。 */
export async function getWebinarAnalyticsSummary(
  db: D1Database,
  webinarId: string,
  completionThresholdSeconds: number,
): Promise<WebinarAnalyticsSummaryRow> {
  const row = await db
    .prepare(
      `WITH viewer_rollup AS (
         SELECT friend_id,
                MAX(last_position_seconds) AS max_watched_seconds,
                MAX(CASE WHEN cta_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
         FROM webinar_viewers WHERE webinar_id = ? GROUP BY friend_id
       ), form_submitters AS (
         SELECT DISTINCT fs.friend_id
         FROM form_submissions fs
         JOIN webinar_ctas wc ON wc.form_id = fs.form_id
         JOIN webinars w ON w.id = wc.webinar_id
         WHERE wc.webinar_id = ? AND fs.created_at >= w.created_at
       )
       SELECT
         (SELECT COUNT(DISTINCT friend_id) FROM webinar_registrations
          WHERE webinar_id = ?) AS reservations,
         COUNT(*) AS viewers,
         COALESCE(SUM(CASE WHEN EXISTS (
           SELECT 1 FROM webinar_registrations r
           WHERE r.webinar_id = ? AND r.friend_id = vr.friend_id
         ) THEN 1 ELSE 0 END), 0) AS registered_and_joined,
         COALESCE(SUM(CASE WHEN vr.max_watched_seconds >= 300 THEN 1 ELSE 0 END), 0) AS watched_5m,
         COALESCE(SUM(CASE WHEN vr.max_watched_seconds >= 900 THEN 1 ELSE 0 END), 0) AS watched_15m,
         COALESCE(SUM(CASE WHEN vr.max_watched_seconds >= ? THEN 1 ELSE 0 END), 0) AS completed,
         COALESCE(CAST(AVG(vr.max_watched_seconds) AS INTEGER), 0) AS avg_watched_seconds,
         COALESCE(SUM(vr.clicked), 0) AS cta_clicks,
         COALESCE(SUM(CASE WHEN fs.friend_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS form_submissions
       FROM viewer_rollup vr
       LEFT JOIN form_submitters fs ON fs.friend_id = vr.friend_id`,
    )
    .bind(
      webinarId,
      webinarId,
      webinarId,
      webinarId,
      completionThresholdSeconds,
    )
    .first<WebinarAnalyticsSummaryRow>();
  return row ?? {
    reservations: 0,
    viewers: 0,
    registered_and_joined: 0,
    watched_5m: 0,
    watched_15m: 0,
    completed: 0,
    avg_watched_seconds: 0,
    cta_clicks: 0,
    form_submissions: 0,
  };
}

/** 日別の予約→参加→CTA→フォーム推移。日本時間の保存文字列を日付で集計する。 */
export async function getWebinarDailyStats(
  db: D1Database,
  webinarId: string,
): Promise<WebinarDailyStat[]> {
  const { results } = await db
    .prepare(
      `WITH regs AS (
         SELECT friend_id, created_at FROM webinar_registrations WHERE webinar_id = ?
       ), views AS (
         SELECT friend_id, joined_at, cta_clicked_at FROM webinar_viewers WHERE webinar_id = ?
       ), submissions AS (
         SELECT fs.friend_id, fs.created_at
         FROM form_submissions fs
         JOIN webinar_ctas wc ON wc.form_id = fs.form_id
         JOIN webinars w ON w.id = wc.webinar_id
         WHERE wc.webinar_id = ? AND fs.created_at >= w.created_at
       ), dates AS (
         SELECT substr(created_at, 1, 10) AS stat_date FROM regs
         UNION SELECT substr(joined_at, 1, 10) FROM views
         UNION SELECT substr(cta_clicked_at, 1, 10) FROM views WHERE cta_clicked_at IS NOT NULL
         UNION SELECT substr(created_at, 1, 10) FROM submissions
       )
       SELECT d.stat_date,
              (SELECT COUNT(DISTINCT friend_id) FROM regs
               WHERE substr(created_at, 1, 10) = d.stat_date) AS reservations,
              (SELECT COUNT(DISTINCT friend_id) FROM views
               WHERE substr(joined_at, 1, 10) = d.stat_date) AS viewers,
              (SELECT COUNT(DISTINCT friend_id) FROM views
               WHERE substr(cta_clicked_at, 1, 10) = d.stat_date) AS cta_clicks,
              (SELECT COUNT(DISTINCT friend_id) FROM submissions
               WHERE substr(created_at, 1, 10) = d.stat_date) AS form_submissions
       FROM dates d
       WHERE d.stat_date IS NOT NULL AND d.stat_date <> ''
       ORDER BY d.stat_date ASC`,
    )
    .bind(webinarId, webinarId, webinarId)
    .all<WebinarDailyStat>();
  return results ?? [];
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

export async function getWebinarCtas(
  db: D1Database,
  webinarId: string,
): Promise<WebinarCta[]> {
  const { results } = await db
    .prepare('SELECT * FROM webinar_ctas WHERE webinar_id = ? ORDER BY at_seconds ASC')
    .bind(webinarId)
    .all<WebinarCta>();
  return results ?? [];
}

export async function replaceWebinarCtas(
  db: D1Database,
  webinarId: string,
  ctas: Array<{
    atSeconds: number;
    kind: 'form' | 'url';
    title: string;
    body: string | null;
    buttonLabel: string;
    autoOpen: boolean;
    formId: string | null;
    url: string | null;
  }>,
): Promise<number> {
  const now = jstNow();
  const stmts = [
    db.prepare('DELETE FROM webinar_ctas WHERE webinar_id = ?').bind(webinarId),
    ...ctas.map((cta) =>
      db
        .prepare(
          `INSERT INTO webinar_ctas
             (id, webinar_id, at_seconds, kind, title, body, button_label, auto_open,
              form_id, url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(), webinarId, cta.atSeconds, cta.kind, cta.title, cta.body,
          cta.buttonLabel, cta.autoOpen ? 1 : 0, cta.formId, cta.url, now, now,
        ),
    ),
  ];
  await db.batch(stmts);
  return ctas.length;
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

/** 予約を upsert する (同一 friend×セッションは冪等) */
export async function upsertWebinarRegistration(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_registrations
         (id, webinar_id, friend_id, session_start_at, notified_at, created_at, status, cancelled_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'active', NULL)`,
    )
    .bind(crypto.randomUUID(), webinarId, friendId, sessionStartAt, jstNow())
    .run();
}

/** friend の未来セッション予約 (直近1件) */
export async function getUpcomingWebinarRegistration(
  db: D1Database,
  webinarId: string,
  friendId: string,
  nowEpochSeconds: number,
): Promise<WebinarRegistration | null> {
  return db
    .prepare(
      `SELECT * FROM webinar_registrations
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at > ? AND status = 'active'
       ORDER BY session_start_at ASC LIMIT 1`,
    )
    .bind(webinarId, friendId, nowEpochSeconds)
    .first<WebinarRegistration>();
}

/** 特定セッションへの予約行 (ライブ中の本人入場判定用) */
export async function getWebinarRegistration(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<WebinarRegistration | null> {
  return db
    .prepare(
      `SELECT * FROM webinar_registrations
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ? AND status = 'active'`,
    )
    .bind(webinarId, friendId, sessionStartAt)
    .first<WebinarRegistration>();
}

/**
 * An authenticated friend was shown the session picker.
 * INSERT OR IGNORE anchors the follow-up delay to the first real visit and
 * prevents reloads/re-renders from postponing the follow-up indefinitely.
 */
export async function recordWebinarPickerOpen(
  db: D1Database,
  webinarId: string,
  friendId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_picker_opens
         (id, webinar_id, friend_id, opened_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), webinarId, friendId, jstNow())
    .run();
}

/** 開始 leadSeconds 前〜開始後 (セッション継続中) の未通知予約 */
export async function getDueWebinarRegistrations(
  db: D1Database,
  nowEpochSeconds: number,
  leadSeconds: number,
  limit = 100,
): Promise<Array<WebinarRegistration & { slug: string; title: string; account_id: string | null; duration_seconds: number }>> {
  const { results } = await db
    .prepare(
      `SELECT r.*, w.slug, w.title, w.account_id, w.duration_seconds
       FROM webinar_registrations r
       JOIN webinars w ON w.id = r.webinar_id
       WHERE r.notified_at IS NULL
         AND r.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM webinar_notification_settings ns WHERE ns.webinar_id = r.webinar_id
         )
         AND w.status = 'active'
         AND r.session_start_at <= ?
         AND r.session_start_at + w.duration_seconds > ?
       ORDER BY r.session_start_at ASC
       LIMIT ?`,
    )
    .bind(nowEpochSeconds + leadSeconds, nowEpochSeconds, limit)
    .all<WebinarRegistration & { slug: string; title: string; account_id: string | null; duration_seconds: number }>();
  return results ?? [];
}

/** 通知済みマーク。未通知の場合のみ更新し、更新できたら true (二重送信ガード) */
export async function markWebinarRegistrationNotified(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE webinar_registrations SET notified_at = ? WHERE id = ? AND notified_at IS NULL`,
    )
    .bind(jstNow(), id)
    .run();
  return (res.meta.changes ?? 0) > 0;
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

/** 動画の準備の段（N）。検査 → 変換 → 配信の形 → 表紙。 */
export const WEBINAR_VIDEO_STAGES: readonly WebinarVideoStage[] = [
  'uploaded', 'inspecting', 'converting', 'packaging', 'thumbnail', 'ready',
];

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

/** 動画は終了から90日で消す。ただし使っている間は消さない（N）。 */
export const WEBINAR_VIDEO_RETENTION_DAYS = 90;

export async function getWebinarVideoAsset(
  db: D1Database,
  webinarId: string,
): Promise<WebinarVideoAsset | null> {
  return db.prepare(
    `SELECT * FROM webinar_video_assets WHERE webinar_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(webinarId).first<WebinarVideoAsset>();
}

/**
 * 動画の段を進める。前の段に戻さない（failed はどの段からでも行ける）。
 * 進められない段には null を返す。
 */
export async function advanceWebinarVideoAsset(
  db: D1Database,
  webinarId: string,
  stage: WebinarVideoStage,
  options?: { errorCode?: string | null; durationSeconds?: number | null; checksum?: string | null },
): Promise<WebinarVideoAsset | null> {
  const now = jstNow();
  const current = await getWebinarVideoAsset(db, webinarId);
  if (!current) {
    if (stage !== 'uploaded') return null;
    await db.prepare(
      `INSERT INTO webinar_video_assets
         (id, webinar_id, stage, provider, duration_seconds, checksum, error_code, created_at, updated_at)
       VALUES (?, ?, 'uploaded', 'r2_hls', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(), webinarId, options?.durationSeconds ?? 0,
      options?.checksum ?? null, now, now,
    ).run();
    return getWebinarVideoAsset(db, webinarId);
  }
  const order = (s: string): number => {
    if (s === 'failed') return -1;
    return WEBINAR_VIDEO_STAGES.indexOf(s as WebinarVideoStage);
  };
  const next = order(stage);
  // failed はどこからでも行ける。ready の後は変えない（作り直しは新規の資産）。
  if (stage === 'failed' ? current.stage === 'failed' : (next !== order(current.stage) + 1)) {
    return null;
  }
  await db.prepare(
    `UPDATE webinar_video_assets
        SET stage = ?, error_code = COALESCE(?, error_code),
            duration_seconds = COALESCE(?, duration_seconds),
            checksum = COALESCE(?, checksum), updated_at = ?
      WHERE id = ?`,
  ).bind(
    stage, options?.errorCode ?? null, options?.durationSeconds ?? null,
    options?.checksum ?? null, now, current.id,
  ).run();
  return getWebinarVideoAsset(db, webinarId);
}

/** 準備が済んだ（ready）動画だけ配信に選べる（N）。 */
export async function isWebinarVideoReady(
  db: D1Database,
  webinarId: string,
): Promise<boolean> {
  const asset = await getWebinarVideoAsset(db, webinarId);
  return asset?.stage === 'ready' && asset.purged_at === null;
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

export async function getWebinarSession(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
): Promise<WebinarSessionRow | null> {
  return db.prepare(
    `SELECT * FROM webinar_sessions WHERE webinar_id = ? AND session_start_at = ?`,
  ).bind(webinarId, sessionStartAt).first<WebinarSessionRow>();
}

/** 開催回の定員を決める。行が無ければ作る。定員の取り消しは null。 */
export async function setWebinarSessionCapacity(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
  capacity: number | null,
): Promise<WebinarSessionRow> {
  const now = jstNow();
  const existing = await getWebinarSession(db, webinarId, sessionStartAt);
  if (!existing) {
    await db.prepare(
      `INSERT INTO webinar_sessions
         (id, webinar_id, session_start_at, capacity, reserved_count, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'open', ?, ?)`,
    ).bind(crypto.randomUUID(), webinarId, sessionStartAt, capacity, now, now).run();
  } else {
    await db.prepare(
      `UPDATE webinar_sessions
          SET capacity = ?,
              state = CASE WHEN ? IS NOT NULL AND reserved_count >= ? THEN 'full' ELSE 'open' END,
              updated_at = ?
        WHERE id = ?`,
    ).bind(capacity, capacity, capacity, now, existing.id).run();
  }
  return (await getWebinarSession(db, webinarId, sessionStartAt))!;
}

/**
 * 開催回の席を1つ確保する（N）。定員は申込の時に条件付き更新で確保する。
 * 行が無い開催回は従来どおり無制限（'unlimited'）。
 * 二重実行でも定員を超えない（UPDATE の条件で守る）。
 */
export async function reserveWebinarSeat(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
): Promise<'reserved' | 'full' | 'unlimited'> {
  const session = await getWebinarSession(db, webinarId, sessionStartAt);
  if (!session || session.capacity === null || session.state === 'closed') {
    if (session?.state === 'closed') return 'full';
    return 'unlimited';
  }
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE webinar_sessions
        SET reserved_count = reserved_count + 1,
            state = CASE WHEN reserved_count + 1 >= capacity THEN 'full' ELSE 'open' END,
            updated_at = ?
      WHERE webinar_id = ? AND session_start_at = ?
        AND (capacity IS NULL OR reserved_count < capacity)`,
  ).bind(now, webinarId, sessionStartAt).run();
  return (result.meta.changes ?? 0) > 0 ? 'reserved' : 'full';
}

/** 席の確保を取り消す（再予約・取消で空ける）。0を割らない。 */
export async function releaseWebinarSeat(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
): Promise<void> {
  await db.prepare(
    `UPDATE webinar_sessions
        SET reserved_count = CASE WHEN reserved_count > 0 THEN reserved_count - 1 ELSE 0 END,
            state = CASE WHEN state = 'closed' THEN 'closed' ELSE 'open' END,
            updated_at = ?
      WHERE webinar_id = ? AND session_start_at = ?`,
  ).bind(jstNow(), webinarId, sessionStartAt).run();
}

/**
 * 見逃し配信の期限内か（N）。「する」を選んだ開催回だけ、開催から
 * 設定日数（既定7日）以内の視聴に使う。期限切れは送らない。
 */
export async function isWebinarMissedInWindow(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
  nowEpochSeconds: number,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT missed_enabled, missed_window_days
       FROM webinar_notification_settings WHERE webinar_id = ?`,
  ).bind(webinarId).first<{ missed_enabled: number; missed_window_days: number | null }>();
  if (!row || row.missed_enabled !== 1) return false;
  const windowDays = row.missed_window_days ?? 7;
  return nowEpochSeconds <= sessionStartAt + windowDays * 86400;
}

/**
 * 保管期限を過ぎた動画の資産（N）。終了から90日で消す対象。
 * 消す操作自体は purgeWebinarVideoAsset で「使っている間は消さない」を守る。
 */
export async function findExpiredWebinarVideoAssets(
  db: D1Database,
  nowIso: string,
): Promise<WebinarVideoAsset[]> {
  const { results } = await db.prepare(
    `SELECT * FROM webinar_video_assets
      WHERE expires_at IS NOT NULL AND expires_at <= ?
        AND purged_at IS NULL
      ORDER BY expires_at ASC`,
  ).bind(nowIso).all<WebinarVideoAsset>();
  return results ?? [];
}

/** 使っている間（公開中のウェビナーが参照）は消さない。 */
export async function canPurgeWebinarVideoAsset(
  db: D1Database,
  assetId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT a.id FROM webinar_video_assets a
       JOIN webinars w ON w.video_asset_id = a.id
      WHERE a.id = ? AND w.status = 'active'`,
  ).bind(assetId).first<{ id: string }>();
  return row === null;
}

/** 保管期限切れの動画を消す。使っている間は消さず false を返す。 */
export async function purgeWebinarVideoAsset(
  db: D1Database,
  assetId: string,
  nowIso?: string,
): Promise<boolean> {
  if (!await canPurgeWebinarVideoAsset(db, assetId)) return false;
  const result = await db.prepare(
    `UPDATE webinar_video_assets SET purged_at = ?, updated_at = ? WHERE id = ? AND purged_at IS NULL`,
  ).bind(nowIso ?? jstNow(), nowIso ?? jstNow(), assetId).run();
  return (result.meta.changes ?? 0) > 0;
}
