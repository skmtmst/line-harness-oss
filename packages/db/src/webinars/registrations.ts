import { jstNow } from '../utils.js';
import { type WebinarRegistration } from './types.js';


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
