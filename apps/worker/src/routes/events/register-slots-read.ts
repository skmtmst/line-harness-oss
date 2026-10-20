import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { bad } from '../../services/event-input-error.js';
import { requireRole } from '../../middleware/role-guard.js';
import { auditLog } from '../../lib/audit-log.js';
import { getEventOccurrenceApplicants } from '../../services/event-waitlist.js';
import { createEventApplicantSnapshot, getEventApplicantSnapshot } from '../../services/event-applicant-snapshot.js';
import { getAccountId, csvCell } from './input.js';
import { ownsEvent } from './slot-input.js';

export function registerSlotsRead(events: Hono<Env>): void {
events.get('/api/events/admin/events/:id/slots', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  if (!(await ownsEvent(c.env.DB, c.req.param('id'), account_id))) return bad(c, 'not_found', 404);
  const { results } = await c.env.DB
    .prepare(
      `SELECT
         s.*,
         ((SELECT COALESCE(SUM(b.party_size), 0) FROM event_bookings b WHERE b.slot_id = s.id AND b.status IN ('requested','confirmed'))
          + (SELECT COALESCE(SUM(w.party_size), 0) FROM event_waitlist w WHERE w.slot_id = s.id AND w.status IN ('offered','accepted'))) AS active_count
       FROM event_slots s
       WHERE s.event_id = ? AND s.deleted_at IS NULL
       ORDER BY s.sort_order ASC, s.starts_at ASC`,
    )
    .bind(c.req.param('id'))
    .all();
  return c.json({ items: results ?? [] });
});

// 申込者画面の開催回選択だけに使う。予約/集計を載せないため、画面を開くたびに
// 大きな一覧を読む必要がない。
events.get('/api/events/admin/events/:id/occurrence-selector', async (c) => {
  const accountId = getAccountId(c);
  if (!accountId) return bad(c, 'account_id_required', 400);
  if (!(await ownsEvent(c.env.DB, c.req.param('id'), accountId))) return bad(c, 'not_found', 404);
  const { results } = await c.env.DB.prepare(
    `SELECT id, event_id, starts_at, ends_at, capacity, is_active, sort_order
       FROM event_slots WHERE event_id = ? AND deleted_at IS NULL AND is_active = 1
       ORDER BY sort_order ASC, starts_at ASC`,
  ).bind(c.req.param('id')).all();
  return c.json({ items: results ?? [] });
});

// GET /api/events/admin/events/:id/waitlist — キャンセル待ちの一覧
//
// 空きが出たときに誰へ案内したかも含めて見るための互換一覧。
// の開催回別画面は /occurrences/:id/applicants を使う。
events.get('/api/events/admin/events/:id/waitlist', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const { results } = await c.env.DB
    .prepare(
      `SELECT w.id, w.slot_id, w.friend_id, w.status, w.party_size,
              w.offered_at, w.offer_expires_at, w.notified_at, w.created_at,
              s.starts_at AS slot_starts_at,
              f.display_name AS friend_name
         FROM event_waitlist w
         JOIN event_slots s ON s.id = w.slot_id
         LEFT JOIN friends f ON f.id = w.friend_id
        WHERE w.event_id = ? AND w.status IN ('waiting', 'offered', 'accepted')
        ORDER BY s.starts_at ASC, w.created_at ASC
        LIMIT 500`,
    )
    .bind(c.req.param('id'))
    .all();
  return c.json({ waitlist: results });
});

// では event_slots を「開催回(occurrence)」として扱う。
events.get(
  '/api/events/admin/occurrences/:id/applicants',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = getAccountId(c);
    if (!accountId) return bad(c, 'account_id_required', 400);
    const data = await getEventOccurrenceApplicants(c.env.DB, {
      occurrenceId: c.req.param('id'),
      lineAccountId: accountId,
    });
    if (!data) return bad(c, 'not_found', 404);
    const snapshot = await createEventApplicantSnapshot(c.env.DB, {
      lineAccountId: accountId,
      occurrenceId: c.req.param('id'),
      staffId: c.get('staff')!.id,
      data,
    });
    return c.json({ success: true, data: { ...snapshot.data, snapshotId: snapshot.id, snapshotExpiresAt: snapshot.expiresAt } });
  },
);

// 表示時にサーバーが固定した全申込者を出力する。後続の申込/取消でCSVの対象を
// 入れ替えないため、snapshot_idが無いリクエストは受け付けない。
events.get(
  '/api/events/admin/occurrences/:id/applicants.csv',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountId = getAccountId(c);
    if (!accountId) return bad(c, 'account_id_required', 400);
    const occurrenceId = c.req.param('id');
    const snapshotId = c.req.query('snapshot_id');
    if (!snapshotId) return bad(c, 'applicant_snapshot_required', 422);
    const loaded = await getEventApplicantSnapshot(c.env.DB, {
      id: snapshotId,
      lineAccountId: accountId,
      occurrenceId,
      staffId: c.get('staff')!.id,
    });
    if (loaded.kind === 'not_found') return bad(c, 'not_found', 404);
    if (loaded.kind === 'expired') return bad(c, 'applicant_snapshot_expired', 410);
    if (loaded.kind === 'invalid') return bad(c, 'applicant_snapshot_invalid', 409);
    c.set('outputAudit', { count: loaded.snapshot.data.applicants.length, accountId, targetId: occurrenceId });
    const rows = loaded.snapshot.data.applicants.map((applicant) => [
      applicant.displayName,
      applicant.source === 'waitlist' ? 'キャンセル待ち' : '申込',
      applicant.status,
      applicant.partySize,
      applicant.appliedAt,
      applicant.offerExpiresAt,
    ].map(csvCell).join(','));
    const safeId = occurrenceId.replace(/[^A-Za-z0-9_-]/g, '') || 'occurrence';
    auditLog(c, 'event.applicant.export', { kind: 'event_occurrence', id: occurrenceId }, {
      lineAccountId: accountId,
    });
    return new Response(`\uFEFF${[
      ['申込者', '区分', '状態', '人数', '申込日時', '案内期限'].map(csvCell).join(','),
      ...rows,
    ].join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="event-${safeId}-applicants.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  },
);
}
