import { logger } from '@line-crm/shared/server';
import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { notifyForBooking } from '../../features/booking/booking-notification/index.js';
import { inputError, inputJsonBoundary } from '../../lib/input-errors.js';
import type { BookingCustomerNotification } from '@line-crm/shared';
import { requireRole, requirePermission } from '../../middleware/role-guard.js';
import { getAvailability } from '../../services/availability.js';
import { enqueueCalendarDeleteOperation, removeBookingFromGoogle, runBookingGoogleSync, runCalendarDeleteOperation } from '../../features/booking/booking-calendar-sync/index.js';
import { type NotificationKind } from '../../features/booking/booking-notifier/index.js';
import { type BookingStatus } from '../../features/booking/booking-types/index.js';
import { recordBookingAudit } from '@line-crm/db';
import { claimBookingOperationForRetry } from '../../features/booking/booking-operation-runs/index.js';
import { updateAdminBooking } from './update.js';
import { resolveAccountIdAdmin, assertStaffInAccount } from './identity.js';
import { googleCredentials, bookingConflictAlternatives } from './availability.js';
import { staffAuditActor, AVAILABILITY_BATCH_MAX_MENUS } from './notification-input.js';

export function registerChangeActions(booking: Hono<Env>): void {
booking.patch('/api/booking/admin/bookings/:id', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), (c) => updateAdminBooking(c));

booking.post('/api/booking/admin/bookings/:id/reassign', requireRole('owner', 'admin', 'staff'), requirePermission('/booking/bookings'), inputJsonBoundary(), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
  const body = await c.req.json<{ staffId?: unknown; notifyCustomer?: unknown }>().catch(() => null);
  if (!body || typeof body.staffId !== 'string' || !body.staffId.trim() || typeof body.notifyCustomer !== 'boolean') return inputError(c, { error: 'invalid_reassign' }, 400, ["staffId","notifyCustomer"]);
  const row = await c.env.DB.prepare('SELECT lock_version,starts_at,staff_id,friend_id FROM bookings WHERE id=? AND line_account_id=?').bind(c.req.param('id'),accountId).first<{ lock_version: number; starts_at: string; staff_id: string; friend_id: string | null }>();
  if (!row) return c.json({ error: 'booking_not_found' }, 404);
  // 移動APIでは必ず今の空き判定を通す。過去の実績修正は通常の変更口へ。
  if (Date.parse(row.starts_at) < Date.now() || row.staff_id === body.staffId.trim()) return c.json({ error: 'slot_not_available' }, 409);
  const response = await updateAdminBooking(c, { lock_version: row.lock_version, staff_id: body.staffId.trim(), send_change_notification: body.notifyCustomer });
  if (!response.ok) return response;
  const result = await response.json() as { change_notification: string };
  const customerNotification: BookingCustomerNotification = {
    channel: row.friend_id ? 'line' : 'phone',
    status: !body.notifyCustomer ? 'not_requested' : !row.friend_id ? 'action_required'
      : result.change_notification === 'queued' ? 'queued' : 'sending_stopped',
    guidance: body.notifyCustomer && !row.friend_id
      ? 'LINEにつながっていないお客さまです。担当が変わったことを電話でお知らせしてください。' : null,
  };
  return c.json({ ...result, customerNotification });
});

/**
 * Google カレンダー同期の手動再試行 (N-392)。
 *
 * 失敗行 (retry_wait/permanent_failed) だけを対象にする。成功・取消ずみの
 * 行は触らず 409、実行中 (queued) は二重実行を避けて 409。
 * confirmed は delete+create の再同期、cancelled/expired は削除の再実行。
 */
booking.post('/api/booking/admin/bookings/:id/sync/retry', requireRole('owner', 'admin', 'staff'), inputJsonBoundary(), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
  const bookingId = c.req.param('id');
  const row = await c.env.DB
    .prepare(`SELECT id, status FROM bookings WHERE id = ? AND line_account_id = ?`)
    .bind(bookingId, accountId)
    .first<{ id: string; status: string }>();
  if (!row) return c.json({ error: 'booking_not_found' }, 404);

  const failed = await c.env.DB
    .prepare(
      `SELECT id, status FROM booking_operation_runs
        WHERE booking_id = ? AND line_account_id = ? AND kind = 'google_calendar'
          AND status IN ('retry_wait','permanent_failed')
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(bookingId, accountId)
    .first<{ id: string; status: string }>();
  const inFlight = await c.env.DB
    .prepare(
      `SELECT id FROM booking_operation_runs
        WHERE booking_id = ? AND line_account_id = ? AND kind = 'google_calendar'
          AND status = 'queued' LIMIT 1`,
    )
    .bind(bookingId, accountId)
    .first<{ id: string }>();
  if (inFlight) return c.json({ error: 'operation_in_progress' }, 409);
  if (!failed) return c.json({ error: 'no_retryable_operation' }, 409);

  let outcome: 'succeeded' | 'skipped' | 'retry_wait' | 'not_applicable';
  if (row.status === 'cancelled' || row.status === 'expired') {
    // 取消済み予約の削除再試行。安定キー台帳へ集めてから同じ実行口を通す。
    await enqueueCalendarDeleteOperation(c.env.DB, { bookingId, lineAccountId: accountId });
    outcome = await runCalendarDeleteOperation(c.env.DB, {
      bookingId,
      lineAccountId: accountId,
      remove: () => removeBookingFromGoogle(c.env.DB, googleCredentials(c.env), bookingId),
    });
  } else {
    outcome = await runBookingGoogleSync(c.env.DB, {
      bookingId,
      lineAccountId: accountId,
      credentials: googleCredentials(c.env),
      operationId: failed.id,
    });
  }
  await recordBookingAudit(c.env.DB, {
    bookingId,
    lineAccountId: accountId,
    action: 'sync_retried',
    before: { operation_id: failed.id, operation_status: failed.status },
    after: { outcome },
    ...staffAuditActor(c),
    occurredAt: new Date().toISOString(),
  });
  return c.json({ status: outcome });
});

/**
 * LINE 通知の手動再試行 (N-393)。
 *
 * 対象は confirmation_line 台帳の未成功行。成功ずみは二重送信を避けて 409。
 * 失敗しても行に error_code を残したまま 200 で実状態を返す。
 */
booking.post(
  '/api/booking/admin/bookings/:id/notifications/:runId/retry',
  requireRole('owner', 'admin', 'staff'),
  inputJsonBoundary(), async (c) => {
    const accountId = await resolveAccountIdAdmin(c);
    if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
    const bookingId = c.req.param('id');
    const runId = c.req.param('runId');
    const bookingRow = await c.env.DB
      .prepare(`SELECT id, status, friend_id FROM bookings WHERE id = ? AND line_account_id = ?`)
      .bind(bookingId, accountId)
      .first<{ id: string; status: BookingStatus; friend_id: string | null }>();
    if (!bookingRow) return c.json({ error: 'booking_not_found' }, 404);
    if (!bookingRow.friend_id) return inputError(c, { error: 'line_notification_unavailable' }, 422, ["notification_policy"]);
    const op = await c.env.DB
      .prepare(
        `SELECT id, kind, status, result_json, error_code FROM booking_operation_runs
          WHERE id = ? AND booking_id = ? AND line_account_id = ?`,
      )
      .bind(runId, bookingId, accountId)
      .first<{ id: string; kind: string; status: string; result_json: string | null; error_code: string | null }>();
    if (!op || op.kind !== 'confirmation_line') {
      return c.json({ error: 'operation_not_found' }, 404);
    }
    let notificationKind: NotificationKind = 'approved';
    try {
      const parsed = op.result_json ? JSON.parse(op.result_json) as Record<string, unknown> : {};
      const raw = parsed.notificationKind;
      if (raw === 'requested' || raw === 'approved' || raw === 'rejected'
        || raw === 'expired' || raw === 'changed') {
        notificationKind = raw;
      }
    } catch {
      /* 壊れた result_json は既定の approved で送る */
    }
    // R324: 失効した通知は送らない。通知の意味と今の予約状態が合うときだけ送る。
    // approved/changed は確定ずみ、requested/rejected/expired はその状態の予約にだけ送る。
    // 行の状態より先に見る。止めた行でも理由が運用者に見える。
    const retryableStatuses: Record<NotificationKind, BookingStatus[]> = {
      requested: ['requested'],
      approved: ['confirmed'],
      rejected: ['rejected'],
      expired: ['expired'],
      changed: ['confirmed'],
      day_before: ['confirmed'],
      hours_before: ['confirmed'],
      // 待ち知らせは予約の操作台帳を通さないため、ここでは再送しない。
      waitlist_invite: [],
    };
    if (!retryableStatuses[notificationKind].includes(bookingRow.status)) {
      return c.json({
        error: 'notification_obsolete',
        notification_kind: notificationKind,
        booking_status: bookingRow.status,
      }, 409);
    }
    if (op.error_code === 'delivery_unknown') return c.json({ error: 'delivery_unknown' }, 409);
    if (op.status === 'succeeded') {
      return c.json({ error: 'already_succeeded' }, 409);
    }
    if (op.status === 'skipped' || op.status === 'cancelled') {
      return c.json({ error: 'not_retryable' }, 409);
    }
    // 実行中（queued）の行へ手動再送すると二重送信になり得る。
    // Google 側と同じく 409 で引く。
    if (op.status === 'queued') {
      return c.json({ error: 'operation_in_progress' }, 409);
    }
    // R323: 失敗行を条件付き UPDATE で一度だけ取得する。取れなければ
    // 別要求が送信中のため送らない (二重送信を防ぐ)。
    if (!await claimBookingOperationForRetry(c.env.DB, { id: op.id, kind: 'confirmation_line' })) {
      const current = await c.env.DB
        .prepare(`SELECT status FROM booking_operation_runs WHERE id = ?`)
        .bind(op.id)
        .first<{ status: string }>();
      if (current?.status === 'succeeded') return c.json({ error: 'already_succeeded' }, 409);
      if (current?.status === 'skipped' || current?.status === 'cancelled') {
        return c.json({ error: 'not_retryable' }, 409);
      }
      if (current?.status === 'queued') return c.json({ error: 'operation_in_progress' }, 409);
      return c.json({ error: 'retry_in_progress' }, 409);
    }
    let outcome: 'succeeded' | 'failed' = 'succeeded';
    try {
      // R323: 同じ行の再送・回収は安定キーで行い、LINE 側の到達ずみ再送は冪等に吸収する。
      await notifyForBooking(c.env.DB, bookingId, notificationKind, op.id);
    } catch (error) {
      outcome = 'failed';
      logger.error("booking.admin_bookings_by_id_notifications_by_run_id_retry_create_failed");
    }
    const refreshed = await c.env.DB
      .prepare(`SELECT status, error_code FROM booking_operation_runs WHERE id = ?`)
      .bind(op.id)
      .first<{ status: string; error_code: string | null }>();
    await recordBookingAudit(c.env.DB, {
      bookingId,
      lineAccountId: accountId,
      action: 'notification_retried',
      before: { operation_id: op.id, kind: notificationKind, status: op.status },
      after: { status: refreshed?.status ?? outcome },
      ...staffAuditActor(c),
      occurredAt: new Date().toISOString(),
    });
    return c.json({
      status: outcome === 'succeeded' ? 'succeeded' : 'failed',
      operation_status: refreshed?.status ?? null,
      error_code: refreshed?.error_code ?? null,
    });
  },
);

booking.get('/api/booking/admin/alternatives', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const menuId = c.req.query('menu_id')?.trim();
  const staffId = c.req.query('staff_id')?.trim();
  const startsAt = new Date(c.req.query('starts_at') ?? '');
  if (!menuId || !staffId || Number.isNaN(startsAt.getTime())) {
    return c.json({ error: 'missing_params' }, 400);
  }
  if (!await assertStaffInAccount(c.env.DB, staffId, accountId)) {
    return c.json({ error: 'staff_not_found' }, 404);
  }
  const menu = await c.env.DB.prepare(
    `SELECT COALESCE(sm.override_duration_minutes, m.duration_minutes) AS duration_minutes
       FROM menus m
       LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?
      WHERE m.id = ? AND m.line_account_id = ? AND m.deleted_at IS NULL
        AND m.is_active = 1 AND sm.is_offered = 1`,
  ).bind(staffId, menuId, accountId).first<{ duration_minutes: number }>();
  if (!menu) return c.json({ error: 'menu_not_offered' }, 404);
  return c.json(await bookingConflictAlternatives(c.env.DB, c.env, {
    lineAccountId: accountId,
    menuId,
    staffId,
    startsAt,
    durationMinutes: Number(menu.duration_minutes),
  }));
});

booking.get('/api/booking/admin/availability', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const menuId = c.req.query('menu_id');
  /*
   * #1060: メニューごとの空き枠を1要求で返す一括モード。
   * `menu_ids`（カンマ区切り）があると `{ by_menu: [...] }` を返す。
   * 未指定なら従来どおり `menu_id` 1件の `{ by_staff, calendar_sync }`。
   */
  const menuIdsParam = c.req.query('menu_ids');
  const staffId = c.req.query('staff_id') || undefined;
  const from = c.req.query('from');
  const to = c.req.query('to');
  if ((!menuId && menuIdsParam === undefined) || !from || !to) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  if ((toD.getTime() - fromD.getTime()) / 86400_000 > 28) {
    return c.json({ error: 'range_too_wide' }, 400);
  }
  // 予約変更の枠選びでは変更対象を空き判定から外す。
  // 外さないと今の予約が自分と重なって「空きなし」に見える。
  const excludeBookingId = c.req.query('exclude_booking_id') || undefined;
  /*
   * (b): お客様の画面の見本（プレビュー）は、お客様と同じ店舗ルールで
   * 判定する。付けない呼び出しは従来どおりメニュー値だけを見る
   * （当日の電話予約など運用者向けの枠選びを塞がない）。
   */
  const applyStoreRules = c.req.query('apply_store_rules') === '1';
  if (menuIdsParam !== undefined) {
    const menuIds = [...new Set(
      menuIdsParam.split(',').map((id) => id.trim()).filter(Boolean),
    )];
    if (menuIds.length > AVAILABILITY_BATCH_MAX_MENUS) {
      return c.json({ error: 'too_many_menus' }, 400);
    }
    // メニュー間に共有する中間状態は無いので並列で取る。N往復のHTTPが1往復に
    // なる（DBの読みはメニュー分だが、認証・アカウント解決・往復は1回）。
    const by_menu = await Promise.all(menuIds.map(async (id) => ({
      menu_id: id,
      ...(await getAvailability(c.env.DB, {
        lineAccountId: accountId,
        menuId: id,
        staffId,
        from,
        to,
        now: new Date(),
        minLeadTimeMinutes: 0,
        googleCredentials: googleCredentials(c.env),
        excludeBookingId,
        applyStoreRules,
      })),
    })));
    return c.json({ by_menu });
  }
  const result = await getAvailability(c.env.DB, {
    lineAccountId: accountId,
    menuId: menuId!,
    staffId,
    from,
    to,
    now: new Date(),
    minLeadTimeMinutes: 0,
    googleCredentials: googleCredentials(c.env),
    excludeBookingId,
    applyStoreRules,
  });
  return c.json(result);
});
}
