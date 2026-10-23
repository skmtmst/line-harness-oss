import type { DeliveryDispatchResult } from '../../services/restaurant-delivery.js';
import { safeDeliveryError } from '../../services/restaurant-delivery.js';
import { acquireWebhookLock, releaseWebhookLock } from './webhook-ingestion.js';

interface DispatchMutationInput {
  db: D1Database;
  store: { id: string; lineAccountId: string };
  order: {
    id: string;
    account_id: string;
    store_id: string;
    external_order_id: string;
    status: string;
    version: number;
  };
  action: string;
  now: number;
}

export interface DispatchConnection {
  uber_store_id: string;
  version: number;
}

export interface DispatchRow {
  id: string;
  action: string;
  status: string;
  error_code: string | null;
  attempts: number;
  next_attempt_at: number | null;
}

export const MAX_SEND_ATTEMPTS = 4;
const BACKOFF_SECONDS = [60, 300, 1_800] as const;

export interface OrderMutationLease { key: string; owner: string }

const CONNECTION_JOINS = `FROM rt_delivery_uber_connections c
  JOIN rt_stores s ON s.id = c.store_id
  JOIN rt_organizations o ON o.id = s.organization_id
  JOIN line_accounts a ON a.id = c.account_id
  JOIN tenants t ON t.id = o.tenant_id`;
const CONNECTION_ELIGIBILITY = `c.status = 'connected' AND c.provisioned_at IS NOT NULL
  AND c.uber_store_id IS NOT NULL AND trim(c.uber_store_id) <> ''
  AND COALESCE(c.last_error, '') NOT IN ('pos_activation_started', 'pos_activation_unknown',
    'pos_deactivation_started', 'pos_deactivation_unknown',
    'pos_disconnect_reauthorization_pending',
    'store_provision_review_required', 'store_menu_refresh_review_required')
  AND s.status = 'active' AND s.line_account_id = c.account_id
  AND o.status <> 'archived'
  AND a.is_active = 1 AND a.archived_at IS NULL AND a.tenant_id = o.tenant_id
  AND t.status = 'active'
  AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(t.feature_packs) THEN t.feature_packs ELSE '[]' END)
    WHERE value = 'restaurant')
  AND NOT EXISTS (SELECT 1 FROM rt_store_feature_flags f
    WHERE f.store_id = c.store_id AND f.feature = 'delivery' AND f.enabled = 0)
  AND (SELECT COUNT(*) FROM rt_delivery_uber_connections duplicate
    WHERE duplicate.uber_store_id = c.uber_store_id AND duplicate.status = 'connected'
      AND duplicate.provisioned_at IS NOT NULL) = 1`;

export async function acquireOrderMutationLease(
  db: D1Database,
  externalOrderId: string,
  now: number,
): Promise<OrderMutationLease | null> {
  const lease = { key: `uber-webhook-order:${externalOrderId}`, owner: crypto.randomUUID() };
  return await acquireWebhookLock(db, lease.key, lease.owner, now) ? lease : null;
}

export function releaseOrderMutationLease(db: D1Database, lease: OrderMutationLease): Promise<void> {
  return releaseWebhookLock(db, lease.key, lease.owner);
}

export async function orderMutationLeaseIsLive(
  db: D1Database,
  lease: OrderMutationLease,
  now: number,
): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM rt_resource_locks
    WHERE resource_key = ? AND owner_token = ? AND julianday(expires_at) > julianday(?)`)
    .bind(lease.key, lease.owner, new Date(now * 1000).toISOString()).first();
  return row !== null;
}

export async function hasCancellationTombstone(
  db: D1Database,
  input: DispatchMutationInput,
  connection: DispatchConnection,
): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM rt_delivery_events
    WHERE account_id = ? AND service = 'ubereats' AND external_order_id = ?
      AND event_type IN ('orders.cancel', 'orders.failure')
      AND json_extract(payload_json, '$.meta.user_id') = ? LIMIT 1`)
    .bind(input.order.account_id, input.order.external_order_id, connection.uber_store_id).first();
  return row !== null;
}

export async function readyDispatchConnection(
  input: DispatchMutationInput,
): Promise<DispatchConnection | null> {
  return input.db.prepare(`SELECT c.uber_store_id, c.version ${CONNECTION_JOINS}
    WHERE c.store_id = ? AND c.account_id = ? AND ${CONNECTION_ELIGIBILITY} LIMIT 1`)
    .bind(input.store.id, input.store.lineAccountId).first<DispatchConnection>();
}

function mutationFences(connection: DispatchConnection, accountRef = 'rt_delivery_dispatches.account_id') {
  return {
    sql: `EXISTS (SELECT 1 FROM rt_resource_locks
      WHERE resource_key = ? AND owner_token = ? AND julianday(expires_at) > julianday(?))
      AND NOT EXISTS (SELECT 1 FROM rt_delivery_events event
        WHERE event.account_id = ${accountRef} AND event.service = 'ubereats'
          AND event.external_order_id = ? AND event.event_type IN ('orders.cancel', 'orders.failure')
          AND json_extract(event.payload_json, '$.meta.user_id') = ?)`,
    tail: (lease: OrderMutationLease, externalOrderId: string, now: number) => [
      lease.key, lease.owner, new Date(now * 1000).toISOString(), externalOrderId, connection.uber_store_id,
    ],
  };
}

export async function claimDispatchReservation(input: DispatchMutationInput, connection: DispatchConnection,
  id: string, lease: OrderMutationLease, now: number): Promise<boolean> {
  const fence = mutationFences(connection, 'orders.account_id');
  const result = await input.db.prepare(`INSERT OR IGNORE INTO rt_delivery_dispatches
    (id, account_id, store_id, service, action, target_kind, target_id, status, error_code, attempts,
     next_attempt_at, requested_at, completed_at, version, created_at, updated_at)
    SELECT ?, orders.account_id, orders.store_id, 'ubereats', ?, 'order', orders.id,
      'pending', NULL, 0, NULL, ?, NULL, 1, ?, ? FROM rt_delivery_orders orders
    WHERE orders.id = ? AND orders.account_id = ? AND orders.store_id = ? AND orders.service = 'ubereats'
      AND orders.external_order_id = ? AND orders.status = ? AND orders.version = ?
      AND EXISTS (SELECT 1 ${CONNECTION_JOINS} WHERE c.store_id = orders.store_id
        AND c.account_id = orders.account_id AND c.uber_store_id = ? AND c.version = ?
        AND ${CONNECTION_ELIGIBILITY}) AND ${fence.sql}`)
    .bind(id, input.action, input.now, input.now, input.now, input.order.id, input.order.account_id,
      input.order.store_id, input.order.external_order_id, input.order.status, input.order.version,
      connection.uber_store_id, connection.version, ...fence.tail(lease, input.order.external_order_id, now)).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function claimRateLimitRetry(input: DispatchMutationInput, connection: DispatchConnection,
  id: string, lease: OrderMutationLease, now: number): Promise<boolean> {
  const fence = mutationFences(connection);
  const result = await input.db.prepare(`UPDATE rt_delivery_dispatches
    SET status = 'pending', error_code = 'delivery_result_unknown', attempts = attempts + 1,
      next_attempt_at = NULL, completed_at = NULL, version = version + 1, updated_at = ?
    WHERE id = ? AND account_id = ? AND store_id = ? AND action = ?
      AND status = 'retryable_failed' AND error_code = 'delivery_rate_limited'
      AND attempts >= 1 AND attempts < ? AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?
      AND EXISTS (SELECT 1 FROM rt_delivery_orders orders WHERE orders.id = ?
        AND orders.account_id = ? AND orders.store_id = ? AND orders.service = 'ubereats'
        AND orders.external_order_id = ? AND orders.status = ? AND orders.version = ?)
      AND EXISTS (SELECT 1 ${CONNECTION_JOINS} WHERE c.store_id = ? AND c.account_id = ?
        AND c.uber_store_id = ? AND c.version = ? AND ${CONNECTION_ELIGIBILITY}) AND ${fence.sql}`)
    .bind(input.now, id, input.order.account_id, input.order.store_id, input.action, MAX_SEND_ATTEMPTS,
      input.now, input.order.id, input.order.account_id, input.order.store_id, input.order.external_order_id,
      input.order.status, input.order.version, input.store.id, input.store.lineAccountId,
      connection.uber_store_id, connection.version,
      ...fence.tail(lease, input.order.external_order_id, now)).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function markDispatchSendStarted(input: DispatchMutationInput, id: string,
  connection: DispatchConnection, lease: OrderMutationLease, now: number): Promise<boolean> {
  const fence = mutationFences(connection);
  const result = await input.db.prepare(`UPDATE rt_delivery_dispatches
    SET error_code = 'delivery_result_unknown', attempts = 1, next_attempt_at = NULL,
      updated_at = ?, version = version + 1
    WHERE id = ? AND status = 'pending' AND attempts = 0
      AND EXISTS (SELECT 1 FROM rt_delivery_orders orders WHERE orders.id = ?
        AND orders.account_id = ? AND orders.store_id = ? AND orders.service = 'ubereats'
        AND orders.external_order_id = ? AND orders.status = ? AND orders.version = ?)
      AND EXISTS (SELECT 1 ${CONNECTION_JOINS} WHERE c.store_id = ? AND c.account_id = ?
        AND c.uber_store_id = ? AND c.version = ? AND ${CONNECTION_ELIGIBILITY}) AND ${fence.sql}`)
    .bind(now, id, input.order.id, input.order.account_id, input.order.store_id,
      input.order.external_order_id, input.order.status, input.order.version,
      input.store.id, input.store.lineAccountId, connection.uber_store_id, connection.version,
      ...fence.tail(lease, input.order.external_order_id, now)).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

function failure(code: string, nextAttemptAt: number | null = null): DeliveryDispatchResult {
  return { ok: false, error: safeDeliveryError(code), nextAttemptAt };
}

function prefix(order: { id: string; version: number }): string {
  return `uber-order-mutation:v2:${encodeURIComponent(order.id)}:${order.version}:`;
}

export function dispatchReservationId(
  order: { id: string; version: number },
  connection: DispatchConnection,
): string {
  return `${prefix(order)}${encodeURIComponent(connection.uber_store_id)}:${connection.version}`;
}

export async function dispatchRow(db: D1Database, id: string): Promise<DispatchRow | null> {
  return db.prepare(`SELECT id, action, status, error_code, attempts, next_attempt_at
    FROM rt_delivery_dispatches WHERE id = ? LIMIT 1`).bind(id).first<DispatchRow>();
}

export async function currentVersionDispatch(input: DispatchMutationInput): Promise<DispatchRow | null> {
  const rows = await input.db.prepare(`SELECT id, action, status, error_code, attempts, next_attempt_at
    FROM rt_delivery_dispatches WHERE account_id = ? AND store_id = ? AND service = 'ubereats'
      AND target_kind = 'order' AND target_id = ?`)
    .bind(input.order.account_id, input.order.store_id, input.order.id).all<DispatchRow>();
  const currentPrefix = prefix(input.order);
  const legacyId = `uber-order-mutation:v1:${input.order.id}:${input.order.version}`;
  const exact = rows.results.find((row) => row.id === legacyId || row.id.startsWith(currentPrefix));
  return exact ?? rows.results.find((row) => row.status === 'pending'
    || row.status === 'retryable_failed'
    || row.error_code === 'delivery_result_unknown'
    || row.error_code === 'delivery_rate_limited') ?? null;
}

export function existingDispatchFailure(
  row: DispatchRow,
  input: DispatchMutationInput,
  id: string,
): DeliveryDispatchResult | null {
  if (row.id !== id) {
    const legacyId = `uber-order-mutation:v1:${input.order.id}:${input.order.version}`;
    return row.id === legacyId || row.id.startsWith(prefix(input.order))
      ? failure('delivery_not_configured')
      : failure('delivery_order_conflict');
  }
  if (row.action !== input.action) return failure('delivery_order_conflict');
  if (row.status === 'pending') return failure('delivery_result_unknown');
  if (row.status === 'failed') return failure('delivery_operation_failed');
  if (row.status !== 'retryable_failed' || row.error_code !== 'delivery_rate_limited') {
    return failure('delivery_order_conflict');
  }
  if (row.attempts >= MAX_SEND_ATTEMPTS) return failure('delivery_operation_failed');
  if (row.next_attempt_at === null || input.now < row.next_attempt_at) {
    return failure('delivery_rate_limited', row.next_attempt_at);
  }
  return null;
}

export async function markOrderRateLimited(db: D1Database, id: string, now: number): Promise<DispatchRow | null> {
  const result = await db.prepare(`UPDATE rt_delivery_dispatches
    SET status = CASE WHEN attempts < ? THEN 'retryable_failed' ELSE 'failed' END,
        error_code = 'delivery_rate_limited',
        next_attempt_at = CASE attempts WHEN 1 THEN ? WHEN 2 THEN ? WHEN 3 THEN ? ELSE NULL END,
        completed_at = CASE WHEN attempts < ? THEN NULL ELSE ? END,
        version = version + 1, updated_at = ?
    WHERE id = ? AND status = 'pending' AND error_code = 'delivery_result_unknown'
      AND attempts >= 1 AND attempts <= ?`)
    .bind(MAX_SEND_ATTEMPTS, now + BACKOFF_SECONDS[0], now + BACKOFF_SECONDS[1],
      now + BACKOFF_SECONDS[2], MAX_SEND_ATTEMPTS, now, now, id, MAX_SEND_ATTEMPTS).run();
  return Number(result.meta?.changes ?? 0) === 1 ? dispatchRow(db, id) : null;
}
