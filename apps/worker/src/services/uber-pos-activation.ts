/** A durable one-shot fence using the existing connection revision and target columns.
 * Started/unknown are never reclaimed for sending. Reconciliation is an operator task.
 * This is not a substitute for A06's complete journal or shared circuit store.
 */
export const POS_ACTIVATION_STARTED = 'pos_activation_started';
export const POS_ACTIVATION_UNKNOWN = 'pos_activation_unknown';

export function posActivationUnresolved(code: string | null | undefined): boolean {
  return code === POS_ACTIVATION_STARTED || code === POS_ACTIVATION_UNKNOWN;
}

export async function claimPosActivation(db: D1Database, input: {
  storeId: string; accountId: string; uberStoreId: string; name: string; externalId: string | null; version: number;
}): Promise<boolean> {
  // The candidate and target snapshot are checked/written in the same CAS. A new
  // OAuth flow, a different selection or a concurrent request cannot replace it.
  const result = await db.prepare(`UPDATE rt_delivery_uber_connections
    SET uber_store_id = ?, uber_store_name = ?, external_store_id = ?,
        last_error = '${POS_ACTIVATION_STARTED}', version = version + 1, updated_at = ?
    WHERE store_id = ? AND account_id = ? AND version = ? AND status = 'pending_store'
      AND COALESCE(last_error, '') NOT IN ('${POS_ACTIVATION_STARTED}', '${POS_ACTIVATION_UNKNOWN}',
        'pos_deactivation_started', 'pos_deactivation_unknown',
        'pos_disconnect_reauthorization_pending',
        'store_provision_review_required', 'store_menu_refresh_review_required')
      AND EXISTS (SELECT 1 FROM rt_delivery_uber_store_candidates c
        WHERE c.store_id = rt_delivery_uber_connections.store_id AND c.uber_store_id = ?
          AND c.uber_store_name = ? AND c.external_store_id IS ?)`)
    .bind(input.uberStoreId, input.name, input.externalId, Date.now(), input.storeId, input.accountId, input.version,
      input.uberStoreId, input.name, input.externalId).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function finishPosActivation(db: D1Database, storeId: string, uberStoreId: string): Promise<boolean> {
  const now = Date.now();
  const result = await db.prepare(`UPDATE rt_delivery_uber_connections
    SET status = 'connected', connected_at = COALESCE(connected_at, ?), provisioned_at = ?,
        last_error = NULL, version = version + 1, updated_at = ?
    WHERE store_id = ? AND uber_store_id = ? AND last_error = '${POS_ACTIVATION_STARTED}'`)
    .bind(now, now, now, storeId, uberStoreId).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function failPosActivation(db: D1Database, storeId: string, code: string, status?: string): Promise<void> {
  await db.prepare(`UPDATE rt_delivery_uber_connections
    SET last_error = ?, status = COALESCE(?, status), version = version + 1, updated_at = ?
    WHERE store_id = ? AND last_error = '${POS_ACTIVATION_STARTED}'`)
    .bind(code, status ?? null, Date.now(), storeId).run();
}
