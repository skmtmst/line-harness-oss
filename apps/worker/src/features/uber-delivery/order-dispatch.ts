import { CredentialEncryptionKeyError } from '@line-crm/db';
import { tracedFetch as fetch } from '@line-crm/shared/server';
import type { DeliveryOrderRow } from '../../routes/restaurant-delivery-types.js';
import {
  canTransitionOrder,
  deliverySendEnabled,
  safeDeliveryError,
  type DeliveryAction,
  type DeliveryDispatchResult,
  type DeliveryEnv,
  type DeliveryOrderStatus,
} from '../../services/restaurant-delivery.js';
import { UberEatsError, type FetchLike } from '../../services/uber-eats.js';
import { uberHosts, type UberHosts } from '../../services/uber-eats-hosts.js';
import { getUberApplicationToken } from './application-token.js';
import { sendUberOrderAction } from './order-api.js';

export type UberMutationOrder = Pick<
  DeliveryOrderRow,
  'id' | 'account_id' | 'store_id' | 'service' | 'external_order_id' | 'status' | 'version'
>;

export interface UberOrderMutationInput {
  db: D1Database;
  env: DeliveryEnv & { LINE_CREDENTIAL_ENCRYPTION_KEY?: string };
  store: { id: string; lineAccountId: string };
  order: UberMutationOrder;
  action: DeliveryAction;
  to: DeliveryOrderStatus;
  timeColumn: 'accepted_at' | 'ready_at' | 'handed_over_at' | 'canceled_at' | null;
  reasonCode?: string;
  now: number;
  fetcher?: FetchLike;
}

interface UberClient {
  clientId: string;
  clientSecret: string;
  hosts: UberHosts;
}

interface ConnectionRow {
  uber_store_id: string;
  version: number;
}

interface DispatchRow {
  status: string;
  error_code: string | null;
}

type LocalReasonCode = 'out_of_stock' | 'store_busy' | 'equipment_trouble' | 'customer_request' | 'other';
const LOCAL_REASON_CODES = new Set<LocalReasonCode>(
  ['out_of_stock', 'store_busy', 'equipment_trouble', 'customer_request', 'other'],
);

const CONNECTION_JOINS = `FROM rt_delivery_uber_connections c
  JOIN rt_stores s ON s.id = c.store_id
  JOIN rt_organizations o ON o.id = s.organization_id
  JOIN line_accounts a ON a.id = c.account_id
  JOIN tenants t ON t.id = o.tenant_id`;
const CONNECTION_ELIGIBILITY = `c.status = 'connected' AND c.provisioned_at IS NOT NULL
  AND c.uber_store_id IS NOT NULL AND trim(c.uber_store_id) <> ''
  AND COALESCE(c.last_error, '') NOT IN ('pos_activation_started', 'pos_activation_unknown')
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

function failure(code: string): DeliveryDispatchResult {
  return { ok: false, error: safeDeliveryError(code), nextAttemptAt: null };
}

function localReasonCode(value: string | undefined): LocalReasonCode {
  return value !== undefined && LOCAL_REASON_CODES.has(value as LocalReasonCode)
    ? value as LocalReasonCode
    : 'other';
}

function clientFor(env: DeliveryEnv): UberClient | null {
  const clientId = env.RT_DELIVERY_UBEREATS_CLIENT_ID?.trim();
  const clientSecret = env.RT_DELIVERY_UBEREATS_CLIENT_SECRET?.trim();
  const hosts = uberHosts(env);
  return clientId && clientSecret && hosts ? { clientId, clientSecret, hosts } : null;
}

function mutationIsSupported(input: UberOrderMutationInput): boolean {
  if (!canTransitionOrder(input.order.status, input.to)) return false;
  if (input.action === 'accept') return input.to === 'cooking' && input.timeColumn === 'accepted_at';
  if (input.action === 'reject') return input.to === 'rejected' && input.timeColumn === 'canceled_at';
  if (input.action === 'cancel') return input.to === 'canceled' && input.timeColumn === 'canceled_at';
  return false;
}

function reservationId(order: UberMutationOrder): string {
  // actionを含めない。同じ注文版でacceptとrejectが競合しても、外部へ出るのは片方だけにする。
  return `uber-order-mutation:v1:${order.id}:${order.version}`;
}

async function orderIsCurrent(input: UberOrderMutationInput): Promise<boolean> {
  const row = await input.db
    .prepare(
      `SELECT id FROM rt_delivery_orders
        WHERE id = ? AND account_id = ? AND store_id = ? AND service = 'ubereats'
          AND external_order_id = ? AND status = ? AND version = ?
        LIMIT 1`,
    )
    .bind(input.order.id, input.store.lineAccountId, input.store.id,
      input.order.external_order_id, input.order.status, input.order.version)
    .first<{ id: string }>();
  return row?.id === input.order.id;
}

async function readyConnection(input: UberOrderMutationInput): Promise<ConnectionRow | null> {
  const row = await input.db
    .prepare(
      `SELECT c.uber_store_id, c.version ${CONNECTION_JOINS}
        WHERE c.store_id = ? AND c.account_id = ? AND ${CONNECTION_ELIGIBILITY}
        LIMIT 1`,
    )
    .bind(input.store.id, input.store.lineAccountId)
    .first<ConnectionRow>();
  return row ?? null;
}

async function claimReservation(
  input: UberOrderMutationInput,
  connection: ConnectionRow,
  id: string,
): Promise<boolean> {
  const result = await input.db
    .prepare(
      `INSERT OR IGNORE INTO rt_delivery_dispatches
         (id, account_id, store_id, service, action, target_kind, target_id,
          status, error_code, attempts, next_attempt_at, requested_at, completed_at,
          version, created_at, updated_at)
       SELECT ?, order_row.account_id, order_row.store_id, 'ubereats', ?, 'order', order_row.id,
              'pending', NULL, 0, NULL, ?, NULL, 1, ?, ?
         FROM rt_delivery_orders order_row
        WHERE order_row.id = ? AND order_row.account_id = ? AND order_row.store_id = ?
          AND order_row.service = 'ubereats' AND order_row.external_order_id = ?
          AND order_row.status = ? AND order_row.version = ?
          AND EXISTS (SELECT 1 ${CONNECTION_JOINS}
            WHERE c.store_id = order_row.store_id AND c.account_id = order_row.account_id
              AND c.uber_store_id = ? AND c.version = ? AND ${CONNECTION_ELIGIBILITY})`,
    )
    .bind(
      id,
      input.action,
      input.now,
      input.now,
      input.now,
      input.order.id,
      input.store.lineAccountId,
      input.store.id,
      input.order.external_order_id,
      input.order.status,
      input.order.version,
      connection.uber_store_id,
      connection.version,
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

function sameConnection(actual: ConnectionRow | null, expected: ConnectionRow): boolean {
  return actual?.uber_store_id === expected.uber_store_id && actual.version === expected.version;
}

async function existingDispatch(db: D1Database, id: string): Promise<DispatchRow | null> {
  return db
    .prepare('SELECT status, error_code FROM rt_delivery_dispatches WHERE id = ? LIMIT 1')
    .bind(id)
    .first<DispatchRow>();
}

async function markSendStarted(db: D1Database, id: string, now: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE rt_delivery_dispatches
        SET error_code = 'delivery_result_unknown', attempts = 1,
            next_attempt_at = NULL, updated_at = ?, version = version + 1
      WHERE id = ? AND status = 'pending' AND attempts = 0`,
  ).bind(now, id).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function markBeforeSendFailure(db: D1Database, id: string, code: string, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE rt_delivery_dispatches
          SET status = 'failed', error_code = ?, next_attempt_at = NULL,
              completed_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'pending' AND attempts = 0`,
    )
    .bind(code, now, now, id)
    .run();
}

async function markConfirmedFailure(db: D1Database, id: string, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rt_delivery_dispatches
          SET status = 'failed', error_code = 'delivery_operation_failed', attempts = 1,
              next_attempt_at = NULL, completed_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'pending' AND attempts = 1
          AND error_code = 'delivery_result_unknown'`,
    )
    .bind(now, now, id)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function markResultUnknown(db: D1Database, id: string, now: number): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE rt_delivery_dispatches
            SET error_code = 'delivery_result_unknown', attempts = CASE WHEN attempts < 1 THEN 1 ELSE attempts END,
                next_attempt_at = NULL, completed_at = NULL, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .bind(now, id)
      .run();
  } catch {
    // 予約自体を残すことを優先する。結果不明の操作を新しいIDで送り直さない。
  }
}

function updateOrderStatement(input: UberOrderMutationInput, dispatchId: string): D1PreparedStatement {
  const assignments = ['status = ?'];
  const bindings: unknown[] = [input.to];
  if (input.timeColumn) {
    assignments.push(`${input.timeColumn} = ?`);
    bindings.push(input.now);
  }
  if (input.action === 'cancel') {
    assignments.push("cancel_reason_code = ?", "canceled_by = 'store'");
    bindings.push(localReasonCode(input.reasonCode));
  }
  assignments.push('updated_at = ?', 'version = version + 1');
  bindings.push(input.now);
  return input.db
    .prepare(
      `UPDATE rt_delivery_orders SET ${assignments.join(', ')}
        WHERE id = ? AND account_id = ? AND store_id = ? AND service = 'ubereats'
          AND external_order_id = ? AND status = ? AND version = ?
          AND EXISTS (SELECT 1 FROM rt_delivery_dispatches
            WHERE id = ? AND status = 'pending' AND attempts = 1
              AND error_code = 'delivery_result_unknown')`,
    )
    .bind(
      ...bindings,
      input.order.id,
      input.store.lineAccountId,
      input.store.id,
      input.order.external_order_id,
      input.order.status,
      input.order.version,
      dispatchId,
    );
}

async function finalizeSuccess(input: UberOrderMutationInput, id: string): Promise<boolean> {
  try {
    const results = await input.db.batch([
      updateOrderStatement(input, id),
      input.db
        .prepare(
          `UPDATE rt_delivery_dispatches
              SET status = 'succeeded', error_code = NULL, attempts = 1, next_attempt_at = NULL,
                  completed_at = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND status = 'pending' AND attempts = 1
              AND error_code = 'delivery_result_unknown' AND changes() = 1`,
        )
        .bind(input.now, input.now, id),
    ]);
    const orderChanged = Number(results[0]?.meta?.changes ?? 0) === 1;
    const dispatchChanged = Number(results[1]?.meta?.changes ?? 0) === 1;
    return orderChanged && dispatchChanged;
  } catch {
    return false;
  }
}

function tokenFailure(error: unknown): DeliveryDispatchResult {
  if (error instanceof CredentialEncryptionKeyError) return failure('delivery_not_configured');
  if (error instanceof UberEatsError) {
    if (error.kind === 'auth_expired' || error.kind === 'no_permission' || error.kind === 'invalid_request') {
      return failure('delivery_authentication_failed');
    }
    if (error.kind === 'rate_limited') return failure('delivery_rate_limited');
  }
  return failure('delivery_temporary_failure');
}

/** 1つの注文版に対するUber操作を1回だけ送る。結果不明の予約は再送しない。 */
export async function runUberOrderMutation(input: UberOrderMutationInput): Promise<DeliveryDispatchResult> {
  if (!Number.isSafeInteger(input.now) || input.now < 0 || !mutationIsSupported(input)) {
    return failure('delivery_action_unsupported');
  }
  let current: boolean;
  try { current = await orderIsCurrent(input); }
  catch { return failure('delivery_temporary_failure'); }
  if (input.order.service !== 'ubereats'
    || input.order.store_id !== input.store.id
    || input.order.account_id !== input.store.lineAccountId
    || !current) {
    return failure('delivery_order_conflict');
  }
  if (!deliverySendEnabled(input.env)) return failure('delivery_send_disabled');
  const client = clientFor(input.env);
  let connection: ConnectionRow | null = null;
  try { connection = await readyConnection(input); }
  catch { return failure('delivery_temporary_failure'); }
  if (!client || !input.env.LINE_CREDENTIAL_ENCRYPTION_KEY || !connection) {
    return failure('delivery_not_configured');
  }

  const fetcher = input.fetcher ?? ((url, init) => fetch(url, init));
  let accessToken: string;
  try {
    accessToken = (await getUberApplicationToken({
      db: input.db,
      client,
      encryptionKey: input.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
      fetcher,
      nowMs: input.now * 1000,
    })).accessToken;
  } catch (error) {
    return tokenFailure(error);
  }

  const dispatchId = reservationId(input.order);
  let claimed: boolean;
  try {
    claimed = await claimReservation(input, connection, dispatchId);
  } catch {
    return failure('delivery_temporary_failure');
  }
  if (!claimed) {
    const existing = await existingDispatch(input.db, dispatchId).catch(() => null);
    if (existing?.status === 'pending') return failure('delivery_result_unknown');
    if (existing?.status === 'failed') return failure('delivery_operation_failed');
    return failure('delivery_order_conflict');
  }

  // 永続予約の直後に、送信停止・注文版・店舗接続をもう一度読む。
  if (!deliverySendEnabled(input.env)) {
    await markBeforeSendFailure(input.db, dispatchId, 'delivery_send_disabled', input.now).catch(() => {});
    return failure('delivery_send_disabled');
  }
  if (!await orderIsCurrent(input).catch(() => false)) {
    await markBeforeSendFailure(input.db, dispatchId, 'delivery_order_conflict', input.now).catch(() => {});
    return failure('delivery_order_conflict');
  }
  const currentConnection = await readyConnection(input).catch(() => null);
  if (!clientFor(input.env) || !sameConnection(currentConnection, connection)) {
    await markBeforeSendFailure(input.db, dispatchId, 'delivery_not_configured', input.now).catch(() => {});
    return failure('delivery_not_configured');
  }
  if (!await markSendStarted(input.db, dispatchId, input.now).catch(() => false)) {
    await markResultUnknown(input.db, dispatchId, input.now);
    return failure('delivery_result_unknown');
  }

  try {
    await sendUberOrderAction(
      { hosts: client.hosts, accessToken, fetch: fetcher },
      {
        action: input.action as 'accept' | 'reject' | 'cancel',
        orderId: input.order.external_order_id,
        reasonCode: localReasonCode(input.reasonCode),
      },
    );
  } catch (error) {
    const confirmed = error instanceof UberEatsError
      && error.status !== null
      && error.status >= 400
      && error.status < 500
      && error.status !== 408;
    if (confirmed) {
      const saved = await markConfirmedFailure(input.db, dispatchId, input.now).catch(() => false);
      if (saved) return failure('delivery_operation_failed');
    }
    await markResultUnknown(input.db, dispatchId, input.now);
    return failure('delivery_result_unknown');
  }

  if (await finalizeSuccess(input, dispatchId)) return { ok: true };
  await markResultUnknown(input.db, dispatchId, input.now);
  return failure('delivery_result_unknown');
}
