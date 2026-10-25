/** 既存の接続版と対象列で、一度限りの送信権を永続化する。開始済み・不明は再取得せず、人が照合する。完全な配送台帳や共有の停止ストアの代替にはしない。 */
export const POS_ACTIVATION_STARTED = 'pos_activation_started';
export const POS_ACTIVATION_UNKNOWN = 'pos_activation_unknown';

export function posActivationUnresolved(code: string | null | undefined): boolean {
  return code === POS_ACTIVATION_STARTED || code === POS_ACTIVATION_UNKNOWN;
}

export async function claimPosActivation(db: D1Database, input: {
  storeId: string; accountId: string; uberStoreId: string; name: string; externalId: string | null; version: number;
}): Promise<boolean> {
  // 候補と対象の写しを同じ CAS で確認・保存し、新しい OAuth・別選択・同時要求に置き換えさせない。
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
