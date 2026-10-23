const APPLIED_REVIEW_CODES = [
  'store_provision_review_required',
  'store_menu_refresh_review_required',
] as const;

export interface AppliedUberStoreLifecycleState {
  timestampMs: number;
  reviewRequired: boolean;
}

/** Latest provider lifecycle event that durably changed this mapping, without a schema change. */
export async function appliedUberStoreLifecycleState(
  db: D1Database,
  accountId: string,
  uberStoreId: string,
): Promise<AppliedUberStoreLifecycleState> {
  const row = await db.prepare(`WITH applied AS (
      SELECT CAST(json_extract(payload_json, '$.webhook_meta.webhook_msg_timestamp') AS INTEGER) AS timestamp_seconds,
        status, error_code
      FROM rt_delivery_events
      WHERE service = 'ubereats' AND account_id = ?
        AND event_type IN ('store.provisioned', 'store.deprovisioned')
        AND json_extract(payload_json, '$.store_id') = ?
        AND json_type(payload_json, '$.webhook_meta.webhook_msg_timestamp') = 'integer'
        AND (status = 'processed' OR (status = 'failed' AND error_code IN (?, ?)))
    )
    SELECT MAX(timestamp_seconds) AS timestamp_seconds,
      MAX(CASE WHEN timestamp_seconds = (SELECT MAX(timestamp_seconds) FROM applied)
        AND status = 'failed' AND error_code IN (?, ?) THEN 1 ELSE 0 END) AS review_required
    FROM applied`)
    .bind(accountId, uberStoreId, ...APPLIED_REVIEW_CODES, ...APPLIED_REVIEW_CODES)
    .first<{ timestamp_seconds: number | null; review_required: number | null }>();
  const seconds = Number(row?.timestamp_seconds);
  return {
    timestampMs: Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : 0,
    reviewRequired: row?.review_required === 1,
  };
}
