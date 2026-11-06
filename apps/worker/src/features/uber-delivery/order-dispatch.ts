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
import {
  MAX_SEND_ATTEMPTS,
  acquireOrderMutationLease,
  claimDispatchReservation,
  claimRateLimitRetry,
  currentVersionDispatch,
  dispatchReservationId,
  dispatchRow as existingDispatch,
  existingDispatchFailure,
  hasCancellationTombstone,
  markDispatchSendStarted,
  markOrderRateLimited,
  orderMutationLeaseIsLive,
  readyDispatchConnection,
  releaseOrderMutationLease,
  type DispatchConnection as ConnectionRow,
  type DispatchRow,
  type OrderMutationLease,
} from './order-dispatch-retry.js';

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

type LocalReasonCode = 'out_of_stock' | 'store_busy' | 'equipment_trouble' | 'customer_request' | 'other';
const LOCAL_REASON_CODES = new Set<LocalReasonCode>(
  ['out_of_stock', 'store_busy', 'equipment_trouble', 'customer_request', 'other'],
);

function failure(code: string, nextAttemptAt: number | null = null): DeliveryDispatchResult {
  return { ok: false, error: safeDeliveryError(code), nextAttemptAt };
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

function sameConnection(actual: ConnectionRow | null, expected: ConnectionRow): boolean {
  return actual?.uber_store_id === expected.uber_store_id && actual.version === expected.version;
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
          SET status = 'failed', error_code = 'delivery_operation_failed',
              next_attempt_at = NULL, completed_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'pending' AND attempts >= 1 AND attempts <= ?
          AND error_code = 'delivery_result_unknown'`,
    )
    .bind(now, now, id, MAX_SEND_ATTEMPTS)
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

function updateOrderStatement(
  input: UberOrderMutationInput,
  dispatchId: string,
  lease: OrderMutationLease,
  now: number,
  uberStoreId: string,
): D1PreparedStatement {
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
            WHERE id = ? AND status = 'pending' AND attempts >= 1 AND attempts <= ?
              AND error_code = 'delivery_result_unknown')
          AND EXISTS (SELECT 1 FROM rt_resource_locks
            WHERE resource_key = ? AND owner_token = ? AND julianday(expires_at) > julianday(?))
          AND NOT EXISTS (SELECT 1 FROM rt_delivery_events event
            WHERE event.account_id = rt_delivery_orders.account_id AND event.service = 'ubereats'
              AND event.external_order_id = rt_delivery_orders.external_order_id
              AND event.event_type IN ('orders.cancel', 'orders.failure')
              AND json_extract(event.payload_json, '$.meta.user_id') = ?)`,
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
      MAX_SEND_ATTEMPTS,
      lease.key,
      lease.owner,
      new Date(now * 1000).toISOString(),
      uberStoreId,
    );
}

async function finalizeSuccess(
  input: UberOrderMutationInput,
  id: string,
  lease: OrderMutationLease,
  connection: ConnectionRow,
  now: number,
): Promise<boolean> {
  try {
    const results = await input.db.batch([
      updateOrderStatement(input, id, lease, now, connection.uber_store_id),
      input.db
        .prepare(
          `UPDATE rt_delivery_dispatches
              SET status = 'succeeded', error_code = NULL, next_attempt_at = NULL,
                  completed_at = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND status = 'pending' AND attempts >= 1 AND attempts <= ?
              AND error_code = 'delivery_result_unknown' AND changes() = 1`,
        )
        .bind(input.now, input.now, id, MAX_SEND_ATTEMPTS),
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
  try { connection = await readyDispatchConnection(input); }
  catch { return failure('delivery_temporary_failure'); }
  if (!client || !input.env.LINE_CREDENTIAL_ENCRYPTION_KEY || !connection) {
    return failure('delivery_not_configured');
  }

  const dispatchId = dispatchReservationId(input.order, connection);
  let previous: DispatchRow | null;
  try { previous = await currentVersionDispatch(input); }
  catch { return failure('delivery_temporary_failure'); }
  if (previous) {
    const stopped = existingDispatchFailure(previous, input, dispatchId);
    if (stopped) return stopped;
  }

  const fetcher = input.fetcher ?? ((url, init) => fetch(url, init));
  const wallClockStartedAtMs = Date.now();
  const elapsedNow = () => input.now + Math.floor(Math.max(0, Date.now() - wallClockStartedAtMs) / 1000);
  const lease = await acquireOrderMutationLease(input.db, input.order.external_order_id, input.now)
    .catch(() => null);
  if (!lease) return failure('delivery_order_conflict');
  try {
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
    if (!await orderMutationLeaseIsLive(input.db, lease, elapsedNow()).catch(() => false)
      || await hasCancellationTombstone(input.db, input, connection).catch(() => true)) {
      return failure('delivery_order_conflict');
    }

    let claimed: boolean;
    try {
      claimed = previous
        ? await claimRateLimitRetry(input, connection, dispatchId, lease, elapsedNow())
        : await claimDispatchReservation(input, connection, dispatchId, lease, elapsedNow());
    } catch {
      return failure('delivery_temporary_failure');
    }
    if (!claimed) {
      if (!await orderIsCurrent(input).catch(() => false)) return failure('delivery_order_conflict');
      if (!sameConnection(await readyDispatchConnection(input).catch(() => null), connection)) {
        return failure('delivery_not_configured');
      }
      const existing = await existingDispatch(input.db, dispatchId).catch(() => null);
      if (existing) return existingDispatchFailure(existing, input, dispatchId)
        ?? failure('delivery_temporary_failure');
      return failure('delivery_order_conflict');
    }

    // 永続予約の直後に、送信停止・注文版・店舗接続をもう一度読む。
    if (!deliverySendEnabled(input.env)) {
      if (previous) {
        await markResultUnknown(input.db, dispatchId, elapsedNow());
        return failure('delivery_result_unknown');
      }
      await markBeforeSendFailure(input.db, dispatchId, 'delivery_send_disabled', input.now).catch(() => {});
      return failure('delivery_send_disabled');
    }
    if (!await orderIsCurrent(input).catch(() => false)) {
      if (previous) {
        await markResultUnknown(input.db, dispatchId, elapsedNow());
        return failure('delivery_result_unknown');
      }
      await markBeforeSendFailure(input.db, dispatchId, 'delivery_order_conflict', input.now).catch(() => {});
      return failure('delivery_order_conflict');
    }
    const currentConnection = await readyDispatchConnection(input).catch(() => null);
    if (!clientFor(input.env) || !sameConnection(currentConnection, connection)) {
      if (previous) {
        await markResultUnknown(input.db, dispatchId, elapsedNow());
        return failure('delivery_result_unknown');
      }
      await markBeforeSendFailure(input.db, dispatchId, 'delivery_not_configured', input.now).catch(() => {});
      return failure('delivery_not_configured');
    }
    if (!previous && !await markDispatchSendStarted(
      input, dispatchId, connection, lease, elapsedNow(),
    ).catch(() => false)) {
      await markResultUnknown(input.db, dispatchId, input.now);
      return failure('delivery_result_unknown');
    }
    if (!await orderMutationLeaseIsLive(input.db, lease, elapsedNow()).catch(() => false)
      || await hasCancellationTombstone(input.db, input, connection).catch(() => true)) {
      await markResultUnknown(input.db, dispatchId, elapsedNow());
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
      const completedNow = elapsedNow();
      if (error instanceof UberEatsError && error.kind === 'rate_limited') {
        const saved = await markOrderRateLimited(input.db, dispatchId, completedNow).catch(() => null);
        if (saved?.status === 'retryable_failed') {
          return failure('delivery_rate_limited', saved.next_attempt_at);
        }
        if (saved?.status === 'failed') return failure('delivery_operation_failed');
        await markResultUnknown(input.db, dispatchId, completedNow);
        return failure('delivery_result_unknown');
      }
      const confirmed = error instanceof UberEatsError
        && error.status !== null
        && error.status >= 400
        && error.status < 500
        && error.status !== 408;
      if (confirmed) {
        const saved = await markConfirmedFailure(input.db, dispatchId, completedNow).catch(() => false);
        if (saved) return failure('delivery_operation_failed');
      }
      await markResultUnknown(input.db, dispatchId, completedNow);
      return failure('delivery_result_unknown');
    }

    const completedNow = elapsedNow();
    if (!await orderMutationLeaseIsLive(input.db, lease, completedNow).catch(() => false)) {
      await markResultUnknown(input.db, dispatchId, completedNow);
      return failure('delivery_result_unknown');
    }
    if (await finalizeSuccess(input, dispatchId, lease, connection, completedNow)) return { ok: true };
    await markResultUnknown(input.db, dispatchId, completedNow);
    return failure('delivery_result_unknown');
  } finally {
    await releaseOrderMutationLease(input.db, lease).catch(() => {});
  }
}
