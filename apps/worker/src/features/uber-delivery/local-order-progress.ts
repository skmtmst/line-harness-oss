import type { DeliveryOrderRow } from '../../routes/restaurant-delivery-types.js';
import {
  canTransitionOrder,
  deliverySendEnabled,
  safeDeliveryError,
  type DeliveryDispatchResult,
  type DeliveryEnv,
} from '../../services/restaurant-delivery.js';
import { UBER_STORE_ELIGIBILITY, UBER_STORE_JOINS } from './webhook-ingestion.js';

type LocalProgressStatus = 'ready' | 'handed_over';
type LocalProgressColumn = 'ready_at' | 'handed_over_at';

type LocalProgressOrder = Pick<
  DeliveryOrderRow,
  'id' | 'account_id' | 'store_id' | 'service' | 'external_order_id' | 'status' | 'version'
>;

export interface UberLocalOrderProgressInput {
  db: D1Database;
  env: DeliveryEnv;
  store: { id: string; lineAccountId: string };
  order: LocalProgressOrder;
  to: LocalProgressStatus;
  timeColumn: LocalProgressColumn;
  now: number;
}

interface ConnectionFence {
  uber_store_id: string;
  version: number;
}

function failure(code: string): DeliveryDispatchResult {
  return { ok: false, error: safeDeliveryError(code), nextAttemptAt: null };
}

function validProgress(input: UberLocalOrderProgressInput): boolean {
  if (!Number.isSafeInteger(input.now) || input.now < 0) return false;
  if (input.to === 'ready') return input.timeColumn === 'ready_at' && input.order.status === 'cooking';
  return input.timeColumn === 'handed_over_at' && input.order.status === 'ready';
}

async function readyConnection(input: UberLocalOrderProgressInput): Promise<ConnectionFence | null> {
  return input.db.prepare(`SELECT u.uber_store_id, u.version ${UBER_STORE_JOINS}
    WHERE u.store_id = ? AND u.account_id = ? AND ${UBER_STORE_ELIGIBILITY}
      AND (SELECT COUNT(*) FROM rt_delivery_uber_connections duplicate
        WHERE duplicate.uber_store_id = u.uber_store_id AND duplicate.status = 'connected'
          AND duplicate.provisioned_at IS NOT NULL) = 1
    LIMIT 1`)
    .bind(input.store.id, input.store.lineAccountId)
    .first<ConnectionFence>();
}

async function unresolvedExternalMutation(input: UberLocalOrderProgressInput): Promise<boolean> {
  return (await input.db.prepare(`SELECT 1 FROM rt_delivery_dispatches
    WHERE account_id = ? AND store_id = ? AND service = 'ubereats'
      AND target_kind = 'order' AND target_id = ?
      AND (status = 'pending' OR error_code = 'delivery_result_unknown')
    LIMIT 1`)
    .bind(input.order.account_id, input.order.store_id, input.order.id)
    .first()) !== null;
}

/**
 * 現在のRestaurant連携契約では、「準備完了」「受け渡し済み」を店舗内の進行として記録する。
 * 外部操作の結果不明や取消通知が残る間は、見かけの状態だけを先へ進めない。
 */
export async function advanceUberOrderLocally(
  input: UberLocalOrderProgressInput,
): Promise<DeliveryDispatchResult> {
  if (
    input.order.service !== 'ubereats'
    || input.order.store_id !== input.store.id
    || input.order.account_id !== input.store.lineAccountId
    || !validProgress(input)
    || !canTransitionOrder(input.order.status, input.to)
  ) {
    return failure('delivery_action_unsupported');
  }
  if (!deliverySendEnabled(input.env)) return failure('delivery_send_disabled');

  let connection: ConnectionFence | null;
  try {
    connection = await readyConnection(input);
  } catch {
    return failure('delivery_temporary_failure');
  }
  if (!connection) return failure('delivery_not_configured');
  if (await unresolvedExternalMutation(input).catch(() => true)) {
    return failure('delivery_result_unknown');
  }

  const column = input.timeColumn === 'ready_at' ? 'ready_at' : 'handed_over_at';
  let changed = 0;
  try {
    const updated = await input.db.prepare(`UPDATE rt_delivery_orders
      SET status = ?, ${column} = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND account_id = ? AND store_id = ? AND service = 'ubereats'
        AND external_order_id = ? AND status = ? AND version = ?
        AND NOT EXISTS (SELECT 1 FROM rt_delivery_dispatches dispatch
          WHERE dispatch.account_id = rt_delivery_orders.account_id
            AND dispatch.store_id = rt_delivery_orders.store_id AND dispatch.service = 'ubereats'
            AND dispatch.target_kind = 'order' AND dispatch.target_id = rt_delivery_orders.id
            AND (dispatch.status = 'pending' OR dispatch.error_code = 'delivery_result_unknown'))
        AND NOT EXISTS (SELECT 1 FROM rt_resource_locks active_order_webhook
          WHERE active_order_webhook.resource_key = ?
            AND julianday(active_order_webhook.expires_at) > julianday(?))
        AND NOT EXISTS (SELECT 1 FROM rt_delivery_events cancellation
          WHERE cancellation.account_id = rt_delivery_orders.account_id
            AND cancellation.service = 'ubereats'
            AND cancellation.external_order_id = rt_delivery_orders.external_order_id
            AND cancellation.event_type IN ('orders.cancel', 'orders.failure')
            AND json_extract(cancellation.payload_json, '$.meta.user_id') = ?)
        AND EXISTS (SELECT 1 ${UBER_STORE_JOINS}
          WHERE u.store_id = rt_delivery_orders.store_id
            AND u.account_id = rt_delivery_orders.account_id
            AND u.uber_store_id = ? AND u.version = ? AND ${UBER_STORE_ELIGIBILITY}
            AND (SELECT COUNT(*) FROM rt_delivery_uber_connections duplicate
              WHERE duplicate.uber_store_id = u.uber_store_id AND duplicate.status = 'connected'
                AND duplicate.provisioned_at IS NOT NULL) = 1)`)
      .bind(
        input.to,
        input.now,
        input.now,
        input.order.id,
        input.order.account_id,
        input.order.store_id,
        input.order.external_order_id,
        input.order.status,
        input.order.version,
        `uber-webhook-order:${input.order.external_order_id}`,
        new Date(input.now * 1000).toISOString(),
        connection.uber_store_id,
        connection.uber_store_id,
        connection.version,
      )
      .run();
    changed = Number(updated.meta?.changes ?? 0);
  } catch {
    return failure('delivery_temporary_failure');
  }
  if (changed === 1) return { ok: true };

  if (await unresolvedExternalMutation(input).catch(() => true)) {
    return failure('delivery_result_unknown');
  }
  const currentConnection = await readyConnection(input).catch(() => null);
  if (
    !currentConnection
    || currentConnection.uber_store_id !== connection.uber_store_id
    || currentConnection.version !== connection.version
  ) {
    return failure('delivery_not_configured');
  }
  return failure('delivery_order_conflict');
}
