import { logger } from '@line-crm/shared/server';
import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { menuAudience } from '../../features/booking/booking-audience/index.js';
import { sqlIdSet } from '@line-crm/db/id-queries';
import { inputError, inputJsonBoundary } from '../../lib/input-errors.js';
import { listMenuVersions, revertMenuToVersion, menuVersionContentLines, replaceBookingMenuResources } from '@line-crm/db';
import { BOOKING_MENUS_KEY } from '@line-crm/shared';
import { requirePermission } from '../../middleware/role-guard.js';
import { resolveAccountIdAdmin } from './identity.js';
import { readBookingMenuResources } from './settings-input.js';

export function registerMenusRead(booking: Hono<Env>): void {
booking.get('/api/booking/admin/menus/preview-as',async(c)=>{
 const account=await resolveAccountIdAdmin(c),friend=c.req.query('friend_id');
 if(!account||!friend)return c.json({error:'missing_params'},400);
 if(!await c.env.DB.prepare('SELECT id FROM friends WHERE id=? AND line_account_id=?').bind(friend,account).first())return c.json({error:'not_found'},404);
 const menus=(await c.env.DB.prepare('SELECT * FROM menus WHERE line_account_id=? AND deleted_at IS NULL ORDER BY sort_order,id').bind(account).all<{id:string}>()).results;
 const results=[];for(const menu of menus)results.push({...menu,...await menuAudience(c.env.DB,account,menu.id,friend)});
 return c.json({success:true,data:results});
});

booking.get('/api/booking/admin/menus', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  try {
    const [rows, staffRows, countRows] = await Promise.all([
      c.env.DB.prepare(
        `SELECT m.id, m.name, m.category_label, m.description,
                m.duration_minutes, m.buffer_after_minutes,
                m.base_price, m.price_mode, m.version,
                m.sort_order, m.is_active, m.auto_tag_id,m.audience_mode,m.audience_tag_ids_json,m.addon_menu_ids_json,m.max_party_size,m.addon_only,m.hq_template_id,m.hq_template_version_id,m.hq_customized,m.image_url,
                m.concurrent_capacity, m.booking_window_days, m.cutoff_hours_before,
                m.cancel_deadline_hours_before, m.intake_question,
                COALESCE((
                  SELECT json_group_array(json_object(
                    'menuId', assigned.menu_id,
                    'resourceId', assigned.resource_id,
                    'name', assigned.name,
                    'type', assigned.resource_type,
                    'capacity', assigned.capacity,
                    'quantity', assigned.quantity,
                    'isActive', assigned.is_active = 1,
                    'warning', CASE
                      WHEN assigned.is_active != 1 THEN 'resource_inactive'
                      WHEN assigned.quantity > assigned.capacity THEN 'capacity_exceeded'
                      ELSE NULL END
                  ))
                  FROM (
                    SELECT mr.menu_id, mr.resource_id, mr.quantity,
                           r.name, r.resource_type, r.capacity, r.is_active
                    FROM booking_menu_resources mr
                    INNER JOIN booking_resources r ON r.id = mr.resource_id
                    WHERE mr.menu_id = m.id AND r.line_account_id = m.line_account_id
                    ORDER BY r.name ASC, r.id ASC
                  ) assigned
                ), '[]') AS assigned_resources_json,
                COALESCE(bs.booking_window_days, 60) AS store_booking_window_days,
                COALESCE(bs.cutoff_minutes_before, 1440) AS store_cutoff_minutes_before,
                COALESCE(bs.cancel_deadline_minutes_before, 1440) AS store_cancel_deadline_minutes_before
           FROM menus m
      LEFT JOIN booking_settings bs ON bs.line_account_id = m.line_account_id
          WHERE m.line_account_id = ? AND m.deleted_at IS NULL
          ORDER BY m.sort_order ASC, m.id ASC`,
      )
      .bind(accountId)
      .all<Record<string, unknown>>(),
      c.env.DB.prepare(
        `SELECT sm.menu_id, s.id, s.display_name
           FROM staff_menus sm
           JOIN menus m ON m.id = sm.menu_id
           JOIN staff s ON s.id = sm.staff_id
          WHERE m.line_account_id = ? AND m.deleted_at IS NULL
            AND s.line_account_id = m.line_account_id
            AND s.deleted_at IS NULL AND s.is_active = 1 AND sm.is_offered = 1
          ORDER BY s.sort_order ASC, s.id ASC`,
      ).bind(accountId).all<{ menu_id: string; id: string; display_name: string }>(),
      c.env.DB.prepare(
        `SELECT menu_id, COUNT(*) AS booking_count
           FROM bookings
          WHERE line_account_id = ?
            AND requested_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
          GROUP BY menu_id`,
      ).bind(accountId).all<{ menu_id: string; booking_count: number }>(),
    ]);
    const staffByMenu = new Map<string, Array<{ id: string; display_name: string }>>();
    for (const row of staffRows.results ?? []) {
      const assigned = staffByMenu.get(row.menu_id) ?? [];
      assigned.push({ id: row.id, display_name: row.display_name });
      staffByMenu.set(row.menu_id, assigned);
    }
    const countByMenu = new Map(
      (countRows.results ?? []).map((row) => [row.menu_id, Number(row.booking_count) || 0]),
    );
    return c.json({
      menus: (rows.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        category_label: row.category_label,
        description: row.description,
        duration_minutes: row.duration_minutes,
        buffer_after_minutes: row.buffer_after_minutes,
        base_price: row.base_price,
        price_mode: row.price_mode,
        version: row.version,
        sort_order: row.sort_order,
        is_active: row.is_active,
        auto_tag_id: row.auto_tag_id,
        audience_mode:row.audience_mode,audience_tag_ids_json:row.audience_tag_ids_json,
        addon_menu_ids_json:row.addon_menu_ids_json,max_party_size:row.max_party_size,addon_only:row.addon_only,
        hq_template_id:row.hq_template_id,hq_template_version_id:row.hq_template_version_id,hq_customized:row.hq_customized,image_url:row.image_url,
        concurrent_capacity: row.concurrent_capacity,
        booking_window_days: row.booking_window_days,
        cutoff_hours_before: row.cutoff_hours_before,
        cancel_deadline_hours_before: row.cancel_deadline_hours_before,
        intake_question: row.intake_question,
        assigned_staff: staffByMenu.get(String(row.id)) ?? [],
        // menu版と割当を同じSELECT snapshotで返す。別々に読むと、保存batchが
        // 間へ入ったとき「新しい版＋古い割当」を利用者へ返してしまう。
        assigned_resources: (JSON.parse(String(row.assigned_resources_json ?? '[]')) as Array<Record<string, unknown>>)
          .map((resource) => ({
            ...resource,
            isActive: Number(resource.isActive) === 1,
            warning: Number(resource.isActive) !== 1
              ? 'resource_inactive'
              : Number(resource.quantity) > Number(resource.capacity) ? 'capacity_exceeded' : null,
          })),
        booking_count_30_days: countByMenu.get(String(row.id)) ?? 0,
        effectiveBookingRules: {
          bookingWindowDays: row.booking_window_days ?? row.store_booking_window_days,
          cutoffMinutesBefore: row.cutoff_hours_before == null
            ? row.store_cutoff_minutes_before
            : Number(row.cutoff_hours_before) * 60,
          cancelDeadlineMinutesBefore: row.cancel_deadline_hours_before == null
            ? row.store_cancel_deadline_minutes_before
            : Number(row.cancel_deadline_hours_before) * 60,
          source: {
            bookingWindowDays: row.booking_window_days == null ? 'store' : 'menu',
            cutoffMinutesBefore: row.cutoff_hours_before == null ? 'store' : 'menu',
            cancelDeadlineMinutesBefore: row.cancel_deadline_hours_before == null ? 'store' : 'menu',
          },
        },
      })),
    });
  } catch {
    logger.error("booking_menu_list_failed");
    return c.json({ error: 'booking_menu_data_unavailable' }, 503);
  }
});

booking.put('/api/booking/admin/menus/:id/resources', requirePermission(BOOKING_MENUS_KEY), inputJsonBoundary(), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { success: false, error: 'missing_account_id' }, 400, ["account_id"]);
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return inputError(c, { success: false, error: 'invalid_json' }, 400, []);
    const parsed = readBookingMenuResources(body);
    if (!parsed.ok) return inputError(c, { success: false, error: parsed.error }, 400, ["expectedVersion","resources"]);
    const result = await replaceBookingMenuResources(c.env.DB, {
      menuId: c.req.param('id'), lineAccountId: accountId,
      expectedVersion: parsed.expectedVersion, resources: parsed.resources,
      staffId: c.get('staff')?.id ?? null,
    });
    if (result.status === 'not_found') return c.json({ success: false, error: 'not_found' }, 404);
    if (result.status === 'conflict') {
      return c.json({
        success: false, code: 'version_conflict',
        error: '予約メニューが更新されています。読み直してください',
        data: { currentVersion: result.currentVersion },
      }, 409);
    }
    if (result.status === 'invalid_resource') {
      return inputError(c, {
        success: false, code: 'invalid_resource',
        error: '選択した設備を利用できません。設備の状態と必要数を確認してください',
      }, 400, ["expectedVersion","resources"]);
    }
    return c.json({
      success: true,
      data: { id: c.req.param('id'), version: result.version, resources: result.resources },
    });
  } catch {
    logger.error("booking_menu_resources_update_failed");
    return c.json({ success: false, error: 'booking_menu_resources_save_failed' }, 503);
  }
});

/**
 * 版の履歴 (T)。一覧・中身は見るだけの権限で読める。
 * 「この版に戻す」は保存と同じ権限が要る。
 */
booking.get('/api/booking/admin/menus/:id/versions', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const versions = await listMenuVersions(c.env.DB, {
    menuId: c.req.param('id'), lineAccountId: accountId,
  });
  if (!versions) return c.json({ error: 'not_found' }, 404);
  const staffIds = [...new Set(versions.map((v) => v.createdByStaffId).filter((id): id is string => !!id))];
  const staffNames = new Map<string, string>();
  if (staffIds.length > 0) {
    const staffRows = await c.env.DB.prepare(
      `SELECT id, display_name FROM staff WHERE id IN (${sqlIdSet(staffIds).sql})`,
    ).bind(...(staffIds.length ? sqlIdSet(staffIds).binds : [])).all<{ id: string; display_name: string }>();
    for (const row of staffRows.results ?? []) staffNames.set(row.id, row.display_name);
  }
  return c.json({
    versions: versions.map((version) => ({
      version_number: version.versionNumber,
      title: `第${version.versionNumber}版`,
      status: version.status,
      summary: version.summary,
      author: version.createdByStaffId ? (staffNames.get(version.createdByStaffId) ?? null) : null,
      at: version.createdAt,
      lines: menuVersionContentLines(version),
    })),
  });
});

booking.get('/api/booking/admin/menus/:id/versions/:version', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const versionNumber = Number(c.req.param('version'));
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    return c.json({ error: 'not_found' }, 404);
  }
  const versions = await listMenuVersions(c.env.DB, {
    menuId: c.req.param('id'), lineAccountId: accountId,
  });
  const version = versions?.find((v) => v.versionNumber === versionNumber) ?? null;
  if (!version) return c.json({ error: 'not_found' }, 404);
  return c.json({
    version: {
      version_number: version.versionNumber,
      title: `第${version.versionNumber}版`,
      status: version.status,
      summary: version.summary,
      at: version.createdAt,
      lines: menuVersionContentLines(version),
    },
  });
});

booking.post('/api/booking/admin/menus/:id/versions/:version/revert', requirePermission(BOOKING_MENUS_KEY), inputJsonBoundary(), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
  const versionNumber = Number(c.req.param('version'));
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(versionNumber) || versionNumber < 1
    || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return inputError(c, { error: 'expectedVersionは1以上の整数で指定してください' }, 400, ["expectedVersion"]);
  }
  const result = await revertMenuToVersion(c.env.DB, {
    menuId: c.req.param('id'),
    lineAccountId: accountId,
    versionNumber,
    expectedVersion,
    staffId: c.get('staff')?.id ?? null,
  });
  if (result.status === 'not_found') return c.json({ error: 'not_found' }, 404);
  if (result.status === 'conflict') {
    return c.json({
      success: false,
      code: 'version_conflict',
      error: '予約メニューが更新されています。読み直してください',
      data: { currentVersion: result.currentVersion },
    }, 409);
  }
  return c.json({ ok: true, version: result.version });
});
}
