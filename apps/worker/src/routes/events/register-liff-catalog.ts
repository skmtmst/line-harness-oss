import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { bad } from '../../services/event-input-error.js';
import { getSlotsWithRemaining } from '../../services/event-availability.js';
import { verifyCallerLineUserId } from '../../services/liff-auth.js';
import { computeIdentityKey } from '../../lib/identity-key.js';
import { resolveAccountIdFromLiff, parseEventQuestions } from './input.js';

export function registerLiffCatalog(events: Hono<Env>): void {
// ============================================================
// LIFF: read-only event/slots
// ============================================================

events.get('/api/liff/events/:id', async (c) => {
  const account_id = await resolveAccountIdFromLiff(c);
  if (!account_id) return bad(c, 'liff_account_resolution_failed', 400);
  const row = await c.env.DB
    .prepare(
      `SELECT * FROM events
        WHERE id = ? AND deleted_at IS NULL AND is_published = 1
          AND (lifecycle_status IS NULL OR lifecycle_status = 'published') AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(c.req.param('id'), account_id, account_id)
    .first<Record<string, unknown>>();
  if (!row) return bad(c, 'not_found', 404);

  // 既存予約検出: caller が認証済 + friend が存在するなら identity_key で
  // active 予約を引いて my_existing_booking としてレスポンスに含める。
  // LIFF 詳細画面が「予約済」表示に分岐できるよう、POST 前に検出する。
  let myExistingBooking:
    | { id: string; status: string; slot_starts_at: string; line_account_id: string }
    | null = null;
  let caller: string | null = null;
  try {
    caller = await verifyCallerLineUserId(c.req.header('Authorization'), c.env, account_id);
  } catch {
    caller = null;
  }
  if (caller) {
    const friend = await c.env.DB
      .prepare(`SELECT id, user_id, picture_url FROM friends WHERE line_user_id = ? AND line_account_id = ?`)
      .bind(caller, account_id)
      .first<{ id: string; user_id: string | null; picture_url: string | null }>();
    if (friend) {
      // url_token > 'uid:<user_id>' > 'solo:<friend.id>' の順 (broadcasts dedup
      // と同じ識別ロジック)。picture_url 経由の url_token を加えることで、
      // url_token が一致する複数アカ友だち間でも既予約を検出できる。
      const idKey = computeIdentityKey(friend);
      const existing = await c.env.DB
        .prepare(
          `SELECT b.id, b.status, b.line_account_id, s.starts_at AS slot_starts_at
             FROM event_bookings b
             JOIN event_slots s ON s.id = b.slot_id
            WHERE b.event_id = ?
              AND b.identity_key = ?
              AND b.status IN ('requested','confirmed')
            LIMIT 1`,
        )
        .bind(c.req.param('id'), idKey)
        .first<{ id: string; status: string; slot_starts_at: string; line_account_id: string }>();
      if (existing) myExistingBooking = existing;
    }
  }

  // 公開対象を絞っているイベントは、そのタグを持たない人には無いものとして扱う。
  // 「あるが見られない」だと、存在すること自体が伝わってしまう。
  if (row.visible_tag_id) {
    if (!caller) return bad(c, 'not_found', 404);
    const me = await c.env.DB
      .prepare(
        `SELECT 1 FROM friend_tags ft
           JOIN friends f ON f.id = ft.friend_id
          WHERE f.line_user_id = ? AND f.line_account_id = ? AND ft.tag_id = ?
          LIMIT 1`,
      )
      .bind(caller, account_id, row.visible_tag_id as string)
      .first<{ 1: number }>();
    if (!me) return bad(c, 'not_found', 404);
  }

  // questions_json は生JSON文字列のまま返すと利用側で二重parseになるので、
  // 画面がそのまま使える配列として添える（定義が無ければ空配列）。
  // U: オンラインの URL は確定した人にだけ見せる。確定前・未申込には
  // 渡さない（会場名の表示はそのまま残す）。
  const venueVisible = myExistingBooking?.status === 'confirmed';
  return c.json({
    ...row,
    venue_url: venueVisible ? row.venue_url : null,
    questions: parseEventQuestions(row.questions_json),
    my_existing_booking: myExistingBooking,
  });
});

events.get('/api/liff/events/:id/slots', async (c) => {
  const account_id = await resolveAccountIdFromLiff(c);
  if (!account_id) return bad(c, 'liff_account_resolution_failed', 400);
  const ev = await c.env.DB
    .prepare(
      `SELECT id FROM events
        WHERE id = ? AND deleted_at IS NULL AND is_published = 1
          AND (lifecycle_status IS NULL OR lifecycle_status = 'published') AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(c.req.param('id'), account_id, account_id)
    .first<{ id: string }>();
  if (!ev) return bad(c, 'not_found', 404);
  const items = await getSlotsWithRemaining(c.env.DB, c.req.param('id'), {
    only_active: true,
    only_future: true,
  });
  return c.json({ items });
});
}
