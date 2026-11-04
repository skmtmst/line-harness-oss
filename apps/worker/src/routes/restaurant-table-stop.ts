import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { dbFor } from '../services/db-router.js';
import { assertChanged, clearAssertions } from '../features/booking/booking-series/index.js';
import { hasOrganizationSelector, organizationFor, requiredAccount, storeBelongsTo } from './restaurant-test-definition.js';

type Move = { id: string; expectedRevision: number; targetTableId: string | null };

export async function stopRestaurantTable(c: Context<Env>) {
  if (!hasOrganizationSelector(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId: string; expectedTableRevision: number; asOf?: string; reservations: Move[] }>().catch(() => null);
  if (!body || typeof body.storeId !== 'string' || !Number.isSafeInteger(body.expectedTableRevision) || body.expectedTableRevision < 1
    || !Array.isArray(body.reservations) || body.reservations.length > 200
    || body.reservations.some(r => !r || typeof r.id !== 'string' || !r.id || !Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 1 || (r.targetTableId !== null && typeof r.targetTableId !== 'string'))
    || new Set(body.reservations.map(r => r.id)).size !== body.reservations.length) {
    return c.json({ success: false, error: '確認した卓と予約が正しくありません' }, 400);
  }
  const asOf = body.asOf ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(asOf)) || Date.parse(asOf) > Date.now() + 60_000) return c.json({ success: false, error: '確認した日時が正しくありません' }, 400);
  if ((organization.scopedStoreId && organization.scopedStoreId !== body.storeId) || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が見つかりません' }, 404);
  const db = dbFor(c.env, body.storeId), tableId = c.req.param('id')!;
  const table = await db.prepare('SELECT id FROM rt_tables WHERE id=? AND store_id=?').bind(tableId, body.storeId).first();
  if (!table) return c.json({ success: false, error: '卓が見つかりません' }, 404);
  const expected = JSON.stringify(body.reservations);
  const moves = body.reservations.map(r => db.prepare(`UPDATE rt_reservations SET table_id=?,customer_version=customer_version+1,confirmation_revision=confirmation_revision+1,updated_at=datetime('now')
    WHERE id=? AND store_id=? AND confirmation_revision=? AND (? IS NULL OR (? IS NOT table_id AND EXISTS(SELECT 1 FROM rt_tables t WHERE t.id=? AND t.store_id=rt_reservations.store_id AND t.id<>? AND t.is_active=1 AND t.min_capacity<=rt_reservations.guest_count AND t.max_capacity>=rt_reservations.guest_count)))`)
    .bind(r.targetTableId, r.id, body.storeId, r.expectedRevision, r.targetTableId, r.targetTableId, r.targetTableId, tableId));
  const steps: D1PreparedStatement[] = [db.prepare(`UPDATE rt_tables SET is_active=0,confirmation_revision=confirmation_revision+1,updated_at=datetime('now')
    WHERE id=? AND store_id=? AND is_active=1 AND confirmation_revision=?
    AND (SELECT COUNT(*) FROM rt_reservations r WHERE r.store_id=? AND r.status NOT IN ('cancelled','no_show','completed','visited','seated') AND r.departed_at IS NULL AND julianday(r.ends_at)>julianday(?) AND (r.table_id=? OR EXISTS(SELECT 1 FROM rt_reservation_table_links l WHERE l.reservation_id=r.id AND l.table_id=?)))=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM rt_reservations r WHERE r.id=json_extract(e.value,'$.id') AND r.store_id=? AND r.confirmation_revision=json_extract(e.value,'$.expectedRevision') AND r.status NOT IN ('cancelled','no_show','completed','visited','seated') AND r.departed_at IS NULL AND julianday(r.ends_at)>julianday(?) AND (r.table_id=? OR EXISTS(SELECT 1 FROM rt_reservation_table_links l WHERE l.reservation_id=r.id AND l.table_id=?))))`)
    .bind(tableId,body.storeId,body.expectedTableRevision,body.storeId,asOf,tableId,tableId,body.reservations.length,expected,body.storeId,asOf,tableId,tableId), assertChanged(db)];
  for (const move of moves) steps.push(move, assertChanged(db));
  steps.push(clearAssertions(db));
  try { await db.batch(steps); }
  catch (error) {
    if (!/CHECK constraint|restaurant_table_conflict/i.test(String(error))) throw error;
    const currentTable = await db.prepare('SELECT id,is_active,confirmation_revision FROM rt_tables WHERE id=? AND store_id=?').bind(tableId,body.storeId).first();
    const currentReservations = await db.prepare(`SELECT r.id,r.status,r.table_id,r.confirmation_revision FROM rt_reservations r WHERE r.store_id=? AND r.status NOT IN ('cancelled','no_show','completed','visited','seated') AND r.departed_at IS NULL AND julianday(r.ends_at)>julianday(?) AND (r.table_id=? OR EXISTS(SELECT 1 FROM rt_reservation_table_links l WHERE l.reservation_id=r.id AND l.table_id=?)) LIMIT 201`).bind(body.storeId,asOf,tableId,tableId).all();
    return c.json({ success: false, code: 'version_conflict', error: '卓または予約が変わりました。読み直してください', current: { table: currentTable, reservations: currentReservations.results } }, 409);
  }
  return c.json({ success: true, data: { id: tableId } });
}
