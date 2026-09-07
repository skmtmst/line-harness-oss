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

/** V6一覧用。人数は予約枠数ではなく、ウェビナーごとの重複しない友だち数。 */
export async function getWebinarList(
  db: D1Database,
  scope: WebinarListScope,
): Promise<WebinarListRow[]> {
  const where = webinarScopeWhere(scope);
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
       LEFT JOIN folders f ON f.id = w.folder_id AND f.kind = 'webinar'
      WHERE ${where.sql} AND w.status <> 'archived'
      ORDER BY w.created_at DESC`,
  ).bind(...where.bindings).all<WebinarListRow>();
  return result.results ?? [];
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
       JOIN folders f ON f.id = w.folder_id AND f.kind = 'webinar'
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
     VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), webinarId, saved.version, webinarEditorSnapshot(saved), now, null,
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

export async function getWebinarParticipantOperations(
  db: D1Database,
  webinarId: string,
  limit = 100,
  offset = 0,
): Promise<WebinarParticipantOperation[]> {
  const result = await db.prepare(
    `WITH identities AS (
       SELECT friend_id FROM webinar_registrations WHERE webinar_id = ? AND status = 'active'
       UNION
       SELECT friend_id FROM webinar_viewers WHERE webinar_id = ?
     )
     SELECT i.friend_id,
            f.display_name AS friend_name,
            f.picture_url,
            (SELECT COUNT(*) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id) AS sessions,
            COALESCE((SELECT MIN(v.joined_at) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id), '') AS first_joined_at,
            COALESCE((SELECT MAX(v.joined_at) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id), '') AS latest_joined_at,
            COALESCE((SELECT MAX(v.last_position_seconds) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id), 0) AS max_watched_seconds,
            (SELECT MAX(v.cta_clicked_at) FROM webinar_viewers v WHERE v.webinar_id = ? AND v.friend_id = i.friend_id) AS cta_clicked_at,
            1 AS registered,
            (SELECT MAX(fs.created_at)
               FROM form_submissions fs
               JOIN webinar_ctas wc ON wc.form_id = fs.form_id
              WHERE wc.webinar_id = ? AND fs.friend_id = i.friend_id) AS form_submitted_at,
            (SELECT ae.status FROM webinar_action_executions ae
              WHERE ae.webinar_id = ? AND ae.friend_id = i.friend_id
              ORDER BY ae.updated_at DESC LIMIT 1) AS action_status,
            (SELECT ae.last_error FROM webinar_action_executions ae
              WHERE ae.webinar_id = ? AND ae.friend_id = i.friend_id
              ORDER BY ae.updated_at DESC LIMIT 1) AS action_error
       FROM identities i
       LEFT JOIN friends f ON f.id = i.friend_id
      ORDER BY latest_joined_at DESC, i.friend_id
      LIMIT ? OFFSET ?`,
  ).bind(
    webinarId, webinarId, webinarId, webinarId, webinarId, webinarId,
    webinarId, webinarId, webinarId, webinarId, limit, offset,
  ).all<Omit<WebinarParticipantOperation, 'integration_status'>>();
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

/** 離脱位置分布: last_position_seconds を10分(600秒)刻みでバケット集計 */
export async function getWebinarDropoff(
  db: D1Database,
  webinarId: string,
): Promise<Array<{ bucket_start: number; viewers: number }>> {
  const { results } = await db
    .prepare(
      `SELECT (last_position_seconds / 600) * 600 AS bucket_start, COUNT(*) AS viewers
       FROM webinar_viewers WHERE webinar_id = ?
       GROUP BY bucket_start ORDER BY bucket_start`,
    )
    .bind(webinarId)
    .all<{ bucket_start: number; viewers: number }>();
  return results ?? [];
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
