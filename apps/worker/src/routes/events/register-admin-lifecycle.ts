import { logger } from '@line-crm/shared/server';
import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { bad } from '../../services/event-input-error.js';
import { inputJsonBoundary } from '../../lib/input-errors.js';
import { requireRole } from '../../middleware/role-guard.js';
import { auditLog } from '../../lib/audit-log.js';
import { sendEventBookingNotification } from '../../services/event-booking-notifier.js';
import { resolveLineCredential } from '@line-crm/db';
import { reorderEventWaitlist, skipEventWaitlist } from '../../services/event-waitlist.js';
import { applyEventChange, canTransitionLifecycle, findChangeLogByIdempotency, isLifecycleStatus, lifecycleReasonRequired, lifecycleToPublishedFlag, markChangeLogNotified, previewEventChange, writeEventChangeLog } from '../../services/event-change-review.js';
import { getAccountId } from './input.js';
import { ownsEvent } from './slot-input.js';
import { changeActor, waitlistReason } from './admin-input.js';
import { startsAtJst } from './time-input.js';

export function registerAdminLifecycle(events: Hono<Env>): void {
events.delete('/api/events/admin/events/:id', requireRole('owner', 'admin'), async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400, []);
  const id = c.req.param('id');
  // Authorize via multi-account ownership: shared events can be deleted by
  // any account listed in account_ids, not only the sentinel line_account_id.
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);
  // Block deletion while live bookings exist — once the event row is
  // soft-deleted ownsEvent hides it from admin endpoints, leaving any
  // requested/confirmed bookings unmanageable but still firing reminders.
  const active = await c.env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM event_bookings
           WHERE event_id = ? AND status IN ('requested','confirmed'))
         + (SELECT COUNT(*) FROM event_waitlist
             WHERE event_id = ? AND status IN ('offered','accepted')) AS c`,
    )
    .bind(id, id)
    .first<{ c: number }>();
  if ((active?.c ?? 0) > 0) return bad(c, 'event_has_active_bookings', 409);
  const now = new Date().toISOString();
  const result = await c.env.DB
    .prepare(
      `UPDATE events SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(now, now, id)
    .run();
  if ((result.meta?.changes ?? 0) === 0) return bad(c, 'not_found', 404);
  return new Response(null, { status: 204 });
});

// POST /api/events/admin/events/:id/lifecycle
// 状態の切替（下書き・公開中・一時停止・終了・中止）。
// is_published へ両書きするので、旧来の口の公開可否はそのまま動く。
events.post('/api/events/admin/events/:id/lifecycle', requireRole('owner', 'admin'), inputJsonBoundary(), async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400, []);
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isLifecycleStatus(body.to)) return bad(c, 'invalid_lifecycle_status', 422, ["to"]);
  const to = body.to;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (lifecycleReasonRequired(to) && reason.length === 0) {
    return bad(c, 'lifecycle_reason_required', 422, ["to","reason"]);
  }
  const idemKey = typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
    ? body.idempotency_key
    : null;
  if (idemKey) {
    const dup = await findChangeLogByIdempotency(c.env.DB, account_id, idemKey);
    if (dup) return c.json({ success: true, deduplicated: true, log_id: dup.id });
  }
  const exists = await c.env.DB
    .prepare(
      `SELECT id, version, is_published, lifecycle_status, line_account_id, target_type, account_ids
         FROM events WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(id)
    .first<{
      id: string;
      version: number;
      is_published: number;
      lifecycle_status: string | null;
      line_account_id: string;
      target_type: string;
      account_ids: string | null;
    }>();
  if (!exists) return bad(c, 'not_found', 404);
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);
  const from = isLifecycleStatus(exists.lifecycle_status)
    ? exists.lifecycle_status
    : exists.is_published === 1 ? 'published' : 'draft';
  if (from === to) {
    return c.json({ success: true, lifecycle_status: to, version: exists.version, unchanged: true });
  }
  if (!canTransitionLifecycle(from, to)) return bad(c, 'lifecycle_transition_invalid', 409);
  const nowIso = new Date().toISOString();
  const updated = await c.env.DB
    .prepare(
      `UPDATE events
          SET lifecycle_status = ?, lifecycle_changed_at = ?, lifecycle_change_reason = ?,
              is_published = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
    )
    .bind(to, nowIso, reason.length > 0 ? reason : null, lifecycleToPublishedFlag(to), nowIso, id, exists.version)
    .run();
  if ((updated.meta?.changes ?? 0) === 0) return bad(c, 'version_conflict', 409);
  const actor = changeActor(c);
  const log = await writeEventChangeLog(c.env.DB, {
    lineAccountId: account_id,
    eventId: id,
    actorId: actor.id,
    actorRole: actor.role,
    action: 'lifecycle',
    reason: reason.length > 0 ? reason : null,
    beforeJson: JSON.stringify({ lifecycle_status: from }),
    afterJson: JSON.stringify({ lifecycle_status: to }),
    idempotencyKey: idemKey,
    nowIso,
  });
  return c.json({ success: true, lifecycle_status: to, version: exists.version + 1, log_id: log.id });
});

// POST /api/events/admin/events/:id/change-review
// 変更の事前表示（読み取り専用）。影響人数と止める理由を返す。
events.post('/api/events/admin/events/:id/change-review', requireRole('owner', 'admin'), inputJsonBoundary(), async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400, []);
  const body = (await c.req.json().catch(() => ({}))) as {
    slot_changes?: Array<{
      slot_id?: unknown;
      starts_at?: string;
      ends_at?: string;
      capacity?: number | null;
      is_active?: number;
    }>;
    event_changes?: { venue_name?: string | null; venue_url?: string | null };
  };
  if (!Array.isArray(body.slot_changes)) return bad(c, 'slot_changes_required', 422, ["slot_changes"]);
  for (const change of body.slot_changes) {
    if (typeof change?.slot_id !== 'string' || change.slot_id.length === 0) {
      return bad(c, 'invalid_slot_id', 422, []);
    }
    if (change.capacity !== undefined
      && change.capacity !== null
      && (!Number.isInteger(change.capacity) || (change.capacity as number) < 1)) {
      return bad(c, 'invalid_capacity', 422, []);
    }
    if (change.is_active !== undefined && change.is_active !== 0 && change.is_active !== 1) {
      return bad(c, 'invalid_is_active', 422, []);
    }
  }
  const result = await previewEventChange(c.env.DB, {
    eventId: c.req.param('id'),
    lineAccountId: account_id,
    slotChanges: body.slot_changes as Array<{
      slot_id: string;
      starts_at?: string;
      ends_at?: string;
      capacity?: number | null;
      is_active?: number;
    }>,
    eventChanges: body.event_changes,
  });
  if ('kind' in result) return bad(c, 'not_found', 404);
  return c.json(result);
});

// POST /api/events/admin/events/:id/change-review/apply
// 変更確認の適用。版の一致で直列化し、二重実行は冪等キーで吸収する。
// 日時・会場が動いた回の確定申込へは best-effort で LINE 通知する。
events.post(
  '/api/events/admin/events/:id/change-review/apply',
  requireRole('owner', 'admin'),
  inputJsonBoundary(), async (c) => {
    const account_id = getAccountId(c);
    if (!account_id) return bad(c, 'account_id_required', 400, []);
    const body = (await c.req.json().catch(() => ({}))) as {
      expected_version?: unknown;
      change_reason?: unknown;
      idempotency_key?: unknown;
      slot_changes?: Array<{
        slot_id?: unknown;
        starts_at?: string;
        ends_at?: string;
        capacity?: number | null;
        is_active?: number;
      }>;
      event_changes?: { venue_name?: string | null; venue_url?: string | null };
    };
    if (!Number.isInteger(body.expected_version) || (body.expected_version as number) < 1) {
      return bad(c, 'expected_version_required', 422, ["expected_version"]);
    }
    if (typeof body.idempotency_key !== 'string' || body.idempotency_key.length === 0) {
      return bad(c, 'idempotency_key_required', 400, ["idempotency_key"]);
    }
    if (!Array.isArray(body.slot_changes)) return bad(c, 'slot_changes_required', 422, ["slot_changes"]);
    for (const change of body.slot_changes) {
      if (typeof change?.slot_id !== 'string' || change.slot_id.length === 0) {
        return bad(c, 'invalid_slot_id', 422, []);
      }
    }
    const actor = changeActor(c);
    const result = await applyEventChange(c.env.DB, {
      eventId: c.req.param('id'),
      lineAccountId: account_id,
      actorId: actor.id,
      actorRole: actor.role,
      expectedVersion: body.expected_version as number,
      changeReason: typeof body.change_reason === 'string' ? body.change_reason : null,
      idempotencyKey: body.idempotency_key,
      slotChanges: body.slot_changes as Array<{
        slot_id: string;
        starts_at?: string;
        ends_at?: string;
        capacity?: number | null;
        is_active?: number;
      }>,
      eventChanges: body.event_changes,
    });
    if (result.kind === 'not_found') return bad(c, 'not_found', 404);
    if (result.kind === 'conflict') return bad(c, 'version_conflict', 409);
    if (result.kind === 'invalid') return bad(c, result.error, 422, ["expected_version","change_reason","idempotency_key","slot_changes","event_changes"]);
    if (result.kind === 'duplicate') {
      return c.json({ success: true, deduplicated: true, log_id: result.logId });
    }
    // 日時・会場の変更を確定申込へ知らせる。届かなくても適用は確定済み
    // なので、送達数は記録に残すだけにする（失敗で 500 にしない）。
    let notified = 0;
    if (result.notifyTargets.length > 0) {
      try {
        const acc = await c.env.DB
          .prepare(
            `SELECT la.channel_access_token, la.channel_access_token_encrypted,
                    e.name AS event_name, e.venue_name, e.venue_url
               FROM line_accounts la
               JOIN events e ON e.id = ?
              WHERE la.id = ?`,
          )
          .bind(c.req.param('id'), account_id)
          .first<{
            channel_access_token: string;
            channel_access_token_encrypted: string | null;
            event_name: string;
            venue_name: string | null;
            venue_url: string | null;
          }>();
        if (acc?.channel_access_token) {
          const accessToken = await resolveLineCredential(
            acc.channel_access_token_encrypted,
            acc.channel_access_token,
            { lineAccountId: account_id, field: 'channel_access_token' },
          );
          const slotStarts = await c.env.DB
            .prepare(`SELECT id, starts_at FROM event_slots WHERE event_id = ?`)
            .bind(c.req.param('id'))
            .all<{ id: string; starts_at: string }>();
          const startsBySlot = new Map(
            (slotStarts.results ?? []).map((s) => [s.id, s.starts_at] as const),
          );
          for (const target of result.notifyTargets) {
            if(target.bookingVersion===undefined)continue;
            try {
              await sendEventBookingNotification({
                delivery: { db: c.env.DB, accountId:target.lineAccountId??account_id, operationId: `event-transition:${target.bookingId}:${target.bookingVersion}`,subject:{bookingId:target.bookingId,version:target.bookingVersion,slotId:target.slotId,status:'confirmed',startsAt:startsBySlot.get(target.slotId)} },
                channelAccessToken:target.lineAccountId&&target.lineAccountId!==account_id?await (async()=>{const line=await c.env.DB.prepare('SELECT channel_access_token,channel_access_token_encrypted FROM line_accounts WHERE id=?').bind(target.lineAccountId).first<{channel_access_token:string;channel_access_token_encrypted:string|null}>();if(!line)throw new Error('sender_unavailable');return resolveLineCredential(line.channel_access_token_encrypted,line.channel_access_token,{lineAccountId:target.lineAccountId!,field:'channel_access_token'});})():accessToken,
                toLineUserId: target.lineUserId,
                kind: 'schedule_changed',
                ctx: {
                  eventName: acc.event_name,
                  startsAtJst: startsAtJst(startsBySlot.get(target.slotId) ?? new Date().toISOString()),
                  venueName: acc.venue_name,
                  venueUrl: acc.venue_url,
                  changeSummary: result.changeSummary || null,
                },
              });
              notified += 1;
            } catch (error) {
              logger.error("routes_events_failed");
            }
          }
        }
      } catch (error) {
        logger.error("routes_events_failed");
      }
      await markChangeLogNotified(c.env.DB, result.logId, notified);
    }
    auditLog(c, 'event.change.apply', { kind: 'event', id: c.req.param('id') }, {
      lineAccountId: account_id,
    });
    return c.json({
      success: true,
      version: result.version,
      log_id: result.logId,
      affected_confirmed: result.affectedConfirmed,
      affected_waiting: result.affectedWaiting,
      notified,
    });
  },
);

// POST /api/events/admin/occurrences/:id/waitlist/reorder
// 待ち順の手動変更。理由が必須。枠の waiting 全件の並べ直しで受ける。
events.post(
  '/api/events/admin/occurrences/:id/waitlist/reorder',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), async (c) => {
    const account_id = getAccountId(c);
    if (!account_id) return bad(c, 'account_id_required', 400, []);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = waitlistReason(body);
    if (!reason) return bad(c, 'waitlist_reason_required', 422, ["reason"]);
    if (!Array.isArray(body.ordered_ids)) return bad(c, 'ordered_ids_required', 422, ["ordered_ids"]);
    const expectedVersion = body.expected_version ?? body.expectedVersion;
    const result = await reorderEventWaitlist(c.env.DB, {
      occurrenceId: c.req.param('id'),
      lineAccountId: account_id,
      orderedIds: body.ordered_ids as string[],
      expectedVersion: Number.isInteger(expectedVersion) ? (expectedVersion as number) : undefined,
    });
    if (result.kind === 'not_found') return bad(c, 'not_found', 404);
    if (result.kind === 'conflict') {
      return c.json({ error: 'version_conflict', currentVersion: result.currentVersion }, 409);
    }
    if (result.kind === 'invalid') return bad(c, result.error, 422, ["ordered_ids","expected_version","expectedVersion"]);
    const actor = changeActor(c);
    const occurrence = await c.env.DB
      .prepare(`SELECT event_id FROM event_slots WHERE id = ?`)
      .bind(c.req.param('id'))
      .first<{ event_id: string }>();
    const log = await writeEventChangeLog(c.env.DB, {
      lineAccountId: account_id,
      eventId: occurrence?.event_id ?? '',
      slotId: c.req.param('id'),
      actorId: actor.id,
      actorRole: actor.role,
      action: 'waitlist_reorder',
      reason,
      afterJson: JSON.stringify({ order: result.order }),
    });
    return c.json({
      success: true,
      occurrence_version: result.occurrenceVersion,
      order: result.order,
      log_id: log.id,
    });
  },
);

// POST /api/events/admin/occurrences/:id/waitlist/skip
// 飛ばし（今回の案内を見送り、最後尾へ回す）。理由が必須。行は消さない。
events.post(
  '/api/events/admin/occurrences/:id/waitlist/skip',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), async (c) => {
    const account_id = getAccountId(c);
    if (!account_id) return bad(c, 'account_id_required', 400, []);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = waitlistReason(body);
    if (!reason) return bad(c, 'waitlist_reason_required', 422, ["reason"]);
    if (typeof body.waitlist_id !== 'string' || body.waitlist_id.length === 0) {
      return bad(c, 'waitlist_id_required', 422, ["waitlist_id"]);
    }
    const expectedVersion = body.expected_version ?? body.expectedVersion;
    const result = await skipEventWaitlist(c.env.DB, {
      occurrenceId: c.req.param('id'),
      waitlistId: body.waitlist_id,
      lineAccountId: account_id,
      expectedVersion: Number.isInteger(expectedVersion) ? (expectedVersion as number) : undefined,
    });
    if (result.kind === 'not_found') return bad(c, 'not_found', 404);
    if (result.kind === 'conflict') {
      return c.json({ error: 'version_conflict', currentVersion: result.currentVersion }, 409);
    }
    if (result.kind === 'invalid') return bad(c, result.error, 422, ["waitlist_id","expected_version","expectedVersion"]);
    const actor = changeActor(c);
    const occurrence = await c.env.DB
      .prepare(`SELECT event_id FROM event_slots WHERE id = ?`)
      .bind(c.req.param('id'))
      .first<{ event_id: string }>();
    const log = await writeEventChangeLog(c.env.DB, {
      lineAccountId: account_id,
      eventId: occurrence?.event_id ?? '',
      slotId: c.req.param('id'),
      actorId: actor.id,
      actorRole: actor.role,
      action: 'waitlist_skip',
      reason,
      afterJson: JSON.stringify({ waitlist_id: result.waitlistId }),
    });
    return c.json({
      success: true,
      occurrence_version: result.occurrenceVersion,
      waitlist_id: result.waitlistId,
      log_id: log.id,
    });
  },
);
}
