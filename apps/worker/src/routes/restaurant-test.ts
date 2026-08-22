import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { dbFor } from '../services/db-router.js';
import {
  chooseRestaurantTable,
  isRestaurantReservationSource,
  validateInboundReservation,
} from '../services/restaurant-test.js';

/**
 * 飲食店向け（テスト）の専用API。
 *
 * `/api/restaurant-test` 以外の既存機能には依存せず、外部サービスへの
 * fetch/send は意図的に実装しない。媒体連携は管理者が投入した受信データを
 * 検証する一方向だけである。
 */
export const restaurantTest = new Hono<Env>();

type OrganizationRow = { id: string; account_id: string; name: string; status: string };

function accountId(c: Context<Env>): string | null {
  return c.req.query('account_id') || null;
}

restaurantTest.use('/api/restaurant-test/*', async (c, next) => {
  const selectedAccount = accountId(c);
  if (!selectedAccount) return next();
  const scope = await getVisibleLineAccountScope(dbFor(c.env), c.get('staff'));
  if (!scope.ids.includes(selectedAccount)) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  return next();
});

async function organizationFor(c: Context<Env>): Promise<OrganizationRow | null> {
  const id = accountId(c);
  if (!id) return null;
  return dbFor(c.env).prepare(
    'SELECT id, account_id, name, status FROM rt_organizations WHERE account_id = ? LIMIT 1',
  ).bind(id).first<OrganizationRow>();
}

async function storeBelongsTo(c: Context<Env>, organizationId: string, storeId: string): Promise<boolean> {
  const row = await dbFor(c.env, storeId).prepare(
    'SELECT 1 AS ok FROM rt_stores WHERE id = ? AND organization_id = ? LIMIT 1',
  ).bind(storeId, organizationId).first<{ ok: number }>();
  return Boolean(row?.ok);
}

function requiredAccount(c: Context<Env>) {
  return c.json({ success: false, error: 'account_id が必要です' }, 400);
}

restaurantTest.get('/api/restaurant-test/snapshot', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) {
    return c.json({
      success: true,
      data: {
        environment: 'staging_test',
        integrationPolicy: 'inbound_only',
        organization: null,
        stores: [], memberships: [], approvals: [], reservations: [], tables: [],
        inventory: [], menuItems: [], connectors: [], reviews: [], posts: [], lineFlows: [],
      },
    });
  }

  const orgId = organization.id;
  const [stores, memberships, approvals, reservations, tables, inventory, menuItems, connectors, reviews, posts, lineFlows] = await Promise.all([
    dbFor(c.env).prepare('SELECT * FROM rt_stores WHERE organization_id = ? ORDER BY code').bind(orgId).all(),
    dbFor(c.env).prepare('SELECT * FROM rt_memberships WHERE organization_id = ? ORDER BY role, staff_name').bind(orgId).all(),
    dbFor(c.env).prepare('SELECT * FROM rt_approval_requests WHERE organization_id = ? ORDER BY CASE status WHEN \'pending\' THEN 0 WHEN \'returned\' THEN 1 ELSE 2 END, created_at DESC LIMIT 100').bind(orgId).all(),
    dbFor(c.env).prepare(`SELECT r.*, s.name AS store_name, t.label AS table_label, m.name AS course_name
      FROM rt_reservations r
      JOIN rt_stores s ON s.id = r.store_id
      LEFT JOIN rt_tables t ON t.id = r.table_id
      LEFT JOIN rt_menu_items m ON m.id = r.course_id
      WHERE s.organization_id = ? ORDER BY r.starts_at ASC LIMIT 300`).bind(orgId).all(),
    dbFor(c.env).prepare('SELECT t.* FROM rt_tables t JOIN rt_stores s ON s.id = t.store_id WHERE s.organization_id = ? ORDER BY t.store_id, t.code').bind(orgId).all(),
    dbFor(c.env).prepare('SELECT i.* FROM rt_inventory_slots i JOIN rt_stores s ON s.id = i.store_id WHERE s.organization_id = ? ORDER BY i.starts_at LIMIT 300').bind(orgId).all(),
    dbFor(c.env).prepare('SELECT m.* FROM rt_menu_items m JOIN rt_stores s ON s.id = m.store_id WHERE s.organization_id = ? ORDER BY m.kind, m.name').bind(orgId).all(),
    dbFor(c.env).prepare('SELECT x.* FROM rt_connector_status x JOIN rt_stores s ON s.id = x.store_id WHERE s.organization_id = ? ORDER BY x.store_id, x.provider').bind(orgId).all(),
    dbFor(c.env).prepare('SELECT g.* FROM rt_gbp_reviews g JOIN rt_stores s ON s.id = g.store_id WHERE s.organization_id = ? ORDER BY g.reviewed_at DESC LIMIT 100').bind(orgId).all(),
    dbFor(c.env).prepare('SELECT p.* FROM rt_gbp_posts p JOIN rt_stores s ON s.id = p.store_id WHERE s.organization_id = ? ORDER BY p.created_at DESC LIMIT 100').bind(orgId).all(),
    dbFor(c.env).prepare('SELECT * FROM rt_line_flows WHERE organization_id = ? ORDER BY flow_type').bind(orgId).all(),
  ]);

  return c.json({
    success: true,
    data: {
      environment: 'staging_test',
      integrationPolicy: 'inbound_only',
      organization,
      stores: stores.results,
      memberships: memberships.results,
      approvals: approvals.results,
      reservations: reservations.results,
      tables: tables.results,
      inventory: inventory.results,
      menuItems: menuItems.results,
      connectors: connectors.results,
      reviews: reviews.results,
      posts: posts.results,
      lineFlows: lineFlows.results,
    },
  });
});

/** 空の検証領域に、Pen R-1〜R-8を確認できる安全なサンプルを作る。 */
restaurantTest.post('/api/restaurant-test/bootstrap', requireRole('owner', 'admin'), async (c) => {
  const selectedAccount = accountId(c);
  if (!selectedAccount) return requiredAccount(c);
  const existing = await organizationFor(c);
  if (existing) return c.json({ success: true, data: { organizationId: existing.id, created: false } });

  const body: { organizationName?: string } = await c.req.json<{ organizationName?: string }>().catch(() => ({}));
  const orgId = crypto.randomUUID();
  const mainId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  const tableIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const menuIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const now = new Date();
  const at = (days: number, hour: number, minute = 0) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hour - 9, minute, 0, 0);
    return d.toISOString();
  };
  const statements: D1PreparedStatement[] = [
    dbFor(c.env).prepare('INSERT INTO rt_organizations (id, account_id, name) VALUES (?, ?, ?)').bind(orgId, selectedAccount, body.organizationName?.trim() || '然-NEN RESTAURANT LAB'),
    dbFor(c.env, mainId).prepare('INSERT INTO rt_stores (id, organization_id, name, code, area, capacity, line_status, google_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(mainId, orgId, '銀座店', 'GINZA', '東京', 32, 'connected', 'connected'),
    dbFor(c.env, secondId).prepare('INSERT INTO rt_stores (id, organization_id, name, code, area, capacity, line_status, google_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(secondId, orgId, '横浜店', 'YOKOHAMA', '神奈川', 24, 'warning', 'unconfigured'),
    dbFor(c.env).prepare('INSERT INTO rt_memberships (id, organization_id, staff_name, email, role, status) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), orgId, '本部 管理者', 'admin@example.test', 'super_admin', 'active'),
    dbFor(c.env, mainId).prepare('INSERT INTO rt_memberships (id, organization_id, store_id, staff_name, email, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), orgId, mainId, '銀座 店長', 'ginza@example.test', 'store_manager', 'active'),
    dbFor(c.env, mainId).prepare('INSERT INTO rt_memberships (id, organization_id, store_id, staff_name, role, status) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), orgId, mainId, 'ホール スタッフ', 'staff', 'active'),
  ];
  const tableSeed: Array<[string, string, string, number, number, number, number, string | null]> = [
    [tableIds[0], 'T-01', '窓側テーブル 1', 2, 4, 0, 0, 'PAIR-A'],
    [tableIds[1], 'T-02', '窓側テーブル 2', 2, 4, 1, 0, 'PAIR-A'],
    [tableIds[2], 'P-01', '個室', 4, 8, 0, 1, null],
    [tableIds[3], 'C-01', 'カウンター', 1, 2, 2, 0, null],
  ];
  for (const [id, code, label, min, max, x, y, join] of tableSeed) {
    statements.push(dbFor(c.env, mainId).prepare('INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity, floor_x, floor_y, join_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, mainId, code, label, code.startsWith('P') ? 'private_room' : code.startsWith('C') ? 'counter' : 'table', min, max, x, y, join));
  }
  statements.push(
    dbFor(c.env, mainId).prepare('INSERT INTO rt_menu_items (id, store_id, kind, name, price, allergens_json, service_periods_json, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(menuIds[0], mainId, 'course', '季節のおまかせコース', 8800, '["卵","小麦"]', '["dinner"]', 120),
    dbFor(c.env, mainId).prepare('INSERT INTO rt_menu_items (id, store_id, kind, name, price, allergens_json, service_periods_json, duration_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(menuIds[1], mainId, 'course', 'ランチ会席', 4800, '["小麦"]', '["lunch"]', 90),
    dbFor(c.env, mainId).prepare('INSERT INTO rt_menu_items (id, store_id, kind, name, price, allergens_json, service_periods_json) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(menuIds[2], mainId, 'a_la_carte', '旬魚の炭火焼', 2600, '["魚"]', '["dinner"]'),
  );
  for (const [hour, reserved] of [[17, 4], [17.5, 8], [18, 12], [18.5, 18], [19, 22], [19.5, 16], [20, 10]] as const) {
    const h = Math.floor(hour);
    const minute = hour % 1 ? 30 : 0;
    statements.push(dbFor(c.env, mainId).prepare('INSERT INTO rt_inventory_slots (id, store_id, starts_at, total_capacity, ota_capacity, line_capacity, walk_in_capacity, reserved_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), mainId, at(1, h, minute), 32, 18, 10, 4, reserved));
  }
  const reservations: Array<[string, string, number, string, string, string]> = [
    ['RB-1001', '佐藤 様', 2, at(1, 18), at(1, 20), 'restaurant_board'],
    ['LINE-1002', '鈴木 様', 4, at(1, 18, 30), at(1, 20, 30), 'line'],
    ['HP-1003', '田中 様', 2, at(1, 19), at(1, 21), 'hotpepper'],
    ['TEL-1004', '山本 様', 6, at(1, 19, 30), at(1, 21, 30), 'phone'],
  ];
  for (const [external, customer, guests, start, end, source] of reservations) {
    const table = guests >= 5 ? tableIds[2] : guests === 4 ? tableIds[1] : tableIds[0];
    statements.push(dbFor(c.env, mainId).prepare('INSERT INTO rt_reservations (id, store_id, source, external_id, hub_source, customer_name, customer_phone, guest_count, starts_at, ends_at, table_id, course_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), mainId, source, external, source === 'restaurant_board' ? 'restaurant_board' : null, customer, '090-0000-0000', guests, start, end, table, menuIds[0], 'confirmed'));
  }
  for (const provider of ['restaurant_board', 'reszaiko', 'hotpepper', 'tabelog', 'gurunavi', 'ikyu', 'retty', 'google_business_profile', 'line']) {
    const enabled = provider === 'restaurant_board' || provider === 'line' || provider === 'google_business_profile';
    statements.push(dbFor(c.env, mainId).prepare('INSERT INTO rt_connector_status (id, store_id, provider, mode, status, last_synced_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), mainId, provider, enabled && provider !== 'google_business_profile' && provider !== 'line' ? 'inbound_only' : 'disabled', enabled ? 'connected' : 'unconfigured', enabled ? now.toISOString() : null));
  }
  statements.push(
    dbFor(c.env, mainId).prepare('INSERT INTO rt_approval_requests (id, organization_id, store_id, kind, title, status, requested_by, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), orgId, mainId, 'gbp_post', '秋の限定コースのご案内', 'pending', 'ホール スタッフ', '{"postType":"standard"}'),
    dbFor(c.env, mainId).prepare('INSERT INTO rt_approval_requests (id, organization_id, store_id, kind, title, status, requested_by, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), orgId, mainId, 'menu_change', 'ランチ会席 価格改定', 'pending', '銀座 店長', '{"price":5200}'),
    dbFor(c.env, mainId).prepare('INSERT INTO rt_gbp_reviews (id, store_id, external_review_id, author_name, rating, comment, reviewed_at, sentiment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), mainId, 'GBP-DEMO-1', 'ご来店者様', 5, '季節のお料理と落ち着いた接客が素晴らしかったです。', at(-1, 12), 'positive'),
  );
  const flowSeed: Array<[string, string, number | null]> = [
    ['reservation_24h', '明日のご予約について', -1440],
    ['reservation_2h', '本日のご来店について', -120],
    ['post_visit', '本日はありがとうございました', 120],
    ['review_request', 'ご感想をお聞かせください', 180],
    ['member_card', 'デジタル会員証', null],
    ['one_tap_booking', '前回と同じ内容で予約', null],
  ];
  for (const [type, title, timing] of flowSeed) {
    statements.push(dbFor(c.env, mainId).prepare('INSERT INTO rt_line_flows (id, organization_id, store_id, flow_type, title, body, timing_minutes, is_enabled, delivery_mode) VALUES (?, ?, ?, ?, ?, ?, ?, 0, \'preview_only\')').bind(crypto.randomUUID(), orgId, mainId, type, title, `${title}のカードメッセージを準備しています。`, timing));
  }
  await dbFor(c.env, mainId).batch(statements);
  return c.json({ success: true, data: { organizationId: orgId, created: true } }, 201);
});

restaurantTest.patch('/api/restaurant-test/approvals/:id', requireRole('owner', 'admin'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ action?: string; comment?: string }>();
  const status = body.action === 'approve' ? 'approved' : body.action === 'return' ? 'returned' : null;
  if (!status) return c.json({ success: false, error: 'action は approve または return です' }, 400);
  const staff = c.get('staff');
  const result = await dbFor(c.env).prepare(`UPDATE rt_approval_requests
    SET status = ?, review_comment = ?, reviewed_by = ?, updated_at = datetime('now')
    WHERE id = ? AND organization_id = ? AND status IN ('pending', 'returned')`).bind(
      status, body.comment?.trim() || null, staff?.name || staff?.id || '管理者', c.req.param('id'), organization.id,
    ).run();
  if (!result.meta.changes) return c.json({ success: false, error: '対象が無いか、すでに処理済みです' }, 409);
  return c.json({ success: true, data: { id: c.req.param('id'), status } });
});

async function acquireLock(db: D1Database, key: string, owner: string): Promise<boolean> {
  const expires = new Date(Date.now() + 10_000).toISOString();
  await db.prepare(`INSERT INTO rt_resource_locks (resource_key, owner_token, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(resource_key) DO UPDATE SET owner_token = excluded.owner_token, expires_at = excluded.expires_at, created_at = datetime('now')
    WHERE datetime(rt_resource_locks.expires_at) <= datetime('now')`).bind(key, owner, expires).run();
  const held = await db.prepare('SELECT owner_token FROM rt_resource_locks WHERE resource_key = ?').bind(key).first<{ owner_token: string }>();
  return held?.owner_token === owner;
}

async function releaseLock(db: D1Database, key: string, owner: string): Promise<void> {
  await db.prepare('DELETE FROM rt_resource_locks WHERE resource_key = ? AND owner_token = ?').bind(key, owner).run();
}

restaurantTest.post('/api/restaurant-test/reservations/manual', requireRole('owner', 'admin', 'staff'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<Record<string, unknown>>();
  const storeId = typeof body.storeId === 'string' ? body.storeId : '';
  if (!storeId || !await storeBelongsTo(c, organization.id, storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const checked = validateInboundReservation({ ...body, externalId: `manual-${crypto.randomUUID()}` });
  if (!checked.ok) return c.json({ success: false, error: checked.error }, 400);
  const lockKey = `reservation:${storeId}:${checked.value.startsAt}`;
  const lockOwner = crypto.randomUUID();
  if (!await acquireLock(dbFor(c.env, storeId), lockKey, lockOwner)) return c.json({ success: false, error: '同じ時間帯を別の担当者が更新中です' }, 409);
  try {
    const tables = await dbFor(c.env, storeId).prepare('SELECT id, min_capacity, max_capacity, is_active FROM rt_tables WHERE store_id = ?').bind(storeId).all<{ id: string; min_capacity: number; max_capacity: number; is_active: number }>();
    const tableId = checked.value.tableId || chooseRestaurantTable(tables.results.map((row) => ({ id: row.id, minCapacity: row.min_capacity, maxCapacity: row.max_capacity, isActive: row.is_active === 1 })), checked.value.guestCount);
    const id = crypto.randomUUID();
    await dbFor(c.env, storeId).prepare(`INSERT INTO rt_reservations
      (id, store_id, source, external_id, customer_name, customer_phone, line_uid, guest_count, starts_at, ends_at, table_id, course_id, status, allergy_note, note)
      VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, storeId, checked.value.externalId, checked.value.customerName, checked.value.customerPhone,
        checked.value.lineUid, checked.value.guestCount, checked.value.startsAt, checked.value.endsAt,
        tableId, checked.value.courseId, checked.value.status, checked.value.allergyNote, checked.value.note,
      ).run();
    return c.json({ success: true, data: { id, tableId, syncDirection: 'inbound_only' } }, 201);
  } finally {
    await releaseLock(dbFor(c.env, storeId), lockKey, lockOwner);
  }
});

/**
 * 予約媒体の受信検証口。管理画面セッションでのみ投入でき、外部媒体へ返す処理は無い。
 * 本接続時は媒体ごとの署名アダプターをこの前段に置く。
 */
restaurantTest.post('/api/restaurant-test/inbound/reservations', requireRole('owner', 'admin'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string; provider?: unknown; eventId?: string; reservation?: unknown }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  if (!isRestaurantReservationSource(body.provider) || ['manual', 'phone', 'line'].includes(body.provider)) return c.json({ success: false, error: '受信媒体が正しくありません' }, 400);
  if (!body.eventId?.trim()) return c.json({ success: false, error: 'eventId が必要です' }, 400);
  const checked = validateInboundReservation(body.reservation);
  if (!checked.ok) return c.json({ success: false, error: checked.error }, 400);
  const eventDbId = crypto.randomUUID();
  const inserted = await dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_sync_events
    (id, store_id, provider, external_event_id, payload_json, status)
    VALUES (?, ?, ?, ?, ?, 'received') ON CONFLICT(store_id, provider, external_event_id) DO NOTHING`).bind(
      eventDbId, body.storeId, body.provider, body.eventId.trim(), JSON.stringify(body.reservation),
    ).run();
  if (!inserted.meta.changes) return c.json({ success: true, data: { duplicate: true, direction: 'inbound' } });
  try {
    const value = checked.value;
    const id = crypto.randomUUID();
    await dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_reservations
      (id, store_id, source, external_id, hub_source, customer_name, customer_phone, line_uid, guest_count, starts_at, ends_at, table_id, course_id, status, allergy_note, note, source_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(store_id, source, external_id) DO UPDATE SET
        customer_name = excluded.customer_name, customer_phone = excluded.customer_phone,
        line_uid = excluded.line_uid, guest_count = excluded.guest_count, starts_at = excluded.starts_at,
        ends_at = excluded.ends_at, table_id = excluded.table_id, course_id = excluded.course_id,
        status = excluded.status, allergy_note = excluded.allergy_note, note = excluded.note,
        source_updated_at = excluded.source_updated_at, updated_at = datetime('now')`).bind(
          id, body.storeId, body.provider, value.externalId,
          body.provider === 'restaurant_board' || body.provider === 'reszaiko' ? body.provider : null,
          value.customerName, value.customerPhone, value.lineUid, value.guestCount, value.startsAt, value.endsAt,
          value.tableId, value.courseId, value.status, value.allergyNote, value.note, value.sourceUpdatedAt,
        ).run();
    await dbFor(c.env, body.storeId).prepare("UPDATE rt_sync_events SET status = 'processed', processed_at = datetime('now') WHERE id = ?").bind(eventDbId).run();
    return c.json({ success: true, data: { duplicate: false, direction: 'inbound', outboundWrites: 0 } }, 201);
  } catch (error) {
    await dbFor(c.env, body.storeId).prepare("UPDATE rt_sync_events SET status = 'failed', error_message = ? WHERE id = ?").bind(error instanceof Error ? error.message.slice(0, 500) : 'unknown', eventDbId).run();
    throw error;
  }
});

restaurantTest.post('/api/restaurant-test/tables', requireRole('owner', 'admin'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string; code?: string; label?: string; seatType?: string; minCapacity?: number; maxCapacity?: number }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const seatTypes = ['counter', 'table', 'private_room', 'terrace'];
  const min = Number(body.minCapacity);
  const max = Number(body.maxCapacity);
  if (!body.code?.trim() || !body.label?.trim() || !seatTypes.includes(body.seatType || '') || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) return c.json({ success: false, error: '卓の入力内容が正しくありません' }, 400);
  const id = crypto.randomUUID();
  await dbFor(c.env, body.storeId).prepare('INSERT INTO rt_tables (id, store_id, code, label, seat_type, min_capacity, max_capacity) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, body.storeId, body.code.trim(), body.label.trim(), body.seatType, min, max).run();
  return c.json({ success: true, data: { id } }, 201);
});

restaurantTest.post('/api/restaurant-test/memberships', requireRole('owner', 'admin'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string | null; staffName?: string; email?: string; role?: string; lineUid?: string; googleEmail?: string }>();
  if (body.storeId && !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  if (!body.staffName?.trim() || !['super_admin', 'store_manager', 'staff'].includes(body.role || '')) return c.json({ success: false, error: '氏名と役割が必要です' }, 400);
  if (body.role === 'super_admin' && c.get('staff')?.role !== 'owner') return c.json({ success: false, error: 'SuperAdminを追加できるのはオーナーだけです' }, 403);
  const id = crypto.randomUUID();
  await dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_memberships
    (id, organization_id, store_id, staff_name, email, role, line_uid, google_email, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`).bind(
      id, organization.id, body.storeId || null, body.staffName.trim(), body.email?.trim() || null,
      body.role, body.lineUid?.trim() || null, body.googleEmail?.trim() || null,
    ).run();
  return c.json({ success: true, data: { id } }, 201);
});

restaurantTest.put('/api/restaurant-test/inventory/:id', requireRole('owner', 'admin'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ totalCapacity?: number; otaCapacity?: number; lineCapacity?: number; walkInCapacity?: number }>();
  const values = [body.totalCapacity, body.otaCapacity, body.lineCapacity, body.walkInCapacity].map(Number);
  if (values.some((value) => !Number.isInteger(value) || value < 0) || values.slice(1).reduce((a, b) => a + b, 0) > values[0]) {
    return c.json({ success: false, error: '媒体別枠の合計は総受入枠以下にしてください' }, 400);
  }
  const result = await dbFor(c.env).prepare(`UPDATE rt_inventory_slots SET
    total_capacity = ?, ota_capacity = ?, line_capacity = ?, walk_in_capacity = ?, updated_at = datetime('now')
    WHERE id = ? AND store_id IN (SELECT id FROM rt_stores WHERE organization_id = ?)`).bind(
      ...values, c.req.param('id'), organization.id,
    ).run();
  if (!result.meta.changes) return c.json({ success: false, error: '対象がありません' }, 404);
  return c.json({ success: true, data: { id: c.req.param('id') } });
});

restaurantTest.post('/api/restaurant-test/menu', requireRole('owner', 'admin'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string; kind?: string; name?: string; price?: number; allergens?: string[]; servicePeriods?: string[] }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  const price = Number(body.price);
  if (!['course', 'a_la_carte'].includes(body.kind || '') || !body.name?.trim() || !Number.isInteger(price) || price < 0) return c.json({ success: false, error: 'メニューの入力内容が正しくありません' }, 400);
  const id = crypto.randomUUID();
  await dbFor(c.env, body.storeId).prepare('INSERT INTO rt_menu_items (id, store_id, kind, name, price, allergens_json, service_periods_json) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, body.storeId, body.kind, body.name.trim(), price, JSON.stringify(body.allergens || []), JSON.stringify(body.servicePeriods || ['dinner'])).run();
  return c.json({ success: true, data: { id } }, 201);
});

restaurantTest.post('/api/restaurant-test/gbp/posts', requireRole('owner', 'admin'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ storeId?: string; postType?: string; title?: string; body?: string; ctaType?: string; ctaUrl?: string }>();
  if (!body.storeId || !await storeBelongsTo(c, organization.id, body.storeId)) return c.json({ success: false, error: '店舗が正しくありません' }, 400);
  if (!['standard', 'event', 'offer'].includes(body.postType || '') || !body.title?.trim() || !body.body?.trim()) return c.json({ success: false, error: '投稿種別・タイトル・本文が必要です' }, 400);
  const postId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const staff = c.get('staff');
  await dbFor(c.env, body.storeId).batch([
    dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_gbp_posts
      (id, store_id, post_type, title, body, cta_type, cta_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`).bind(postId, body.storeId, body.postType, body.title.trim(), body.body.trim(), body.ctaType || null, body.ctaUrl?.trim() || null),
    dbFor(c.env, body.storeId).prepare(`INSERT INTO rt_approval_requests
      (id, organization_id, store_id, kind, title, status, payload_json, requested_by)
      VALUES (?, ?, ?, 'gbp_post', ?, 'pending', ?, ?)`).bind(approvalId, organization.id, body.storeId, body.title.trim(), JSON.stringify({ postId }), staff?.name || staff?.id || '管理者'),
  ]);
  return c.json({ success: true, data: { postId, approvalId, published: false } }, 201);
});

restaurantTest.put('/api/restaurant-test/gbp/reviews/:id/draft', requireRole('owner', 'admin'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ replyDraft?: string }>();
  if (!body.replyDraft?.trim()) return c.json({ success: false, error: '返信案が必要です' }, 400);
  const result = await dbFor(c.env).prepare(`UPDATE rt_gbp_reviews SET reply_draft = ?, reply_status = 'draft', updated_at = datetime('now')
    WHERE id = ? AND store_id IN (SELECT id FROM rt_stores WHERE organization_id = ?)`).bind(body.replyDraft.trim(), c.req.param('id'), organization.id).run();
  if (!result.meta.changes) return c.json({ success: false, error: '対象がありません' }, 404);
  return c.json({ success: true, data: { id: c.req.param('id'), sent: false } });
});

restaurantTest.put('/api/restaurant-test/line-flows/:id', requireRole('owner', 'admin'), async (c) => {
  if (!accountId(c)) return requiredAccount(c);
  const organization = await organizationFor(c);
  if (!organization) return c.json({ success: false, error: '飲食店テスト組織がありません' }, 404);
  const body = await c.req.json<{ title?: string; body?: string; timingMinutes?: number | null; isEnabled?: boolean }>();
  if (!body.title?.trim() || !body.body?.trim()) return c.json({ success: false, error: 'タイトルと本文が必要です' }, 400);
  const result = await dbFor(c.env).prepare(`UPDATE rt_line_flows SET title = ?, body = ?, timing_minutes = ?, is_enabled = ?,
    delivery_mode = 'preview_only', updated_at = datetime('now') WHERE id = ? AND organization_id = ?`).bind(
      body.title.trim(), body.body.trim(), body.timingMinutes ?? null, body.isEnabled ? 1 : 0, c.req.param('id'), organization.id,
    ).run();
  if (!result.meta.changes) return c.json({ success: false, error: '対象がありません' }, 404);
  return c.json({ success: true, data: { id: c.req.param('id'), deliveryMode: 'preview_only' } });
});
