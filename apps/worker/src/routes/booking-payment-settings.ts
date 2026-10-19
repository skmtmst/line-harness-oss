import { logger } from '@line-crm/shared/server';
import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { inputError } from '../lib/input-errors.js';

const modes = ['none', 'onsite', 'online', 'customer_choice'];
export interface PaymentSettingTarget {
  kind: 'course' | 'event'; id: string; account: string; storeId?: string;
}

/** 対象の所属・権限は呼出し元で確認する。対象別の保存形式はここでそろえる。 */
export async function paymentSettingResponse(
  c: Context<Env>, db: D1Database, target: PaymentSettingTarget, field: 'mode' | 'unitPrice',
) {
  const table = target.kind === 'course' ? 'restaurant_course_payment_settings' : 'event_payment_settings';
  const idColumn = target.kind === 'course' ? 'menu_id' : 'event_id';
  const column = field === 'mode' ? 'mode' : 'unit_price';
  try {
    if (c.req.method === 'GET') {
      const row = await db.prepare(`SELECT ${column} AS value,version FROM ${table} WHERE ${idColumn}=? AND line_account_id=?`)
        .bind(target.id, target.account).first<{ value: string | number | null; version: number }>();
      return c.json({ success: true, data: { [field]: row?.value ?? (field === 'mode' ? null : 0), version: row?.version ?? 0 } });
    }
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const value = body?.[field];
    if (!body || (field === 'mode' ? value !== null && !modes.includes(value as string)
      : !Number.isSafeInteger(value) || (value as number) < 0)
      || (body.expectedVersion !== undefined && (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0))) {
      return inputError(c, { success: false, error: 'invalid_payment_setting' }, 400, [field, 'expectedVersion']);
    }
    const extraColumns = target.kind === 'course' ? ',store_id' : '';
    const extraValues = target.kind === 'course' ? ',?' : '';
    // expectedVersionのある画面は版競合を検出する。既存Dの呼出し形（省略）も保つ。
    const expected = body.expectedVersion ?? null;
    const args = [target.id, target.account, value, c.get('staff').id, new Date().toISOString(),
      ...(target.kind === 'course' ? [target.storeId!] : []), expected, expected, target.id, target.account, expected, expected, expected];
    const row = await db.prepare(`INSERT INTO ${table} (${idColumn},line_account_id,${column},updated_by,updated_at${extraColumns})
      SELECT ?,?,?,?,?${extraValues} WHERE ? IS NULL OR ?=0 OR EXISTS
        (SELECT 1 FROM ${table} WHERE ${idColumn}=? AND line_account_id=? AND version=?)
      ON CONFLICT(${idColumn}) DO UPDATE SET ${column}=excluded.${column},version=${table}.version+1,
        updated_by=excluded.updated_by,updated_at=excluded.updated_at
      WHERE ${table}.line_account_id=excluded.line_account_id AND (? IS NULL OR ${table}.version=?)
      RETURNING ${column} AS value,version`).bind(...args).first<{ value: string | number | null; version: number }>();
    if (!row) return c.json({ success: false, error: 'version_conflict', code: 'version_conflict' }, 409);
    return c.json({ success: true, data: { [field]: row.value, version: row.version } });
  } catch (error) {
    const missing = String(error).includes(`no such table: ${table}`);
    const code = missing
      ? target.kind === 'course' ? 'course_payment_storage_not_ready' : 'event_payment_storage_not_ready'
      : 'payment_admin_unavailable';
    logger.error(code);
    return c.json({ success: false, error: code, code }, 503);
  }
}
