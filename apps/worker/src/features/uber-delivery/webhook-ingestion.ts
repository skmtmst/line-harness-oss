import type { WebhookOrder } from '../../services/delivery-webhook-payload.js';
import { judgeUrgency, type DeliveryOrderStatus } from '../../services/restaurant-delivery.js';
import type { UberNotification } from './order-payload.js';

export interface UberWebhookStore {
  id: string;
  accountId: string;
  uberStoreId: string;
  connectionVersion: number;
}

export interface UberWebhookLease {
  eventKey: string;
  orderKey: string;
  owner: string;
}

export interface UberWebhookEvent {
  id: string;
  account_id: string;
  external_order_id: string;
  event_type: string;
  payload_json: string;
  status: string;
  error_code: string | null;
  attempts: number;
  version: number;
}

/** 外部取得中にも変わり得る所属・有効設定・接続を、保存するSQLでも再検査する。 */
export const UBER_STORE_ELIGIBILITY = `u.status = 'connected' AND u.provisioned_at IS NOT NULL
  AND COALESCE(u.last_error, '') NOT IN ('pos_activation_started', 'pos_activation_unknown')
  AND s.status = 'active' AND s.line_account_id = u.account_id
  AND o.status <> 'archived'
  AND a.is_active = 1 AND a.archived_at IS NULL AND a.tenant_id = o.tenant_id AND t.status = 'active'
  AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(t.feature_packs) THEN t.feature_packs ELSE '[]' END)
    WHERE value = 'restaurant')
  AND NOT EXISTS (SELECT 1 FROM rt_store_feature_flags f
    WHERE f.store_id = u.store_id AND f.feature = 'delivery' AND f.enabled = 0)`;

export const UBER_STORE_JOINS = `FROM rt_delivery_uber_connections u
  JOIN rt_stores s ON s.id = u.store_id
  JOIN rt_organizations o ON o.id = s.organization_id
  JOIN line_accounts a ON a.id = u.account_id
  JOIN tenants t ON t.id = o.tenant_id`;

function fence(store: UberWebhookStore, lease: UberWebhookLease, now: number) {
  return {
    sql: `(SELECT COUNT(*) FROM rt_resource_locks
      WHERE resource_key IN (?, ?) AND owner_token = ? AND julianday(expires_at) > julianday(?)) = 2
      AND EXISTS (SELECT 1 ${UBER_STORE_JOINS}
        WHERE u.store_id = ? AND u.account_id = ? AND u.uber_store_id = ? AND u.version = ?
          AND ${UBER_STORE_ELIGIBILITY})
      AND (SELECT COUNT(*) FROM rt_delivery_uber_connections
        WHERE uber_store_id = ? AND status = 'connected' AND provisioned_at IS NOT NULL) = 1`,
    binds: [lease.eventKey, lease.orderKey, lease.owner, new Date(now * 1000).toISOString(),
      store.id, store.accountId, store.uberStoreId, store.connectionVersion, store.uberStoreId],
  };
}

export async function acquireWebhookLock(db: D1Database, key: string, owner: string, now: number): Promise<boolean> {
  const result = await db.prepare(`INSERT INTO rt_resource_locks (resource_key, owner_token, expires_at, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(resource_key) DO UPDATE SET owner_token = excluded.owner_token,
      expires_at = excluded.expires_at, created_at = excluded.created_at
    WHERE julianday(rt_resource_locks.expires_at) <= julianday(?)`)
    .bind(key, owner, new Date((now + 60) * 1000).toISOString(), new Date(now * 1000).toISOString(),
      new Date(now * 1000).toISOString()).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function releaseWebhookLock(db: D1Database, key: string, owner: string): Promise<void> {
  await db.prepare('DELETE FROM rt_resource_locks WHERE resource_key = ? AND owner_token = ?').bind(key, owner).run();
}

export async function webhookEvent(db: D1Database, eventId: string): Promise<UberWebhookEvent | null> {
  return db.prepare(`SELECT id, account_id, external_order_id, event_type, payload_json, status, error_code, attempts, version
    FROM rt_delivery_events WHERE service = 'ubereats' AND external_event_id = ?`)
    .bind(eventId).first<UberWebhookEvent>();
}

export async function openWebhookEvent(input: {
  db: D1Database; store: UberWebhookStore; notification: UberNotification; rawBody: string;
  lease: UberWebhookLease; now: number;
}): Promise<void> {
  const guard = fence(input.store, input.lease, input.now);
  await input.db.prepare(`INSERT OR IGNORE INTO rt_delivery_events
    (id, account_id, service, external_event_id, event_type, external_order_id, status, payload_json, attempts, received_at, version)
    SELECT ?, ?, 'ubereats', ?, ?, ?, 'received', ?, 0, ?, 1 WHERE ${guard.sql}`)
    .bind(crypto.randomUUID(), input.store.accountId, input.notification.eventId, input.notification.eventType,
      input.notification.orderId, input.rawBody, input.now, ...guard.binds).run();
}

export async function claimWebhookAttempt(input: {
  db: D1Database; store: UberWebhookStore; lease: UberWebhookLease; event: UberWebhookEvent; now: number;
}): Promise<boolean> {
  const guard = fence(input.store, input.lease, input.now);
  const result = await input.db.prepare(`UPDATE rt_delivery_events
    SET status = 'received', attempts = attempts + 1, error_code = NULL, processed_at = NULL, version = version + 1
    WHERE id = ? AND version = ? AND status IN ('received', 'failed', 'retryable_failed') AND attempts < 4 AND ${guard.sql}`)
    .bind(input.event.id, input.event.version, ...guard.binds).run();
  if (Number(result.meta.changes ?? 0) !== 1) return false;
  input.event.version += 1;
  input.event.attempts += 1;
  input.event.status = 'received';
  return true;
}

export async function finishWebhookEvent(input: {
  db: D1Database; store: UberWebhookStore; lease: UberWebhookLease; event: UberWebhookEvent;
  status: 'processed' | 'ignored' | 'failed' | 'retryable_failed'; code?: string; now: number;
}): Promise<boolean> {
  const guard = fence(input.store, input.lease, input.now);
  const result = await input.db.prepare(`UPDATE rt_delivery_events
    SET status = ?, error_code = ?, processed_at = ?, version = version + 1
    WHERE id = ? AND version = ? AND ${guard.sql}`)
    .bind(input.status, input.code ?? null, input.now, input.event.id, input.event.version, ...guard.binds).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function hasUberCancellation(db: D1Database, store: UberWebhookStore, orderId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS found FROM rt_delivery_events
    WHERE service = 'ubereats' AND external_order_id = ? AND account_id = ?
      AND event_type IN ('orders.cancel', 'orders.failure')
      AND json_extract(payload_json, '$.meta.user_id') = ? LIMIT 1`)
    .bind(orderId, store.accountId, store.uberStoreId).first();
  return row !== null;
}

export async function existingUberOrder(db: D1Database, orderId: string): Promise<{
  id: string; store_id: string; account_id: string; status: string;
} | null> {
  return db.prepare(`SELECT id, store_id, account_id, status FROM rt_delivery_orders
    WHERE service = 'ubereats' AND external_order_id = ?`)
    .bind(orderId).first();
}

/** 注文・品目・受信完了は一つのtransaction。途中のINSERT失敗で注文だけ残さない。 */
export async function ingestUberOrder(input: {
  db: D1Database; store: UberWebhookStore; lease: UberWebhookLease; event: UberWebhookEvent;
  order: WebhookOrder; status: DeliveryOrderStatus; now: number;
}): Promise<boolean> {
  const { db, store, event, order, now } = input;
  const guard = fence(store, input.lease, now);
  const eventGuard = `EXISTS (SELECT 1 FROM rt_delivery_events WHERE id = ? AND version = ?)
    AND ${guard.sql}`;
  const eventBinds = [event.id, event.version, ...guard.binds];
  const id = crypto.randomUUID();
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM rt_delivery_orders
    WHERE store_id = ? AND status IN ('new', 'cooking')`).bind(store.id).first<{ count: number }>();
  const canceled = input.status === 'canceled';
  const urgency = judgeUrgency({ status: input.status, receivedAt: order.receivedAt,
    wantedAt: order.wantedAt, itemCount, cookingCount: count?.count ?? 0, now });
  const statements: D1PreparedStatement[] = [db.prepare(`INSERT INTO rt_delivery_orders
    (id, account_id, store_id, service, external_order_id, order_number, status, total_amount, currency,
      item_count, pickup_method, wanted_at, customer_note, urgency, urgency_reason, urgency_computed_at,
      received_at, canceled_at, canceled_by, cancel_reason_code, version, created_at, updated_at)
    SELECT ?, ?, ?, 'ubereats', ?, ?, ?, ?, 'JPY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE ${eventGuard}
    ON CONFLICT(service, external_order_id) DO NOTHING`)
    .bind(id, store.accountId, store.id, order.externalOrderId, order.orderNumber, input.status,
      order.totalAmount, itemCount, order.pickupMethod, order.wantedAt, order.customerNote,
      urgency.urgency, urgency.reason, now, order.receivedAt, canceled ? now : null,
      canceled ? 'service' : null, canceled ? 'service_canceled' : null, now, now, ...eventBinds)];
  for (const [position, item] of order.items.entries()) {
    statements.push(db.prepare(`INSERT INTO rt_delivery_order_items
      (id, order_id, position, name, note, quantity, amount, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rt_delivery_orders
        WHERE id = ? AND store_id = ? AND account_id = ?) AND ${eventGuard}`)
      .bind(crypto.randomUUID(), id, position, item.name, item.note, item.quantity, item.amount, now,
        id, store.id, store.accountId, ...eventBinds));
  }
  if (canceled) statements.push(cancelStatement(db, store, order.externalOrderId, eventGuard, eventBinds, now));
  statements.push(db.prepare(`UPDATE rt_delivery_events SET status = 'processed', error_code = NULL,
    processed_at = ?, version = version + 1 WHERE id = ? AND version = ? AND ${guard.sql}
    AND EXISTS (SELECT 1 FROM rt_delivery_orders WHERE service = 'ubereats' AND external_order_id = ?
      AND store_id = ? AND account_id = ?)`)
    .bind(now, event.id, event.version, ...guard.binds, order.externalOrderId, store.id, store.accountId));
  const results = await db.batch(statements);
  return Number(results.at(-1)?.meta.changes ?? 0) === 1;
}

function cancelStatement(db: D1Database, store: UberWebhookStore, orderId: string, guard: string, binds: unknown[], now: number) {
  return db.prepare(`UPDATE rt_delivery_orders SET status = 'canceled', canceled_at = ?, canceled_by = 'service',
    cancel_reason_code = 'service_canceled', urgency = 'normal', urgency_reason = NULL,
    version = version + 1, updated_at = ? WHERE service = 'ubereats' AND external_order_id = ?
      AND store_id = ? AND account_id = ? AND status IN ('new', 'cooking', 'ready') AND ${guard}`)
    .bind(now, now, orderId, store.id, store.accountId, ...binds);
}

/** 注文未着でも受信台帳の取消通知を墓標として保持し、遅れて来た新着で復活させない。 */
export async function ingestUberCancellation(input: {
  db: D1Database; store: UberWebhookStore; lease: UberWebhookLease; event: UberWebhookEvent; orderId: string; now: number;
}): Promise<boolean> {
  const guard = fence(input.store, input.lease, input.now);
  const eventGuard = `EXISTS (SELECT 1 FROM rt_delivery_events WHERE id = ? AND version = ?) AND ${guard.sql}`;
  const result = await input.db.batch([
    cancelStatement(input.db, input.store, input.orderId, eventGuard, [input.event.id, input.event.version, ...guard.binds], input.now),
    input.db.prepare(`UPDATE rt_delivery_events SET status = 'processed', error_code = NULL,
      processed_at = ?, version = version + 1 WHERE id = ? AND version = ? AND ${guard.sql}`)
      .bind(input.now, input.event.id, input.event.version, ...guard.binds),
  ]);
  return Number(result[1]?.meta.changes ?? 0) === 1;
}
