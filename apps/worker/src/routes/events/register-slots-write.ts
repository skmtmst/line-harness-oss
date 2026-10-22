import { logger } from '@line-crm/shared/server';
import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { bad } from '../../services/event-input-error.js';
import { inputJsonBoundary } from '../../lib/input-errors.js';
import { requireRole } from '../../middleware/role-guard.js';
import { reconcileV6ToStartsAt, rescheduleByTrigger } from '../../services/reminder-trigger.js';
import { createBroadcast, getBroadcastById, type Broadcast } from '@line-crm/db';

import { createEventWaitlistOfferSender, getEventOccurrenceUsedSeats, promoteEventWaitlist } from '../../services/event-waitlist.js';
import { writeEventChangeLog } from '../../services/event-change-review.js';
import { getEventApplicantSnapshot } from '../../services/event-applicant-snapshot.js';
import { getAccountId, UUID_PATTERN, eventApplicantBroadcastDraft, EventApplicantBroadcastDraft } from './input.js';
import { waitlistReason, changeActor, rebuildRemindersForSlot } from './admin-input.js';
import { ownsEvent, SlotInput, validateSlotInput } from './slot-input.js';

export function registerSlotsWrite(events: Hono<Env>): void {
// preview時点の申込者IDをbroadcastの条件へ保存する。confirm/send時に予約一覧を
// 読み直さないため、その後の申込・取消・タグ変更で宛先が入れ替わらない。
events.post(
  '/api/events/admin/occurrences/:id/applicant-broadcasts/preview',
  requireRole('owner', 'admin'),
  inputJsonBoundary(), async (c) => {
    const accountId = getAccountId(c);
    if (!accountId) return bad(c, 'account_id_required', 400, []);
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) return bad(c, 'idempotency_key_required', 400, []);
    const body = (await c.req.json<{ title?: unknown; messageContent?: unknown; snapshotId?: unknown }>()
      .catch(() => ({}))) as { title?: unknown; messageContent?: unknown; snapshotId?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const messageContent = typeof body.messageContent === 'string' ? body.messageContent.trim() : '';
    if (!title || !messageContent || messageContent.length > 5_000) return bad(c, 'invalid_broadcast_content', 422, ["title","messageContent"]);
    const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId : '';
    if (!snapshotId) return bad(c, 'applicant_snapshot_required', 422, ["snapshotId"]);

    const occurrenceId = c.req.param('id');
    const replayExisting = (existing: Broadcast): Response => {
      const draft = eventApplicantBroadcastDraft(existing.draft_payload_json);
      if (existing.title !== title || existing.message_content !== messageContent
        || existing.line_account_id !== accountId || existing.target_type !== 'segment'
        || !draft || draft.snapshotId !== snapshotId || draft.occurrenceId !== occurrenceId) {
        return bad(c, 'idempotency_key_conflict', 409);
      }
      const segmentConditions = JSON.stringify({ operator: 'AND', rules: [{ type: 'friend_id_in', value: draft.recipientIds }] });
      if (existing.segment_conditions !== segmentConditions) return bad(c, 'idempotency_key_conflict', 409);
      c.header('Idempotency-Replayed', 'true');
      return c.json({ success: true, data: { broadcastId: existing.id, recipientCount: draft.recipientIds.length } });
    };
    const existing = await getBroadcastById(c.env.DB, idempotencyKey);
    if (existing) {
      return replayExisting(existing);
    }
    const loaded = await getEventApplicantSnapshot(c.env.DB, {
      id: snapshotId,
      lineAccountId: accountId,
      occurrenceId,
      staffId: c.get('staff')!.id,
    });
    if (loaded.kind === 'not_found') return bad(c, 'not_found', 404);
    if (loaded.kind === 'expired') return bad(c, 'applicant_snapshot_expired', 410);
    if (loaded.kind === 'invalid') return bad(c, 'applicant_snapshot_invalid', 409);
    const friendIds = [...new Set(loaded.snapshot.data.applicants.map((applicant) => applicant.friendId))];
    if (friendIds.length === 0) return bad(c, 'no_applicants_to_broadcast', 422, ["snapshotId"]);
    const segmentConditions = JSON.stringify({ operator: 'AND', rules: [{ type: 'friend_id_in', value: friendIds }] });
    let broadcast: Broadcast;
    try {
      broadcast = await createBroadcast(c.env.DB, {
        id: idempotencyKey, title, messageType: 'text', messageContent, targetType: 'segment',
        lineAccountId: accountId, segmentConditions, saveAsDraft: true, draftStep: 'confirm',
        draftPayloadJson: JSON.stringify({
          kind: 'event_occurrence_applicant_snapshot', snapshotId, occurrenceId, recipientIds: friendIds,
        } satisfies EventApplicantBroadcastDraft),
      });
    } catch (error) {
      // 同じkeyを同時に押した競合だけは、PK衝突を500にせず勝者の結果を再生する。
      const raced = await getBroadcastById(c.env.DB, idempotencyKey);
      if (raced) return replayExisting(raced);
      throw error;
    }
    return c.json({ success: true, data: { broadcastId: broadcast.id, recipientCount: friendIds.length } }, 201);
  },
);

events.post(
  '/api/events/admin/occurrences/:id/waitlist/promote',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), async (c) => {
    const accountId = getAccountId(c);
    if (!accountId) return bad(c, 'account_id_required', 400, []);
    const rawBody = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // U: 手動の繰り上げは理由が必須（順番の変更・飛ばしと同じ決めごと）。
    const reason = waitlistReason(rawBody);
    if (!reason) return bad(c, 'waitlist_reason_required', 422, []);
    const expectedVersion = rawBody.expectedVersion ?? rawBody.expected_version;
    if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1) {
      return bad(c, 'expected_version_required', 422, []);
    }
    try {
      const result = await promoteEventWaitlist(c.env.DB, {
        occurrenceId: c.req.param('id'),
        lineAccountId: accountId,
        expectedVersion: expectedVersion as number,
        sender: createEventWaitlistOfferSender(c.env.DB, { liffUrl: c.env.LIFF_URL }),
      });
      if (result.kind === 'not_found') return bad(c, 'not_found', 404);
      if (result.kind === 'conflict') {
        return c.json(
          { error: 'version_conflict', currentVersion: result.currentVersion },
          409,
        );
      }
      if (result.kind === 'promoted') {
        const actor = changeActor(c);
        const occurrence = await c.env.DB
          .prepare(`SELECT event_id FROM event_slots WHERE id = ?`)
          .bind(c.req.param('id'))
          .first<{ event_id: string }>();
        await writeEventChangeLog(c.env.DB, {
          lineAccountId: accountId,
          eventId: occurrence?.event_id ?? '',
          slotId: c.req.param('id'),
          actorId: actor.id,
          actorRole: actor.role,
          action: 'waitlist_promote',
          reason,
          afterJson: JSON.stringify({ waitlist_id: result.promoted.waitlistId }),
        });
      }
      return c.json({ success: true, data: result });
    } catch (error) {
      logger.error("events.admin_occurrences_by_id_waitlist_promote_create_failed");
      return c.json({ error: 'waitlist_notification_failed' }, 503);
    }
  },
);

events.post('/api/events/admin/events/:id/slots', requireRole('owner', 'admin'), inputJsonBoundary(), async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400, []);
  const event_id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, event_id, account_id))) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as { slots?: SlotInput[] };
  if (!Array.isArray(body.slots) || body.slots.length === 0) return bad(c, 'slots_required', 422, ["slots"]);
  if (body.slots.length > 400) {
    return bad(c, '一度に追加できるのは400件までです。400件以下に分けて追加してください', 422, ["slots"]);
  }
  // 入力は挿入前に全部検証する。途中で 422 を返すと、そこまでの分だけ
  // 残る部分成功になるため。
  for (const s of body.slots) {
    const v = validateSlotInput(s, true);
    if (!v.ok) return bad(c, v.code, 422, []);
  }

  /*
    #1000 DETAIL-11: client_key 付きの枠は、同じイベント内の既存キーを
    持つ枠をそのまま返し、再送による二重登録を吸収する。日時の一意制約は
    正当な同時開催を壊すので使わない。応答喪失(作成済みだが結果が届かない)
    への再送も同じ仕組みで安全になる。
  */
  const requestKeys = body.slots
    .map((s) => s.client_key)
    .filter((k): k is string => typeof k === 'string');
  const existingByKey = new Map<string, Record<string, unknown>>();
  for (let offset = 0; offset < requestKeys.length; offset += 90) {
    const chunk = requestKeys.slice(offset, offset + 90);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await c.env.DB
      .prepare(
        `SELECT * FROM event_slots
          WHERE event_id = ? AND deleted_at IS NULL AND client_key IN (${placeholders})`,
      )
      .bind(event_id, ...chunk)
      .all<Record<string, unknown>>();
    for (const row of results ?? []) existingByKey.set(row.client_key as string, row);
  }

  const insertStatements: D1PreparedStatement[] = [];
  const pendingIds: string[] = [];
  const keyToInputIndex = new Map<string, number>();
  type Resolution =
    | { type: 'existing'; row: Record<string, unknown> }
    | { type: 'insert'; pendingIndex: number }
    | { type: 'alias'; ref: number };
  const resolutions: Resolution[] = [];
  body.slots.forEach((s, index) => {
    const key = typeof s.client_key === 'string' ? s.client_key : null;
    if (key) {
      const earlier = keyToInputIndex.get(key);
      // 同じリクエスト内のキー重複は、先に解決した枠を指す。
      if (earlier !== undefined) {
        resolutions.push({ type: 'alias', ref: earlier });
        return;
      }
      const existing = existingByKey.get(key);
      if (existing) {
        keyToInputIndex.set(key, index);
        resolutions.push({ type: 'existing', row: existing });
        return;
      }
      keyToInputIndex.set(key, index);
    }
    const id = crypto.randomUUID();
    resolutions.push({ type: 'insert', pendingIndex: pendingIds.length });
    pendingIds.push(id);
    insertStatements.push(c.env.DB
      .prepare(
        `INSERT INTO event_slots
           (id, event_id, starts_at, ends_at, capacity, is_active, sort_order, client_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        event_id,
        s.starts_at as string,
        s.ends_at as string,
        s.capacity ?? null,
        s.is_active ?? 1,
        s.sort_order ?? 0,
        key,
      ));
  });
  if (insertStatements.length > 0) await c.env.DB.batch(insertStatements);

  const rowsById = new Map<string, Record<string, unknown>>();
  for (let offset = 0; offset < pendingIds.length; offset += 90) {
    const chunk = pendingIds.slice(offset, offset + 90);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await c.env.DB
      .prepare(`SELECT * FROM event_slots WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<Record<string, unknown>>();
    for (const row of results ?? []) rowsById.set(row.id as string, row);
  }
  // 入力順を保って返す。再送で既存枠に解決した分は deduplicated: true。
  const resolvedRows: Array<Record<string, unknown> | null> = new Array(body.slots.length).fill(null);
  const deduplicated: boolean[] = new Array(body.slots.length).fill(false);
  resolutions.forEach((r, index) => {
    if (r.type === 'existing') {
      resolvedRows[index] = r.row;
      deduplicated[index] = true;
    } else if (r.type === 'insert') {
      resolvedRows[index] = rowsById.get(pendingIds[r.pendingIndex]) ?? null;
    } else {
      // alias は必ず先の入力を指すので、ここでは解決済み。
      resolvedRows[index] = resolvedRows[r.ref];
      deduplicated[index] = true;
    }
  });
  const items = resolvedRows.flatMap((row, index) =>
    row ? [{ ...row, deduplicated: deduplicated[index] }] : [],
  );
  const deduplicatedCount = items.filter((item) => item.deduplicated).length;
  return c.json(
    { items, created_count: items.length - deduplicatedCount, deduplicated_count: deduplicatedCount },
    201,
  );
});

events.put('/api/events/admin/events/:id/slots/:slotId', requireRole('owner', 'admin'), inputJsonBoundary(), async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400, []);
  const event_id = c.req.param('id');
  const slot_id = c.req.param('slotId');
  if (!(await ownsEvent(c.env.DB, event_id, account_id))) return bad(c, 'not_found', 404);
  const slot = await c.env.DB
    .prepare(`SELECT * FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL`)
    .bind(slot_id, event_id)
    .first<Record<string, unknown>>();
  if (!slot) return bad(c, 'not_found', 404);
  const body = (await c.req.json().catch(() => ({}))) as SlotInput & {
    expected_version?: unknown;
    expectedVersion?: unknown;
  };
  // m26g R577: 枠の並行編集・有効切替の競合検出（-29 §13「変更系は
  // 期待版を必須にし、版競合は 409 で最新内容と差分を返す」）。
  // 版なしの更新は受けず、古い版は 409 + 最新の枠を返す。画面は
  // 読み直して差分を見せる。イベント本体 PUT と同じ決め。
  const slotExpectedVersion = body.expected_version ?? body.expectedVersion;
  if (!Number.isInteger(slotExpectedVersion) || (slotExpectedVersion as number) < 1) {
    return bad(c, 'expected_version_required', 422, ["expected_version","expectedVersion"]);
  }
  if ((slot.version as number) !== slotExpectedVersion) {
    // 古い画面からの操作は、枠時刻の通知作り直しなどの副作用を
    // 走らせる前に止める。書き込み時の条件付き更新が最終の審判で、
    // こちらは速やかな失敗のための事前確認。
    return c.json({ error: 'version_conflict', data: { current: slot } }, 409);
  }
  // when only one of starts_at / ends_at is provided, range check uses existing values
  const merged: SlotInput = {
    starts_at: body.starts_at ?? (slot.starts_at as string),
    ends_at: body.ends_at ?? (slot.ends_at as string),
    capacity: body.capacity,
    is_active: body.is_active,
    sort_order: body.sort_order,
  };
  const v = validateSlotInput(merged, false);
  if (!v.ok) return bad(c, v.code, 422, ["starts_at","ends_at","capacity","is_active","sort_order"]);

  // 申込が入った枠の定員は、使われている席より小さくできない。
  // 削除側は slot_has_bookings で止めている。ここも同じ約束にする。
  // ウィザードの右欄の説明どおりにする。null(定員なし)への変更は許す。
  if (Object.prototype.hasOwnProperty.call(body, 'capacity') && body.capacity != null) {
    const usedSeats = await getEventOccurrenceUsedSeats(c.env.DB, slot_id);
    if (body.capacity < usedSeats) return bad(c, 'slot_capacity_below_bookings', 409);
  }

  const updatable = ['starts_at', 'ends_at', 'capacity', 'is_active', 'sort_order'] as const;
  const setClauses: string[] = [];
  const setValues: unknown[] = [];
  for (const k of updatable) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      setClauses.push(`${k} = ?`);
      setValues.push((body as Record<string, unknown>)[k]);
    }
  }
  if (setClauses.length === 0) {
    return c.json(slot);
  }
  // If the slot time moved, reminders for the slot's confirmed bookings are
  // now stale (they still point at the old starts_at).
  // N-065: の未来予定だけを先に新基準日へ移す (枠更新より前)。
  // 枠を先に更新すると、の途中失敗後の再送で旧起点が分からなくなり、
  // 移行前の行が旧日のまま残る。を先にすると失敗時は枠が untouched の
  // まま 500 になるため、同じリクエストの再送がそのまま回復になる。
  // 送信済みは残し、現在の枠時刻へ直すため再送は冪等。
  const slotStartsAtChanging = Object.prototype.hasOwnProperty.call(body, 'starts_at');
  if (slotStartsAtChanging) {
    const oldStartsAt = slot.starts_at as string;
    const newStartsAt = body.starts_at as string;
    const confirmed = await c.env.DB
      .prepare(
        `SELECT id, friend_id, line_account_id FROM event_bookings
          WHERE slot_id = ? AND status = 'confirmed'`,
      )
      .bind(slot_id)
      .all<{ id: string; friend_id: string; line_account_id: string }>();
    const bookings = confirmed.results ?? [];
    if (oldStartsAt !== newStartsAt) {
      // 複数予約を1件ずつ移す。途中で落ちると一部だけ新日時になるため、
      // (1) 各件の前に旧起点へ戻して同じ形からやり直し (heal-first)、
      // (2) 失敗時は動かし終えた分を旧起点へ戻して (補償)、
      // 枠 untouched のまま 500 にする。再送はそのまま回復になる。
      const moved: typeof bookings = [];
      try {
        for (const bookingRow of bookings) {
          const v6Base = {
            triggerType: 'event' as const,
            sourceId: bookingRow.id,
            sourceEventId: bookingRow.id,
            friendId: bookingRow.friend_id,
            lineAccountId: bookingRow.line_account_id,
          };
          await reconcileV6ToStartsAt(c.env.DB, { ...v6Base, startsAtIso: oldStartsAt });
          await rescheduleByTrigger(c.env.DB, {
            ...v6Base,
            oldStartsAtIso: oldStartsAt,
            newStartsAtIso: newStartsAt,
          });
          await reconcileV6ToStartsAt(c.env.DB, { ...v6Base, startsAtIso: newStartsAt });
          moved.push(bookingRow);
        }
      } catch (error) {
        for (const bookingRow of moved) {
          try {
            await rescheduleByTrigger(c.env.DB, {
              triggerType: 'event',
              sourceId: bookingRow.id,
              sourceEventId: bookingRow.id,
              friendId: bookingRow.friend_id,
              oldStartsAtIso: newStartsAt,
              newStartsAtIso: oldStartsAt,
              lineAccountId: bookingRow.line_account_id,
            });
            await reconcileV6ToStartsAt(c.env.DB, {
              triggerType: 'event',
              sourceId: bookingRow.id,
              sourceEventId: bookingRow.id,
              friendId: bookingRow.friend_id,
              startsAtIso: oldStartsAt,
            });
          } catch (compensationError) {
            logger.error("events.admin_events_by_id_slots_by_slot_id_update_failed");
          }
        }
        throw error;
      }
    } else {
      for (const bookingRow of bookings) {
        await reconcileV6ToStartsAt(c.env.DB, {
          triggerType: 'event',
          sourceId: bookingRow.id,
          sourceEventId: bookingRow.id,
          friendId: bookingRow.friend_id,
          startsAtIso: newStartsAt,
        });
      }
    }
  }
  setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  setClauses.push(`version = version + 1`);
  setValues.push(slot_id, slotExpectedVersion);
  const slotUpdated = await c.env.DB
    .prepare(`UPDATE event_slots SET ${setClauses.join(', ')} WHERE id = ? AND version = ? AND deleted_at IS NULL`)
    .bind(...setValues)
    .run();
  if ((slotUpdated.meta?.changes ?? 0) === 0) {
    const current = await c.env.DB.prepare(`SELECT * FROM event_slots WHERE id = ?`).bind(slot_id).first();
    if (!current || (current as Record<string, unknown>).deleted_at != null) {
      return bad(c, 'not_found', 404);
    }
    // 敗者に最新内容（差分のもと）を返す。画面は ApiError.data.current
    // で読んで、一覧の読み直しと合わせて見せる。
    return c.json({ error: 'version_conflict', data: { current } }, 409);
  }
  if (slotStartsAtChanging) {
    // 旧表の作り直しは更新後の枠時刻を読むため、枠更新の後に行う。
    await rebuildRemindersForSlot(c.env.DB, slot_id);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM event_slots WHERE id = ?`).bind(slot_id).first();
  return c.json(row);
});
}
