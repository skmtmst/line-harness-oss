import { logger } from '@line-crm/shared/server';
import type { Env } from '../../worker-env.js';
import type { Hono } from 'hono';
import { readAddonSettings } from '../../features/booking/booking-addons/index.js';
import { readAudienceWrite } from '../../features/booking/booking-audience/index.js';
import { gapWrite, GapError } from '../../services/gap-common.js';
import { inputError, inputJsonBoundary } from '../../lib/input-errors.js';
import { reorderBookingMenus } from '@line-crm/db';
import { updateBookingMenuSettings, recordMenuVersion, type BookingPriceMode } from '@line-crm/db';
import type { BookingMenuReorderRequest } from '@line-crm/shared';


import { BOOKING_MENUS_KEY } from '@line-crm/shared';
import { requirePermission } from '../../middleware/role-guard.js';
import { findIdempotencyResponse, saveIdempotencyResponse } from '../../features/booking/booking-idempotency/index.js';
import { MENU_IDEMPOTENCY_TTL_MINUTES } from '../../features/booking/booking-types/index.js';
import { resolveAccountIdAdmin } from './identity.js';
import { MenuBookingRuleBody, readMenuBase, readMenuBookingRules } from './menu-input.js';
import { readPriceModeAndAmount, BOOKING_PRICE_MODES } from './settings-input.js';
import { readAutoTagId, isAssignableAutoTag, toMenuActiveFlag } from './menu-snapshot.js';

export function registerMenusWrite(booking: Hono<Env>): void {
booking.post('/api/booking/admin/menus', requirePermission(BOOKING_MENUS_KEY), inputJsonBoundary({"name":["string"],"category_label":["null","string"],"description":["null","string"],"duration_minutes":["number"],"buffer_after_minutes":["number"],"base_price":["number"],"price_mode":["string"],"sort_order":["number"],"is_active":["number","boolean"]}), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
  /*
   * R535: 応答消失後の再送で同じメニューを2件作らない。呼び出し側が
   * 作成試行ごとに付ける一意キーで作成済み応答を返す。検証で落ちた
   * 要求は保存しないので、入力を直して同じキーで送り直せる。キーの無い
   * 従来の呼び出しは従来どおり毎回作成する。migration 無しで済ませるため、LIFF用の
   * 冪等表を借り、subject には friend ではなく staff id を入れる。
   * 照合は (key, account, staff) の範囲に閉じ、別アカウントの行は
   * 別物として扱う（=tenant 越しの id 漏れ防止）。
   */
  const idemKey = c.req.header('Idempotency-Key')?.trim() || null;
  const staffSubject = c.get('staff')?.id ?? 'admin';
  const idemScope = {
    key: idemKey ?? '',
    lineAccountId: accountId,
    friendId: staffSubject,
    now: new Date(),
  };
  if (idemKey) {
    const cached = await findIdempotencyResponse(c.env.DB, idemScope);
    if (cached) return c.json(cached.body as Record<string, unknown>, cached.status as 201);
  }
  const b = await c.req.json<{
    name: string;
    category_label?: string | null;
    description?: string | null;
    duration_minutes: number;
    buffer_after_minutes?: number;
    base_price?: number;
    price_mode?: BookingPriceMode;
    sort_order?: number;
    auto_tag_id?: string | null;
    is_active?: boolean | number;
  } & MenuBookingRuleBody>();
  const base = readMenuBase(b);
  if (!base.ok) return inputError(c, { error: base.error }, 400, ["name","duration_minutes","buffer_after_minutes","sort_order"]);
  const rules = readMenuBookingRules(b);
  if (!rules.ok) return inputError(c, { error: rules.error }, 400, ["intake_question"]);
  const hasPriceMode = Object.prototype.hasOwnProperty.call(b, 'price_mode');
  const price = readPriceModeAndAmount(hasPriceMode ? b : {
    price_mode: 'fixed', base_price: b.base_price,
  });
  if (!price.ok) return inputError(c, { error: price.error }, 400, ["base_price"]);
  const autoTag = readAutoTagId(b as unknown as Record<string, unknown>);
  if (!autoTag.ok) return inputError(c, { error: autoTag.error }, 400, ["auto_tag_id"]);
  const autoTagId = autoTag.value;
  if (autoTagId && !(await isAssignableAutoTag(c.env.DB, autoTagId, accountId))) {
    return inputError(c, { error: 'tag_not_found' }, 400, ["auto_tag_id"]);
  }
  const audience=await readAudienceWrite(c.env.DB,accountId,b as unknown as Record<string,unknown>),addons=await readAddonSettings(c.env.DB,accountId,b as unknown as Record<string,unknown>);
  if(audience||addons.sets.length)gapWrite(c,{admin:true});
  const extraRules:Record<string,unknown>={...rules.value};if(audience){extraRules.audience_mode=audience.mode;extraRules.audience_tag_ids_json=JSON.stringify(audience.ids);}
  addons.sets.forEach((set,i)=>{extraRules[set.split(' = ')[0]]=addons.values[i];});
  const id = crypto.randomUUID();
  const ruleColumns = Object.keys(extraRules);
  await c.env.DB
    .prepare(
      // 受付条件は送られたものだけを列に足す。送られなければ既定値
      // （従来と同じ動き）が入る。
      `INSERT INTO menus
        (id, line_account_id, name, category_label, description,
         duration_minutes, buffer_after_minutes, base_price, price_mode, sort_order, auto_tag_id, is_active${
           ruleColumns.map((col) => `, ${col}`).join('')
         })
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?${ruleColumns.map(() => ',?').join('')})`,
    )
    .bind(
      id,
      accountId,
      base.value.name,
      b.category_label ?? null,
      b.description ?? null,
      base.value.durationMinutes,
      base.value.bufferAfterMinutes,
      price.basePrice,
      price.priceMode,
      base.value.sortOrder,
      autoTagId,
      toMenuActiveFlag(b.is_active),
      ...ruleColumns.map((col) => extraRules[col]),
    )
    .run();
  // R535: 同じキーの再送には作り直さずこの応答を返す。24時間の窓。
  if (idemKey) {
    await saveIdempotencyResponse(c.env.DB, {
      ...idemScope,
      status: 201,
      body: { id, version: 1 },
      ttlMinutes: MENU_IDEMPOTENCY_TTL_MINUTES,
    });
  }
  // 作った時点の中身を最初の版として残す（T）。
  await recordMenuVersion(c.env.DB, { menuId: id, staffId: c.get('staff')?.id ?? null });
  return c.json({ id, version: 1 }, 201);
});

booking.put('/api/booking/admin/menus/order', requirePermission(BOOKING_MENUS_KEY), inputJsonBoundary({"changes":["array"]}), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
  const body = await c.req.json<BookingMenuReorderRequest>().catch(() => null);
  const changes = body?.changes;
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > 1000 ||
      changes.some((item) => !item || typeof item.id !== 'string' || !item.id ||
        !Number.isInteger(item.expectedVersion) || item.expectedVersion < 1 || !Number.isSafeInteger(item.sortOrder)) ||
      new Set(changes.map((item) => item.id)).size !== changes.length) {
    return inputError(c, { error: 'invalid_menu_order' }, 400, ["changes"]);
  }
  if (!await reorderBookingMenus(c.env.DB, accountId, changes, c.get('staff')?.id ?? null)) {
    return c.json({ success: false, code: 'version_conflict', error: '予約メニューが更新されています。読み直してください' }, 409);
  }
  return c.json({ ok: true, versions: changes.map((item) => ({ id: item.id, version: item.expectedVersion + 1 })) });
});

booking.put('/api/booking/admin/menus/:id', requirePermission(BOOKING_MENUS_KEY), inputJsonBoundary({"name":["string"],"category_label":["null","string"],"description":["null","string"],"duration_minutes":["number"],"buffer_after_minutes":["number"],"base_price":["number"],"price_mode":["string"],"sort_order":["number"],"is_active":["number","boolean"],"expectedVersion":["number"]}), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { error: 'missing_account_id' }, 400, ["account_id"]);
  const id = c.req.param('id');
  const b = await c.req.json<{
    name: string;
    category_label?: string | null;
    description?: string | null;
    duration_minutes: number;
    buffer_after_minutes?: number;
    base_price: number;
    price_mode?: BookingPriceMode;
    sort_order?: number;
    is_active?: boolean | number;
    auto_tag_id?: string | null;
    expectedVersion?: number;
    expectedUpdatedAt?: unknown;
  } & MenuBookingRuleBody>();

  // 編集窓は一覧が返した version をそのまま送る。版なしの全体上書きは
  // 同時編集の後勝ちを黙って起こすので、必須にして拒否する。
  const expectedVersion = Number(b.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return inputError(c, { error: 'expectedVersionは1以上の整数で指定してください' }, 400, ["expectedVersion"]);
  }

  const base = readMenuBase(b);
  if (!base.ok) return inputError(c, { error: base.error }, 400, ["name","duration_minutes","buffer_after_minutes","sort_order"]);

  const rules = readMenuBookingRules(b);
  if (!rules.ok) return inputError(c, { error: rules.error }, 400, ["intake_question"]);
  const hasPriceMode = Object.prototype.hasOwnProperty.call(b, 'price_mode');
  const price = readPriceModeAndAmount(hasPriceMode ? b : {
    price_mode: 'fixed', base_price: b.base_price,
  });
  if (!price.ok) return inputError(c, { error: price.error }, 400, ["base_price"]);

  // 古いクライアントは新しい項目を送らない。`undefined` を null として
  // 書き込むと既存設定を消してしまうので、明示的に送られたものだけ更新する。
  // auto_tag_id が以前からこの扱いで、受付条件も同じにそろえた。
  const autoTag = readAutoTagId(b as unknown as Record<string, unknown>);
  if (!autoTag.ok) return inputError(c, { error: autoTag.error }, 400, ["auto_tag_id"]);
  const hasAutoTagId = autoTag.present;
  const autoTagId = autoTag.value;
  if (hasAutoTagId && autoTagId && !(await isAssignableAutoTag(c.env.DB, autoTagId, accountId))) {
    return inputError(c, { error: 'tag_not_found' }, 400, ["auto_tag_id"]);
  }

  if(b.is_active===true||b.is_active===1){const source=await c.env.DB.prepare('SELECT hq_template_id FROM menus WHERE id=? AND line_account_id=?').bind(id,accountId).first<{hq_template_id:string|null}>();if(source?.hq_template_id&&!await c.env.DB.prepare('SELECT 1 FROM staff_menus sm JOIN staff s ON s.id=sm.staff_id WHERE sm.menu_id=? AND sm.is_offered=1 AND s.line_account_id=? AND s.is_active=1 AND s.deleted_at IS NULL AND s.is_designation_optional=0').bind(id,accountId).first())throw new GapError('staff_selection_required');}
  if(Array.isArray((b as unknown as Record<string,unknown>).addonMenuIds)&&((b as unknown as Record<string,unknown>).addonMenuIds as unknown[]).includes(id))throw new GapError('invalid_addon_menus');
  const addonSettings=await readAddonSettings(c.env.DB,accountId,b as unknown as Record<string,unknown>);
  if(addonSettings.sets.length)gapWrite(c,{admin:true});
  const audience=await readAudienceWrite(c.env.DB,accountId,b as unknown as Record<string,unknown>);
  if(audience)gapWrite(c,{admin:true});
  // 常に書き込む項目（PUT なので、送られなければ既定値で上書きする）
  const sets: string[] = [
    'name = ?',
    'category_label = ?',
    'description = ?',
    'duration_minutes = ?',
    'buffer_after_minutes = ?',
    'base_price = ?',
    'sort_order = ?',
    'is_active = ?',
  ];
  const values: unknown[] = [
    base.value.name,
    b.category_label ?? null,
    b.description ?? null,
    base.value.durationMinutes,
    base.value.bufferAfterMinutes,
    price.basePrice,
    base.value.sortOrder,
    toMenuActiveFlag(b.is_active),
  ];
  sets.push(...addonSettings.sets);values.push(...addonSettings.values);
  if(audience){sets.push('audience_mode = ?','audience_tag_ids_json = ?');values.push(audience.mode,JSON.stringify(audience.ids));}
  if (hasPriceMode) {
    sets.push('price_mode = ?');
    values.push(price.priceMode);
  }
  if (hasAutoTagId) {
    sets.push('auto_tag_id = ?');
    values.push(autoTagId);
  }
  for (const [column, value] of Object.entries(rules.value)) {
    sets.push(`${column} = ?`);
    values.push(value);
  }

  // expectedUpdatedAt が送られてきたときだけ、日時でも比べる。
  // 違えば409で止めて今の版と日時を返す。送らなければ従来どおり版だけで比べる。
  if (typeof b.expectedUpdatedAt === 'string') {
    const currentMenu = await c.env.DB
      .prepare(`SELECT version, updated_at FROM menus
          WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`)
      .bind(id, accountId)
      .first<{ version: number; updated_at: string }>();
    if (currentMenu && currentMenu.updated_at !== b.expectedUpdatedAt) {
      return c.json({
        success: false,
        code: 'version_conflict',
        error: '予約メニューが更新されています。読み直してください',
        data: { currentVersion: Number(currentMenu.version), currentUpdatedAt: currentMenu.updated_at },
      }, 409);
    }
  }

  // version を WHERE に入れて読んだ時点の行へだけ書き、成功時だけ 1 進める。
  // PATCH /resources と同じ形で、ずれていたら現在版を返して読み直させる。
  const result = await c.env.DB
    .prepare(
      `UPDATE menus
          SET ${sets.join(', ')},
              version = version + 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL AND version = ?`,
    )
    .bind(...values, id, accountId, expectedVersion)
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    // 保存するたびに版を1つ足す（T）。前の版は変えない。
    await recordMenuVersion(c.env.DB, { menuId: id, staffId: c.get('staff')?.id ?? null });
    return c.json({ ok: true, version: expectedVersion + 1 });
  }
  const current = await c.env.DB
    .prepare(`SELECT version FROM menus
        WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`)
    .bind(id, accountId)
    .first<{ version: number }>();
  if (!current) return c.json({ error: 'not_found' }, 404);
  return c.json({
    success: false,
    code: 'version_conflict',
    error: '予約メニューが更新されています。読み直してください',
    data: { currentVersion: Number(current.version) },
  }, 409);
});

booking.patch('/api/booking/admin/menus/:id', requirePermission(BOOKING_MENUS_KEY), inputJsonBoundary(), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return inputError(c, { success: false, error: 'missing_account_id' }, 400, ["account_id"]);
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const expectedVersion = Number(body?.expectedVersion);
    if (!body || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return inputError(c, { success: false, error: 'expectedVersionは1以上の整数で指定してください' }, 400, ["expectedVersion"]);
    }
    const hasPriceMode = Object.prototype.hasOwnProperty.call(body, 'price_mode');
    const hasBasePrice = Object.prototype.hasOwnProperty.call(body, 'base_price');
    let priceMode: BookingPriceMode | undefined;
    let basePrice: number | undefined;
    if (hasPriceMode) {
      const rawMode = String(body.price_mode) as BookingPriceMode;
      if (!BOOKING_PRICE_MODES.has(rawMode)) {
        return inputError(c, { success: false, error: 'price_mode must be fixed, free, or inquiry' }, 400, ["price_mode"]);
      }
      priceMode = rawMode;
      if (rawMode !== 'fixed') basePrice = 0;
    }
    if (hasBasePrice && priceMode !== 'free' && priceMode !== 'inquiry') {
      const amount = Number(body.base_price);
      if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
        return inputError(c, { success: false, error: 'base_price must be an integer between 0 and 100000000' }, 400, ["base_price"]);
      }
      basePrice = amount;
    }
    const rules = readMenuBookingRules(body);
    if (!rules.ok) return inputError(c, { success: false, error: rules.error }, 400, ["intake_question"]);
    // 公開切替だけの更新(一覧の「止める・出す」)も版付きで受ける。
    // 数値 1/0 と真偽値のどちらも受け、止める側(0/false)に倒す。
    let isActive: boolean | undefined;
    if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
      const rawActive = body.is_active;
      if (rawActive === true || rawActive === 1) isActive = true;
      else if (rawActive === false || rawActive === 0) isActive = false;
      else {
        return inputError(c, { success: false, error: 'is_active は true/false または 1/0 で指定してください' }, 400, ["is_active"]);
      }
    }
    const result = await updateBookingMenuSettings(c.env.DB, {
      id: c.req.param('id'),
      lineAccountId: accountId,
      expectedVersion,
      priceMode,
      basePrice,
      isActive,
      staffId: c.get('staff')?.id ?? null,
      bookingWindowDays: rules.value.booking_window_days as number | null | undefined,
      cutoffHoursBefore: rules.value.cutoff_hours_before as number | null | undefined,
      cancelDeadlineHoursBefore: rules.value.cancel_deadline_hours_before as number | null | undefined,
    });
    if (result.status === 'no_changes') {
      return inputError(c, { success: false, error: '更新する項目を指定してください' }, 400, ["intake_question"]);
    }
    if (result.status === 'not_found') return c.json({ success: false, error: 'not_found' }, 404);
    if (result.status === 'conflict') {
      return c.json({
        success: false,
        code: 'version_conflict',
        error: '予約メニューが更新されています。読み直してください',
        data: { currentVersion: result.currentVersion },
      }, 409);
    }
    return c.json({ success: true, data: { id: c.req.param('id'), version: result.version } });
  } catch {
    logger.error("booking_menu_settings_update_failed");
    return c.json({ success: false, error: 'booking_menu_save_failed' }, 503);
  }
});

booking.delete('/api/booking/admin/menus/:id', requirePermission(BOOKING_MENUS_KEY), async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const menu = await c.env.DB.prepare('SELECT id FROM menus WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL')
    .bind(id, accountId).first();
  if (!menu) return c.json({ error: 'not_found' }, 404);
  // 予約の履歴があるメニューは残す。同時に予約が付いてもUPDATEの条件で止める。
  const result = await c.env.DB.prepare(`UPDATE menus
    SET deleted_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
    WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM bookings WHERE menu_id = menus.id)`)
    .bind(id, accountId).run();
  if (!result.meta.changes) return c.json({ error: 'menu_has_bookings', code: 'menu_has_bookings' }, 409);
  return c.json({ ok: true });
});

// ---- Staff CRUD ----

// Admin mirror of the LIFF menu-staff lookup — used by the iOS app's
// proxy-booking flow (operator books on behalf of a friend from chat).
booking.get('/api/booking/admin/menus/:id/staff', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const menuId = c.req.param('id');
  const rows = await c.env.DB
    .prepare(
      `SELECT s.id, s.display_name, s.role, s.profile_image_url, s.bio,
              s.is_designation_optional,s.nomination_fee,
              COALESCE(sm.override_price, m.base_price) AS price,
              m.price_mode,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS duration_minutes
         FROM staff s
         INNER JOIN staff_menus sm ON sm.staff_id = s.id AND sm.menu_id = ?2 AND sm.is_offered = 1
         INNER JOIN menus m ON m.id = ?2
        WHERE s.line_account_id = ?1 AND s.is_active = 1 AND s.deleted_at IS NULL
        ORDER BY s.is_designation_optional DESC, s.sort_order ASC, s.id ASC`,
    )
    .bind(accountId, menuId)
    .all();
  return c.json({ staff: rows.results });
});
}
