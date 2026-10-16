import { automationRevisionToken, publishAutomationDraft } from '../services/automation-drafts.js';

import { Hono } from 'hono';

import { createBookingAvailabilityException } from '@line-crm/db';
import type { Env } from '../index.js';

import { hasStaffPermission } from '../middleware/role-guard.js';
import { StyleError, profile } from '../services/style-setup.js';

import { validRestaurantDate } from '../services/restaurant-booking.js';
import { base, account, json, edit, text, oneOf } from './styles-common.js';
export const styles = new Hono<Env>();

// Reuse availability exceptions: these writes never cancel existing reservations.
styles.post(base + '/closures', async (c) => {
  edit(c, 'booking.settings');
  const a = await account(c),
    b = await json(c);
  const date = text(b.date, 10),
    target = oneOf(b.target, ['store', 'staff']);
  if (!date || !validRestaurantDate(date)) throw new StyleError('invalid_date');
  const start = text(b.startTime, 5),
    end = text(b.endTime, 5),
    allDay = b.allDay === true;
  if (
    !allDay &&
    (!start ||
      !end ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
      start >= end)
  )
    throw new StyleError('invalid_time');
  const scopeId = target === 'staff' ? text(b.staffId, 100) : null;
  if (target === 'staff' && !scopeId) throw new StyleError('staff_required');
  let open: Array<{ start: string; end: string }> = [];
  if (!allDay) {
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    if (target === 'store')
      open = (
        await c.env.DB.prepare(
          `SELECT h.start_time start,h.end_time end FROM booking_business_hours h JOIN booking_settings s ON s.id=h.booking_settings_id WHERE s.line_account_id=? AND h.weekday=?`,
        )
          .bind(a, weekday)
          .all<{ start: string; end: string }>()
      ).results;
    else {
      const shifts = (
        await c.env.DB.prepare(
          `SELECT sh.start_time start,sh.end_time end FROM staff_shifts sh JOIN staff s ON s.id=sh.staff_id WHERE s.line_account_id=? AND s.id=? AND sh.work_date=?`,
        )
          .bind(a, scopeId, date)
          .all<{ start: string; end: string }>()
      ).results;
      open = shifts.length
        ? shifts
        : (
            await c.env.DB.prepare(
              `SELECT r.start_time start,r.end_time end FROM staff_availability_rules r JOIN staff s ON s.id=r.staff_id WHERE s.line_account_id=? AND s.id=? AND r.weekday=? AND r.is_active=1`,
            )
              .bind(a, scopeId, weekday)
              .all<{ start: string; end: string }>()
          ).results;
    }
    const existing = (
      await c.env.DB.prepare(
        "SELECT scope_kind,scope_id,kind,hours_json FROM booking_availability_exceptions WHERE line_account_id=? AND date_from<=? AND date_to>=? AND (scope_kind='store' OR (scope_kind=? AND scope_id IS ?)) ORDER BY created_at,id",
      )
        .bind(a, date, date, target, scopeId)
        .all<{
          kind: string;
          hours_json: string;
          scope_kind: string;
          scope_id: string | null;
        }>()
    ).results;
    if (existing.length)
      throw new StyleError('existing_exception_use_edit', 409);
    if (!open.length) throw new StyleError('working_hours_unconfigured', 422);
    open = open.flatMap((i) => {
      if (i.end <= start! || i.start >= end!) return [i];
      return [
        ...(i.start < start! ? [{ start: i.start, end: start! }] : []),
        ...(i.end > end! ? [{ start: end!, end: i.end }] : []),
      ];
    });
  }
  const item = await createBookingAvailabilityException(c.env.DB, {
    lineAccountId: a,
    scopeKind: target as 'store' | 'staff',
    scopeId,
    dateFrom: date,
    dateTo: date,
    kind: allDay || !open.length ? 'closed' : 'custom_hours',
    intervals: allDay ? [] : open,
    reason: text(b.reason),
  });
  if (!item) throw new StyleError('scope_not_found', 404);
  return c.json(
    {
      success: true,
      data: { exception: item, existingReservationsCancelled: false },
    },
    201,
  );
});

styles.patch(base + '/meet/:id', async (c) => {
  edit(c, '/booking/bookings');
  const a = await account(c),
    b = await json(c),
    id = c.req.param('id');
  const r = await c.env.DB.prepare(
    'SELECT m.* FROM meet_consultations m JOIN friends f ON f.id=m.friend_id WHERE m.id=? AND f.line_account_id=?',
  )
    .bind(id, a)
    .first<Record<string, string | null>>();
  if (!r) throw new StyleError('not_found', 404);
  if (b.expectedUpdatedAt !== r.updated_at)
    throw new StyleError('version_conflict', 409);
  if (
    c.get('staff').role === 'staff' &&
    !(await c.env.DB.prepare(
      'SELECT id FROM staff WHERE id=? AND staff_member_id=? AND line_account_id=?',
    )
      .bind(r.staff_id, c.get('staff').id, a)
      .first())
  )
    throw new StyleError('forbidden', 403);
  const staffId = b.staffId === undefined ? r.staff_id : text(b.staffId, 100);
  if (
    staffId &&
    !(await c.env.DB.prepare(
      'SELECT id FROM staff WHERE id=? AND line_account_id=? AND is_active=1',
    )
      .bind(staffId, a)
      .first())
  )
    throw new StyleError('staff_not_found', 404);
  const outcome =
      b.outcome === undefined
        ? r.consultation_outcome
        : oneOf(b.outcome, ['considering', 'won', 'lost'], true),
    attendance =
      b.attendance === undefined
        ? r.attendance
        : oneOf(b.attendance, ['visited', 'late', 'no_show'], true),
    now = new Date().toISOString();
  const changed = await c.env.DB.prepare(
    'UPDATE meet_consultations SET staff_id=?,attendance=?,consultation_outcome=?,outcome_recorded_at=?,outcome_recorded_by=?,updated_at=? WHERE id=? AND updated_at=?',
  )
    .bind(
      staffId,
      attendance,
      outcome,
      b.outcome === undefined ? r.outcome_recorded_at : now,
      b.outcome === undefined ? r.outcome_recorded_by : c.get('staff').id,
      now,
      id,
      r.updated_at,
    )
    .run();
  if (!changed.meta.changes) throw new StyleError('version_conflict', 409);
  return c.json({ success: true, data: { id, updatedAt: now } });
});

styles.get(base + '/starter-items', async (c) => {
  const a = await account(c);
  const rows = (
    await c.env.DB.prepare(
      'SELECT * FROM style_starter_items WHERE line_account_id=? ORDER BY applied_at,item_key',
    )
      .bind(a)
      .all<Record<string, unknown>>()
  ).results;
  const items = [];
  for (const item of rows) {
    let status: unknown = null,
      draftRevision: string | null = null;
    if (item.kind === 'automation') {
      const row = await c.env.DB.prepare(
        `SELECT d.status,d.current_draft_version_id,v.trigger_type,v.trigger_config,v.condition_config,v.action_config FROM automation_definitions d LEFT JOIN automation_versions v ON v.id=d.current_draft_version_id WHERE d.id=? AND d.line_account_id=?`,
      )
        .bind(item.target_id, a)
        .first<{
          status: string;
          current_draft_version_id: string | null;
          trigger_type: string;
          trigger_config: string;
          condition_config: string;
          action_config: string;
        }>();
      status = row?.status ?? 'missing';
      if (row?.current_draft_version_id)
        draftRevision = await automationRevisionToken(
          row.current_draft_version_id,
          row,
        );
    } else if (item.kind === 'booking_menu')
      status = (
        await c.env.DB.prepare(
          'SELECT is_active FROM menus WHERE id=? AND line_account_id=?',
        )
          .bind(item.target_id, a)
          .first<{ is_active: number }>()
      )?.is_active
        ? 'active'
        : 'stopped';
    else if (item.kind === 'rich_menu')
      status =
        (
          await c.env.DB.prepare(
            'SELECT status FROM rich_menu_groups WHERE id=? AND account_id=?',
          )
            .bind(item.target_id, a)
            .first<{ status: string }>()
        )?.status ?? 'missing';
    items.push({ ...item, status, draftRevision });
  }
  return c.json({ success: true, data: { items } });
});

styles.post(base + '/activate', async (c) => {
  edit(c);
  const a = await account(c),
    b = await json(c);
  if (
    b.confirmed !== true ||
    !Array.isArray(b.items) ||
    !b.items.length ||
    b.items.length > 30
  )
    throw new StyleError('confirmation_required');
  const seen = new Set<string>();
  for (const item of b.items) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      seen.has(item.id) ||
      !['automation', 'booking_menu'].includes(item.kind)
    )
      throw new StyleError('invalid_activation');
    seen.add(item.id);
    if (
      !(await c.env.DB.prepare(
        'SELECT 1 FROM style_starter_items WHERE line_account_id=? AND target_id=? AND kind=? AND is_sample=1',
      )
        .bind(a, item.id, item.kind)
        .first())
    )
      throw new StyleError('not_found', 404);
  }
  const items = [];
  for (const item of b.items) {
    try {
      if (item.kind === 'automation') {
        if (!hasStaffPermission(c, '/automations'))
          throw new StyleError('forbidden', 403);
        const p = await profile(c.env.DB, a);
        const answer = JSON.parse(p?.answers_json ?? '{}').reminders;
        if (
          p?.selection_mode !== 'configured' ||
          answer?.mode !== 'configured' ||
          answer.value === false
        )
          throw new StyleError('feature_unconfigured', 422);
        const activated = await publishAutomationDraft(c.env.DB, {
          id: item.id,
          lineAccountId: a,
          expectedDraftVersionId: item.expectedDraftVersionId,
          activate: true,
          expectedStatus: 'draft',
        });
        items.push({ id: item.id, success: true, status: activated.status });
      } else {
        const setup = await profile(c.env.DB, a);
        const answer = JSON.parse(setup?.answers_json ?? '{}').booking;
        if (
          setup?.selection_mode !== 'configured' ||
          answer?.mode !== 'configured' ||
          answer.value === false
        )
          throw new StyleError('feature_unconfigured', 422);
        if (!hasStaffPermission(c, '/booking/menus'))
          throw new StyleError('forbidden', 403);
        const r = await c.env.DB.prepare(
          'UPDATE menus SET is_active=1,version=version+1 WHERE id=? AND line_account_id=? AND version=?',
        )
          .bind(item.id, a, item.expectedVersion)
          .run();
        if (!r.meta.changes) throw new StyleError('version_conflict', 409);
        items.push({ id: item.id, success: true, status: 'active' });
      }
    } catch (e) {
      items.push({
        id: item.id,
        success: false,
        code: e instanceof StyleError ? e.code : 'activation_failed',
      });
    }
  }
  return c.json({
    success: true,
    data: { complete: items.every((i) => i.success), items },
  });
});
