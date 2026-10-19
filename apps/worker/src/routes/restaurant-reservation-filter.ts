import { isCalendarDate as isExistingCalendarDate, scheduledJstIso } from '@line-crm/shared';
import type { Context } from 'hono';
import type { Env } from '../worker-env.js';

export const RESERVATION_FILTER_STATUSES = ['pending', 'confirmed', 'seated', 'visited', 'cancelled', 'no_show'];

/**
 * R103: 予約台帳の絞り込み条件を読む。期間は開始日時の範囲、状態は複数可、
 * 件数と開始位置でページを切る。既定は従来どおり先頭300件。
 */
export function parseReservationFilter(c: Context<Env>, orgId: string, scopedStoreId: string | null):
  | { ok: true; where: string; params: unknown[]; limit: number; offset: number }
  | { ok: false; error: string } {
  const params: unknown[] = [orgId, scopedStoreId, scopedStoreId];
  let where = 's.organization_id = ? AND (? IS NULL OR s.id = ?)';
  const from = c.req.query('reservationFrom') || (c.req.path.endsWith('/board')?c.req.query('from'):'') || '';
  if (from) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && !isExistingCalendarDate(from)) return { ok: false, error: '期間の指定が正しくありません' };
    const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(from) ? scheduledJstIso(from, '00:00')! : from);
    if (!Number.isFinite(parsed)) return { ok: false, error: '期間の指定が正しくありません' };
    where += ' AND julianday(r.starts_at) >= julianday(?)';
    params.push(new Date(parsed).toISOString());
  }
  const to = c.req.query('reservationTo') || (c.req.path.endsWith('/board')?c.req.query('to'):'') || '';
  if (to) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      if (!isExistingCalendarDate(to)) return { ok: false, error: '期間の指定が正しくありません' };
      // 日付だけの指定はその日の終わりまで含める（翌日0時未満）。
      const next = new Date(scheduledJstIso(to, '00:00')!);
      next.setUTCDate(next.getUTCDate() + 1);
      where += ' AND julianday(r.starts_at) < julianday(?)';
      params.push(next.toISOString());
    } else {
      const parsed = Date.parse(to);
      if (!Number.isFinite(parsed)) return { ok: false, error: '期間の指定が正しくありません' };
      where += c.req.path.endsWith('/board') ? ' AND julianday(r.starts_at) < julianday(?)' : ' AND julianday(r.starts_at) <= julianday(?)';
      params.push(new Date(parsed).toISOString());
    }
  }
  const statusParam = (c.req.query('reservationStatus') || '').trim();
  if (statusParam && statusParam !== 'all') {
    const list = statusParam.split(',').map((item) => item.trim()).filter(Boolean);
    if (list.length === 0 || list.some((item) => !RESERVATION_FILTER_STATUSES.includes(item))) {
      return { ok: false, error: '状態の指定が正しくありません' };
    }
    where += ` AND r.status IN (${list.map(() => '?').join(', ')})`;
    params.push(...list);
  }
  const limit = Number(c.req.query('reservationLimit') || '300');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return { ok: false, error: '件数の指定が正しくありません' };
  }
  const offset = Number(c.req.query('reservationOffset') || '0');
  if (!Number.isInteger(offset) || offset < 0) {
    return { ok: false, error: '開始位置の指定が正しくありません' };
  }
  return { ok: true, where, params, limit, offset };
}
