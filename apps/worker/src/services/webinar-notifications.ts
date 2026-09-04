import {
  getAccountSetting,
  isOperationCapabilityStopped,
  resolveLineCredential,
  jstNow,
} from '@line-crm/db';

import { pushViaHarnessProxy, type HarnessProxyDispatch } from './line-proxy-send.js';
import { buildWebinarUrl } from './webinar-reminders.js';
import {
  classifyExternalDeliveryError,
  EXTERNAL_DELIVERY_MAX_ATTEMPTS,
  externalDeliveryRetryAt,
} from './external-delivery-retry.js';

const JST_SECONDS = 9 * 60 * 60;

export type WebinarNotificationKind =
  | 'day_before'
  | 'hour_before'
  | 'session_start'
  | 'missed'
  | 'completed';

export type WebinarNotificationSettings = {
  webinarId: string;
  version: number;
  registrationEnabled: boolean;
  dayBeforeEnabled: boolean;
  dayBeforeTime: string;
  hourBeforeEnabled: boolean;
  hourBeforeMinutes: number;
  startEnabled: boolean;
  missedEnabled: boolean;
  missedTime: string;
  completedEnabled: boolean;
  updatedAt: string;
};

export type WebinarNotificationSettingsInput = Omit<
  WebinarNotificationSettings,
  'webinarId' | 'version' | 'updatedAt'
>;

type SettingsRow = {
  webinar_id: string;
  version: number;
  registration_enabled: number;
  day_before_enabled: number;
  day_before_time_minutes: number;
  hour_before_enabled: number;
  hour_before_minutes: number;
  start_enabled: number;
  missed_enabled: number;
  missed_time_minutes: number;
  completed_enabled: number;
  updated_at: string;
};

type RegistrationRow = {
  id: string;
  webinar_id: string;
  friend_id: string;
  session_start_at: number;
  notified_at: string | null;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  created_at: string;
};

type DueJobRow = {
  id: string;
  webinar_id: string;
  registration_id: string;
  friend_id: string;
  session_start_at: number;
  kind: WebinarNotificationKind;
  attempt_count: number;
  line_retry_key: string;
  title: string;
  slug: string;
  duration_seconds: number;
  account_id: string | null;
  line_user_id: string;
  is_following: number;
  line_account_id: string | null;
  channel_access_token: string | null;
  channel_access_token_encrypted: string | null;
  line_account_active: number | null;
  viewed: number;
};

export type WebinarNotificationDeliveryOptions = {
  now?: Date;
  proxyBaseUrl: string;
  defaultAccessToken: string;
  defaultLiffId: string | null;
  proxyDispatch?: HarnessProxyDispatch;
};

type WebinarNotificationTestTarget = {
  id: string;
  line_user_id: string;
  is_following: number;
};

function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function jstDayAt(sessionStartAt: number, dayOffset: number, minutes: number): number {
  const local = new Date((sessionStartAt + JST_SECONDS) * 1000);
  return Math.floor(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + dayOffset,
    Math.floor(minutes / 60),
    minutes % 60,
  ) / 1000) - JST_SECONDS;
}

export function calculateWebinarNotificationSchedule(
  sessionStartAt: number,
  input: Pick<
    WebinarNotificationSettingsInput,
    | 'dayBeforeEnabled'
    | 'dayBeforeTime'
    | 'hourBeforeEnabled'
    | 'hourBeforeMinutes'
    | 'startEnabled'
    | 'missedEnabled'
    | 'missedTime'
  >,
  nowEpoch = Math.floor(Date.now() / 1000),
): Array<{ kind: Exclude<WebinarNotificationKind, 'completed'>; scheduledAt: number }> {
  const jobs: Array<{ kind: Exclude<WebinarNotificationKind, 'completed'>; scheduledAt: number }> = [];
  const dayBeforeTime = parseTime(input.dayBeforeTime);
  const missedTime = parseTime(input.missedTime);
  if (input.dayBeforeEnabled && dayBeforeTime !== null && sessionStartAt > nowEpoch) {
    jobs.push({ kind: 'day_before', scheduledAt: Math.max(nowEpoch, jstDayAt(sessionStartAt, -1, dayBeforeTime)) });
  }
  if (input.hourBeforeEnabled && sessionStartAt > nowEpoch) {
    jobs.push({
      kind: 'hour_before',
      scheduledAt: Math.max(nowEpoch, sessionStartAt - input.hourBeforeMinutes * 60),
    });
  }
  if (input.startEnabled && sessionStartAt > nowEpoch) {
    jobs.push({ kind: 'session_start', scheduledAt: sessionStartAt });
  }
  if (input.missedEnabled && missedTime !== null) {
    jobs.push({ kind: 'missed', scheduledAt: Math.max(nowEpoch, jstDayAt(sessionStartAt, 1, missedTime)) });
  }
  return jobs;
}

function serializeSettings(row: SettingsRow): WebinarNotificationSettings {
  return {
    webinarId: row.webinar_id,
    version: row.version,
    registrationEnabled: Boolean(row.registration_enabled),
    dayBeforeEnabled: Boolean(row.day_before_enabled),
    dayBeforeTime: formatTime(row.day_before_time_minutes),
    hourBeforeEnabled: Boolean(row.hour_before_enabled),
    hourBeforeMinutes: row.hour_before_minutes,
    startEnabled: Boolean(row.start_enabled),
    missedEnabled: Boolean(row.missed_enabled),
    missedTime: formatTime(row.missed_time_minutes),
    completedEnabled: Boolean(row.completed_enabled),
    updatedAt: row.updated_at,
  };
}

export async function getWebinarNotificationSettings(
  db: D1Database,
  webinarId: string,
): Promise<WebinarNotificationSettings | null> {
  const row = await db.prepare(
    'SELECT * FROM webinar_notification_settings WHERE webinar_id = ?',
  ).bind(webinarId).first<SettingsRow>();
  return row ? serializeSettings(row) : null;
}

async function enqueueJobsForRegistration(
  db: D1Database,
  registration: RegistrationRow,
  settings: WebinarNotificationSettings,
  nowEpoch: number,
): Promise<number> {
  const schedule = calculateWebinarNotificationSchedule(registration.session_start_at, settings, nowEpoch);
  const now = jstNow();
  let queued = 0;
  for (const item of schedule) {
    const result = await db.prepare(
      `INSERT INTO webinar_notification_jobs
         (id, webinar_id, registration_id, friend_id, session_start_at,
          settings_version, kind, scheduled_at, status, attempt_count,
          next_retry_at, line_retry_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)
       ON CONFLICT(registration_id, settings_version, kind) DO UPDATE SET
         scheduled_at=excluded.scheduled_at,
         status='queued',
         attempt_count=0,
         next_retry_at=excluded.next_retry_at,
         lease_expires_at=NULL,
         line_retry_key=excluded.line_retry_key,
         line_request_id=NULL,
         cancelled_at=NULL,
         last_error_code=NULL,
         last_error_message=NULL,
         updated_at=excluded.updated_at
       WHERE webinar_notification_jobs.status='cancelled'`,
    ).bind(
      crypto.randomUUID(),
      registration.webinar_id,
      registration.id,
      registration.friend_id,
      registration.session_start_at,
      settings.version,
      item.kind,
      item.scheduledAt,
      item.scheduledAt,
      crypto.randomUUID(),
      now,
      now,
    ).run();
    queued += result.meta.changes ?? 0;
  }
  return queued;
}

export async function saveWebinarNotificationSettings(
  db: D1Database,
  webinarId: string,
  input: WebinarNotificationSettingsInput,
  now = new Date(),
): Promise<{ settings: WebinarNotificationSettings; queued: number; cancelled: number }> {
  const dayBeforeMinutes = parseTime(input.dayBeforeTime);
  const missedMinutes = parseTime(input.missedTime);
  if (dayBeforeMinutes === null || missedMinutes === null) throw new Error('invalid_time');
  if (!Number.isInteger(input.hourBeforeMinutes) || input.hourBeforeMinutes < 1 || input.hourBeforeMinutes > 10080) {
    throw new Error('invalid_hour_before');
  }
  const previous = await getWebinarNotificationSettings(db, webinarId);
  const version = (previous?.version ?? 0) + 1;
  const nowIso = now.toISOString();
  await db.prepare(
    `INSERT INTO webinar_notification_settings
       (webinar_id, version, registration_enabled, day_before_enabled,
        day_before_time_minutes, hour_before_enabled, hour_before_minutes,
        start_enabled, missed_enabled, missed_time_minutes, completed_enabled,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(webinar_id) DO UPDATE SET
       version=excluded.version,
       registration_enabled=excluded.registration_enabled,
       day_before_enabled=excluded.day_before_enabled,
       day_before_time_minutes=excluded.day_before_time_minutes,
       hour_before_enabled=excluded.hour_before_enabled,
       hour_before_minutes=excluded.hour_before_minutes,
       start_enabled=excluded.start_enabled,
       missed_enabled=excluded.missed_enabled,
       missed_time_minutes=excluded.missed_time_minutes,
       completed_enabled=excluded.completed_enabled,
       updated_at=excluded.updated_at`,
  ).bind(
    webinarId,
    version,
    input.registrationEnabled ? 1 : 0,
    input.dayBeforeEnabled ? 1 : 0,
    dayBeforeMinutes,
    input.hourBeforeEnabled ? 1 : 0,
    input.hourBeforeMinutes,
    input.startEnabled ? 1 : 0,
    input.missedEnabled ? 1 : 0,
    missedMinutes,
    input.completedEnabled ? 1 : 0,
    nowIso,
    nowIso,
  ).run();

  const cancelledResult = await db.prepare(
    `UPDATE webinar_notification_jobs
        SET status='cancelled', cancelled_at=?, updated_at=?
      WHERE webinar_id=? AND status IN ('queued','retry_wait')`,
  ).bind(nowIso, nowIso, webinarId).run();
  const settings = (await getWebinarNotificationSettings(db, webinarId))!;
  const registrations = await db.prepare(
    `SELECT * FROM webinar_registrations
      WHERE webinar_id=? AND status='active' AND session_start_at > ?
      ORDER BY session_start_at ASC`,
  ).bind(webinarId, Math.floor(now.getTime() / 1000)).all<RegistrationRow>();
  let queued = 0;
  for (const registration of registrations.results ?? []) {
    queued += await enqueueJobsForRegistration(
      db,
      registration,
      settings,
      Math.floor(now.getTime() / 1000),
    );
  }
  return { settings, queued, cancelled: cancelledResult.meta.changes ?? 0 };
}

export async function registerWebinarSession(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
  now = new Date(),
): Promise<{ registration: RegistrationRow; created: boolean; rescheduled: boolean }> {
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const existing = await db.prepare(
    `SELECT * FROM webinar_registrations
      WHERE webinar_id=? AND friend_id=? AND status='active' AND session_start_at > ?
      ORDER BY session_start_at ASC LIMIT 1`,
  ).bind(webinarId, friendId, nowEpoch).first<RegistrationRow>();
  if (existing?.session_start_at === sessionStartAt) {
    return { registration: existing, created: false, rescheduled: false };
  }

  const nowIso = now.toISOString();
  if (existing) {
    await db.prepare(
      `UPDATE webinar_registrations
          SET status='cancelled', cancelled_at=?
        WHERE id=? AND status='active'`,
    ).bind(nowIso, existing.id).run();
    await db.prepare(
      `UPDATE webinar_notification_jobs
          SET status='cancelled', cancelled_at=?, updated_at=?
        WHERE registration_id=? AND status IN ('queued','retry_wait')`,
    ).bind(nowIso, nowIso, existing.id).run();
  }

  const previous = await db.prepare(
    `SELECT * FROM webinar_registrations
      WHERE webinar_id=? AND friend_id=? AND session_start_at=?`,
  ).bind(webinarId, friendId, sessionStartAt).first<RegistrationRow>();
  const registrationId = previous?.id ?? crypto.randomUUID();
  if (previous) {
    await db.prepare(
      `UPDATE webinar_registrations
          SET status='active', cancelled_at=NULL, notified_at=NULL
        WHERE id=?`,
    ).bind(registrationId).run();
  } else {
    await db.prepare(
      `INSERT INTO webinar_registrations
         (id, webinar_id, friend_id, session_start_at, notified_at, created_at, status, cancelled_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'active', NULL)`,
    ).bind(registrationId, webinarId, friendId, sessionStartAt, nowIso).run();
  }
  const registration = (await db.prepare(
    'SELECT * FROM webinar_registrations WHERE id=?',
  ).bind(registrationId).first<RegistrationRow>())!;
  const settings = await getWebinarNotificationSettings(db, webinarId);
  if (settings) await enqueueJobsForRegistration(db, registration, settings, nowEpoch);
  return { registration, created: true, rescheduled: Boolean(existing) };
}

export async function enqueueWebinarCompletedNotification(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
  now = new Date(),
): Promise<boolean> {
  const settings = await getWebinarNotificationSettings(db, webinarId);
  if (!settings?.completedEnabled) return false;
  const registration = await db.prepare(
    `SELECT * FROM webinar_registrations
      WHERE webinar_id=? AND friend_id=? AND session_start_at=? AND status='active'`,
  ).bind(webinarId, friendId, sessionStartAt).first<RegistrationRow>();
  if (!registration) return false;
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const nowIso = now.toISOString();
  const result = await db.prepare(
    `INSERT OR IGNORE INTO webinar_notification_jobs
       (id, webinar_id, registration_id, friend_id, session_start_at,
        settings_version, kind, scheduled_at, status, attempt_count,
        next_retry_at, line_retry_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, 'queued', 0, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    webinarId,
    registration.id,
    friendId,
    sessionStartAt,
    settings.version,
    nowEpoch,
    nowEpoch,
    crypto.randomUUID(),
    nowIso,
    nowIso,
  ).run();
  return (result.meta.changes ?? 0) > 0;
}

function formatJstDateTime(epochSeconds: number): string {
  const d = new Date((epochSeconds + JST_SECONDS) * 1000);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${weekdays[d.getUTCDay()]}）${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function renderWebinarNotificationText(
  kind: WebinarNotificationKind,
  title: string,
  sessionStartAt: number,
  url: string,
): string {
  const when = formatJstDateTime(sessionStartAt);
  switch (kind) {
    case 'day_before':
      return `【明日のウェビナー】\n「${title}」は${when}からです。\n\n参加する回はこちらで確認できます👇\n${url}`;
    case 'hour_before':
      return `【開始前のご案内】\n「${title}」は${when}からです。\n\n専用の入場リンクはこちらです👇\n${url}`;
    case 'session_start':
      return `🔴 「${title}」が始まりました\n\nこちらから参加してください👇\n${url}`;
    case 'missed':
      return `「${title}」を見逃した方へ\n\n次の回を選び直せます。都合のよい時間はこちらからどうぞ👇\n${url}`;
    case 'completed':
      return `「${title}」をご視聴いただき、ありがとうございました。\n\nもう一度確認するときはこちらから開けます👇\n${url}`;
  }
}

export async function sendWebinarNotificationTest(
  db: D1Database,
  webinar: { id: string; accountId: string | null; title: string; slug: string },
  sessionStartAt: number,
  options: WebinarNotificationDeliveryOptions,
): Promise<{ sent: number; failed: number }> {
  if (!webinar.accountId) throw new Error('missing_line_account');
  const setting = await db.prepare(
    `SELECT value FROM account_settings
      WHERE line_account_id=? AND key='test_recipients'`,
  ).bind(webinar.accountId).first<{ value: string }>();
  let friendIds: unknown = [];
  try {
    friendIds = setting ? JSON.parse(setting.value) as unknown : [];
  } catch {
    throw new Error('invalid_test_recipients');
  }
  if (!Array.isArray(friendIds) || friendIds.some((id) => typeof id !== 'string')) {
    throw new Error('invalid_test_recipients');
  }
  if (friendIds.length === 0) throw new Error('no_test_recipients');
  const placeholders = friendIds.map(() => '?').join(',');
  const targets = await db.prepare(
    `SELECT id, line_user_id, is_following FROM friends
      WHERE line_account_id=? AND id IN (${placeholders})`,
  ).bind(webinar.accountId, ...friendIds).all<WebinarNotificationTestTarget>();
  const account = await db.prepare(
    `SELECT channel_access_token, channel_access_token_encrypted, liff_id, is_active
       FROM line_accounts WHERE id=?`,
  ).bind(webinar.accountId).first<{
    channel_access_token: string | null;
    channel_access_token_encrypted: string | null;
    liff_id: string | null;
    is_active: number;
  }>();
  if (!account?.is_active) throw new Error('inactive_line_account');
  const liffId = account.liff_id ?? options.defaultLiffId;
  if (!liffId) throw new Error('missing_liff_id');
  const accessToken = await resolveLineCredential(
    account.channel_access_token_encrypted,
    account.channel_access_token ?? options.defaultAccessToken,
    { lineAccountId: webinar.accountId, field: 'channel_access_token' },
  );
  let sent = 0;
  let failed = 0;
  for (const target of targets.results ?? []) {
    if (!target.is_following) continue;
    try {
      await pushViaHarnessProxy(
        options.proxyBaseUrl,
        accessToken,
        target.line_user_id,
        [{
          type: 'text',
          text: `【テスト送信】\n${renderWebinarNotificationText(
            'session_start',
            webinar.title,
            sessionStartAt,
            buildWebinarUrl(liffId, webinar.slug, sessionStartAt),
          )}`,
        }],
        crypto.randomUUID(),
        options.proxyDispatch,
      );
      sent++;
    } catch {
      failed++;
    }
  }
  if (sent === 0 && failed === 0) throw new Error('no_active_test_recipients');
  return { sent, failed };
}

function featureEnabled(raw: string | null): boolean {
  if (!raw) return false;
  try {
    return (JSON.parse(raw) as { enabled?: boolean }).enabled !== false;
  } catch {
    return false;
  }
}

export async function processWebinarNotificationJobs(
  db: D1Database,
  options: WebinarNotificationDeliveryOptions,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const now = options.now ?? new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const due = await db.prepare(
    `SELECT j.id, j.webinar_id, j.registration_id, j.friend_id,
            j.session_start_at, j.kind, j.attempt_count, j.line_retry_key,
            w.title, w.slug, w.duration_seconds, w.account_id,
            f.line_user_id, f.is_following, f.line_account_id,
            la.channel_access_token, la.channel_access_token_encrypted,
            la.is_active AS line_account_active,
            EXISTS (
              SELECT 1 FROM webinar_viewers v
               WHERE v.webinar_id=j.webinar_id AND v.friend_id=j.friend_id
                 AND v.session_start_at=j.session_start_at
            ) AS viewed
       FROM webinar_notification_jobs j
       JOIN webinar_notification_settings s
         ON s.webinar_id=j.webinar_id AND s.version=j.settings_version
       JOIN webinar_registrations r ON r.id=j.registration_id
       JOIN webinars w ON w.id=j.webinar_id
       JOIN friends f ON f.id=j.friend_id
       LEFT JOIN line_accounts la ON la.id=f.line_account_id
      WHERE (
          j.status IN ('queued','retry_wait')
          OR (j.status='claimed' AND COALESCE(j.lease_expires_at, 0) <= ?)
        )
        AND j.attempt_count < ?
        AND j.scheduled_at <= ?
        AND COALESCE(j.next_retry_at, j.scheduled_at) <= ?
        AND r.status='active'
        AND w.status='active'
      ORDER BY j.scheduled_at ASC
      LIMIT 100`,
  ).bind(nowEpoch, EXTERNAL_DELIVERY_MAX_ATTEMPTS, nowEpoch, nowEpoch).all<DueJobRow>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of due.results ?? []) {
    const claimed = await db.prepare(
      `UPDATE webinar_notification_jobs
          SET status='claimed', attempt_count=attempt_count+1, lease_expires_at=?, updated_at=?
        WHERE id=? AND (
          status IN ('queued','retry_wait')
          OR (status='claimed' AND COALESCE(lease_expires_at, 0) <= ?)
        )`,
    ).bind(nowEpoch + 300, now.toISOString(), row.id, nowEpoch).run();
    if ((claimed.meta.changes ?? 0) === 0) continue;
    try {
      const isMissedButViewed = row.kind === 'missed' && Boolean(row.viewed);
      const isLateReminder = ['day_before', 'hour_before', 'session_start'].includes(row.kind)
        && nowEpoch >= row.session_start_at + row.duration_seconds;
      const featureRaw = row.account_id
        ? await getAccountSetting(db, row.account_id, 'feature.webinars')
        : null;
      const operationStopped = await isOperationCapabilityStopped(
        db,
        row.account_id,
        'reminder_dispatch',
      );
      const skip = isMissedButViewed
        ? { code: 'already_viewed', message: 'すでに視聴済みのため送信しませんでした。' }
        : isLateReminder
          ? { code: 'notification_expired', message: '対象回が終了済みのため送信しませんでした。' }
          : !row.is_following
            ? { code: 'friend_not_following', message: 'ブロックまたは友だち解除のため送信しませんでした。' }
            : !row.line_account_id || row.line_account_id !== row.account_id
              ? { code: 'line_account_mismatch', message: '送信先とウェビナーのLINEアカウントが一致しないため送信しませんでした。' }
              : !row.line_account_active
                ? { code: 'line_account_inactive', message: 'LINEアカウントが停止中のため送信しませんでした。' }
                : !featureEnabled(featureRaw)
                  ? { code: 'feature_disabled', message: 'ウェビナー機能が停止中のため送信しませんでした。' }
                  : operationStopped
                    ? { code: 'operation_stopped', message: '緊急停止中のため送信しませんでした。' }
                    : null;
      if (
        skip
      ) {
        await db.prepare(
          `UPDATE webinar_notification_jobs
              SET status='skipped', lease_expires_at=NULL,
                  last_error_code=?, last_error_message=?, updated_at=?
            WHERE id=?`,
        ).bind(skip.code, skip.message, now.toISOString(), row.id).run();
        skipped++;
        continue;
      }
      const lineAccountId = row.line_account_id;
      if (!lineAccountId) continue;
      const account = await db.prepare(
        'SELECT liff_id FROM line_accounts WHERE id=?',
      ).bind(lineAccountId).first<{ liff_id: string | null }>();
      const liffId = account?.liff_id ?? options.defaultLiffId;
      if (!liffId) throw new Error('missing_liff_id');
      const accessToken = await resolveLineCredential(
        row.channel_access_token_encrypted,
        row.channel_access_token ?? options.defaultAccessToken,
        { lineAccountId, field: 'channel_access_token' },
      );
      const response = await pushViaHarnessProxy(
        options.proxyBaseUrl,
        accessToken,
        row.line_user_id,
        [{
          type: 'text',
          text: renderWebinarNotificationText(
            row.kind,
            row.title,
            row.session_start_at,
            buildWebinarUrl(liffId, row.slug, row.session_start_at),
          ),
        }],
        row.line_retry_key,
        options.proxyDispatch,
      );
      await db.prepare(
        `UPDATE webinar_notification_jobs
            SET status='succeeded', sent_at=?, line_request_id=?, lease_expires_at=NULL,
                last_error_code=NULL, last_error_message=NULL, updated_at=?
          WHERE id=? AND status='claimed'`,
      ).bind(now.toISOString(), response.requestId, now.toISOString(), row.id).run();
      sent++;
    } catch (error) {
      const attempt = row.attempt_count + 1;
      const safe = classifyExternalDeliveryError(error, 'missing_liff_id');
      const retryAt = externalDeliveryRetryAt(error, attempt, now, safe.retryable);
      const exhausted = safe.retryable && !retryAt;
      await db.prepare(
        `UPDATE webinar_notification_jobs
            SET status=?, next_retry_at=?, lease_expires_at=NULL,
                last_error_code=?, last_error_message=?, updated_at=?
          WHERE id=? AND status='claimed'`,
      ).bind(
        retryAt ? 'retry_wait' : 'permanent_failed',
        retryAt ? Math.floor(retryAt.getTime() / 1000) : null,
        exhausted ? 'retry_exhausted' : safe.code,
        exhausted
          ? '自動再試行の上限に達しました。LINE連携を確認し、必要なら手動で再試行してください。'
          : safe.message,
        now.toISOString(),
        row.id,
      ).run();
      failed++;
    }
  }
  return { sent, failed, skipped };
}

export async function getWebinarNotificationOverview(
  db: D1Database,
  webinarId: string,
): Promise<{ total: number; pending: number; sent: number; failed: number; skipped: number; cancelled: number }> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ('queued','claimed','retry_wait') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status='permanent_failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) AS skipped,
            SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled
       FROM webinar_notification_jobs WHERE webinar_id=?`,
  ).bind(webinarId).first<Record<string, number | null>>();
  return {
    total: row?.total ?? 0,
    pending: row?.pending ?? 0,
    sent: row?.sent ?? 0,
    failed: row?.failed ?? 0,
    skipped: row?.skipped ?? 0,
    cancelled: row?.cancelled ?? 0,
  };
}
