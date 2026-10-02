/**
 * L (#824 ダッシュボードの数字の出どころ): 失敗の数の出どころ集計。
 *
 * ダッシュボードの失敗の数は、通知の送達台帳(`notification_deliveries`)から
 * 数える。数え方は出どころの表示と一致させる。
 *
 * - 同じ失敗は通知インスタンス1件として数える(送達行の数ではない)。
 * - 送り直し(`execution_mode` が `retry` / `resend` / `test`)は数えない。
 * - 件数は SQL の `COUNT(DISTINCT instance_id)` が正本。代表の送達IDは
 *   台帳へのつなぎ(表示用)で、件数の根拠にはしない。
 */

/** 出どころごとの失敗の数。`source` は親イベントの種類。親不明は null。 */
export interface DeliveryFailureOrigin {
  source: string | null;
  /** 同じ失敗を1件として数えた件数。 */
  failures: number;
  /** この出どころの最新の失敗時刻。数字がいつ時点かの印。 */
  latestFailedAt: string | null;
  /** 台帳へのつなぎ。代表の送達IDを新しい順に最大3件。 */
  sampleDeliveryIds: string[];
}

export interface DeliveryFailureOrigins {
  /** 出どころ合計の失敗件数。 */
  total: number;
  /** 全体の最新の失敗時刻。失敗が無ければ null。 */
  asOf: string | null;
  origins: DeliveryFailureOrigin[];
}

/**
 * 指定アカウントの、指定時刻以降の失敗を出どころごとに数える。
 *
 * `since` は「今日の失敗」なら日本時間の今日 0:00(ISO 文字列)。呼び出し側が
 * 決める。ここでは受け取った文字列をそのまま比べるだけにする。
 */
export async function getDeliveryFailureOrigins(
  db: D1Database,
  input: { lineAccountId: string; since: string },
): Promise<DeliveryFailureOrigins> {
  const counts = await db.prepare(`
    SELECT d.source AS source,
           COUNT(DISTINCT d.instance_id) AS failures,
           MAX(d.failed_at) AS latest_failed_at
      FROM notification_deliveries d
     WHERE d.line_account_id = ?
       AND d.status = 'failed'
       AND d.execution_mode = 'automatic'
       AND d.failed_at IS NOT NULL
       AND d.failed_at >= ?
     GROUP BY d.source
     ORDER BY failures DESC, latest_failed_at DESC
  `).bind(input.lineAccountId, input.since).all<{
    source: string | null;
    failures: number;
    latest_failed_at: string | null;
  }>();

  const samples = await db.prepare(`
    SELECT d.id AS id, d.instance_id AS instance_id, d.source AS source
      FROM notification_deliveries d
     WHERE d.line_account_id = ?
       AND d.status = 'failed'
       AND d.execution_mode = 'automatic'
       AND d.failed_at IS NOT NULL
       AND d.failed_at >= ?
     ORDER BY d.failed_at DESC, d.id DESC
     LIMIT 200
  `).bind(input.lineAccountId, input.since).all<{
    id: string;
    instance_id: string;
    source: string | null;
  }>();

  const sampleBySource = new Map<string | null, string[]>();
  const seenInstances = new Set<string>();
  for (const row of samples.results) {
    if (seenInstances.has(row.instance_id)) continue;
    seenInstances.add(row.instance_id);
    const key = row.source;
    const list = sampleBySource.get(key) ?? [];
    if (list.length < 3) {
      list.push(row.id);
      sampleBySource.set(key, list);
    }
  }

  const origins: DeliveryFailureOrigin[] = counts.results.map((row) => ({
    source: row.source,
    failures: Number(row.failures),
    latestFailedAt: row.latest_failed_at,
    sampleDeliveryIds: sampleBySource.get(row.source) ?? [],
  }));
  return {
    total: origins.reduce((sum, origin) => sum + origin.failures, 0),
    asOf: origins.length > 0
      ? origins.map((origin) => origin.latestFailedAt)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null
      : null,
    origins,
  };
}
