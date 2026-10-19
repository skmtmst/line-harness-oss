import { logger } from '@line-crm/shared/server';
/**
 * 稼働確認（operations-health）の「外部連携」の行だけを切り出した層。
 *
 * - Webhook・Google Sheets・デリバリー連携の連続失敗をまとめて数える。
 * - 板の9行は増やさない。3つの台帳を1つの確認へ畳んで返す。
 * - 判定（normal/warning/danger）と記録は呼び出し側（operations-health.ts）が持つ。
 */

/**
 * `rt_delivery_*` の台帳と比べるための境界を秒で返す。
 * これらの受信・依頼の時刻は `nowSec` の通算秒（INTEGER）で入るため、
 * JST 文字列を返す jstCutoff とは混ぜられない。
 */
function epochCutoff(nowIso: string, backMs: number): number {
  return Math.floor((Date.parse(nowIso) - backMs) / 1000);
}

/** デリバリー連携の失敗を見る幅。受付中の店で1時間気づかないのは遅い。 */
const DELIVERY_FAILURE_WINDOW_MS = 60 * 60_000;
/** 再試行を使い切った（exhausted）送信は、連続失敗の重さを「異常」側まで上げる。 */
const DELIVERY_EXHAUSTED_WEIGHT = 3;

/** 1つの確認へ畳んだあとの件数。活きている数・失敗している数・連続失敗の最大。 */
export type IntegrationFailureTotals = {
  activeCount: number;
  failingCount: number;
  maxFailures: number;
};

/**
 * デリバリー連携（出前館・Uber Eats・ロケットナウ）の直近の失敗を数える。
 * 出前館QA#3「各APIでエラーの発生を監視する仕組み」をこの確認で受け持つ。
 * 板の9行を増やさないため、外部連携の確認へ畳んで数える。
 *
 * `rt_delivery_*` の時刻は `nowSec` の通算秒なので epochCutoff で境界を作る。
 * 台帳がまだ無い配備では 0 件として返す。ここで投げると isolate が
 * 外部連携の確認ごと「確認できず」に落とし、Webhook や Sheets の失敗も見えなくなる。
 */
export async function deliveryIntegrationFailures(
  db: D1Database,
  lineAccountId: string,
  observedAt: string,
): Promise<IntegrationFailureTotals> {
  try {
    const cutoff = epochCutoff(observedAt, DELIVERY_FAILURE_WINDOW_MS);
    // つなぎ終わっているサービスの数と、連携が切れたままのサービスの数。
    // 切断（error）は連続失敗の数え方と別系なので、Sheets の要再接続と同じく警告側へ足す。
    const states = await db.prepare(
      `SELECT COUNT(*) AS active_count,
              COALESCE(SUM(CASE WHEN connection_status = 'error' THEN 1 ELSE 0 END), 0) AS error_count
         FROM rt_delivery_service_states
        WHERE account_id = ? AND connection_status IN ('connected','error')`,
    ).bind(lineAccountId).first<{ active_count: number; error_count: number }>();
    // 送信の失敗。サービス単位で1件と数え、同じ相手の連打で件数が膨らまないようにする。
    const dispatches = await db.prepare(
      `SELECT COUNT(DISTINCT service) AS failing_count,
              COALESCE(MAX(CASE WHEN status = 'exhausted' THEN ? ELSE attempts END), 0) AS max_failures
         FROM rt_delivery_dispatches
        WHERE account_id = ? AND requested_at >= ?
          AND status IN ('failed','retryable_failed','exhausted')`,
    ).bind(DELIVERY_EXHAUSTED_WEIGHT, lineAccountId, cutoff)
      .first<{ failing_count: number; max_failures: number }>();
    // 受信の取りこぼし。相手からの通知を処理できなかったものを同じように数える。
    const events = await db.prepare(
      `SELECT COUNT(DISTINCT service) AS failing_count,
              COALESCE(MAX(attempts), 0) AS max_failures
         FROM rt_delivery_events
        WHERE account_id = ? AND received_at >= ? AND status IN ('failed','retryable_failed')`,
    ).bind(lineAccountId, cutoff).first<{ failing_count: number; max_failures: number }>();
    return {
      activeCount: Number(states?.active_count ?? 0),
      failingCount:
        Number(states?.error_count ?? 0)
        + Number(dispatches?.failing_count ?? 0)
        + Number(events?.failing_count ?? 0),
      maxFailures: Math.max(
        Number(dispatches?.max_failures ?? 0),
        Number(events?.max_failures ?? 0),
      ),
    };
  } catch {
    // 符号だけ残す。例外の本文・相手の注文の中身は記録に出さない。
    logger.error("services_operations_health_delivery_failed");
    return { activeCount: 0, failingCount: 0, maxFailures: 0 };
  }
}

/**
 * 外部連携の確認に出す件数を、3つの台帳から1つに畳んで返す。
 * - `outgoing_webhooks`: 送信先ごとの連続失敗。
 * - `google_sheets_integrations`（#838 第2段）: 連続失敗と要再接続。
 * - `rt_delivery_*`（出前館QA#3）: デリバリー連携の送信・受信の失敗と連携切れ。
 */
export async function externalIntegrationsSummary(
  db: D1Database,
  lineAccountId: string,
  observedAt: string,
): Promise<IntegrationFailureTotals> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS active_count,
            COALESCE(SUM(CASE WHEN consecutive_failures > 0 THEN 1 ELSE 0 END), 0) AS failing_count,
            COALESCE(MAX(consecutive_failures), 0) AS max_failures
       FROM outgoing_webhooks WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL`,
  ).bind(lineAccountId).first<{ active_count: number; failing_count: number; max_failures: number }>();
  // 要再接続（expired）は連続失敗カウンタと別系のため、警告側の件数に足す。
  const sheets = await db.prepare(
    `SELECT COUNT(*) AS active_count,
            COALESCE(SUM(CASE WHEN consecutive_failures > 0 OR status = 'expired' THEN 1 ELSE 0 END), 0) AS failing_count,
            COALESCE(MAX(consecutive_failures), 0) AS max_failures
       FROM google_sheets_integrations WHERE line_account_id = ?`,
  ).bind(lineAccountId).first<{ active_count: number; failing_count: number; max_failures: number }>();
  const delivery = await deliveryIntegrationFailures(db, lineAccountId, observedAt);
  return {
    activeCount:
      Number(row?.active_count ?? 0) + Number(sheets?.active_count ?? 0) + delivery.activeCount,
    failingCount:
      Number(row?.failing_count ?? 0) + Number(sheets?.failing_count ?? 0) + delivery.failingCount,
    maxFailures: Math.max(
      Number(row?.max_failures ?? 0),
      Number(sheets?.max_failures ?? 0),
      delivery.maxFailures,
    ),
  };
}
