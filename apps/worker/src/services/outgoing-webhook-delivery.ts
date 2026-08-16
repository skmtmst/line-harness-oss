/**
 * 送信Webhookの配送。
 *
 * これまで fetch を投げっぱなしにしていて、次の2つが起きていた:
 *   - 相手が 500 を返しても成功として扱っていた（例外にならないため）
 *   - 一度失敗したら終わりで、送り直す手立てが無かった
 *
 * 093 で足した列を使って、送り直しと失敗の記録を入れる。
 */

/** 送り直しまでの待ち時間（ミリ秒）。 */
export function retryDelayMs(attempt: number): number {
  // 1回目 0.5秒、2回目 1秒、3回目 2秒…と倍にして、8秒で頭打ちにする。
  // Worker の実行時間には限りがあるので、分単位では待たない。
  // 相手が長時間落ちている場合まで面倒を見るなら、キューに積む別の設計が要る。
  return Math.min(8000, 500 * 2 ** attempt);
}

/**
 * 送り直す価値のある応答か。
 *
 * 4xx は相手が「この内容は受け取れない」と言っているので、同じものを
 * 送り直しても結果は変わらない。429（多すぎる）だけは時間を置けば通るので送り直す。
 */
export function shouldRetryStatus(status: number): boolean {
  if (status === 429) return true;
  return status >= 500;
}

export interface WebhookRow {
  id: string;
  url: string;
  secret: string | null;
  max_retries: number | null;
}

async function sign(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface DeliveryResult {
  ok: boolean;
  attempts: number;
  lastStatus: number | null;
}

/**
 * 1件のWebhookへ送る。失敗したら max_retries の回数だけ送り直す。
 *
 * 例外を投げない。呼び出し側は「送れたかどうか」を戻り値で受け取る。
 * 送信の失敗でイベント処理そのものを止めたくないため。
 */
export async function deliverWebhook(
  webhook: WebhookRow,
  body: string,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<DeliveryResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = Math.max(0, Math.min(5, webhook.max_retries ?? 0));

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (webhook.secret) {
    headers['X-Webhook-Signature'] = await sign(webhook.secret, body);
  }

  let lastStatus: number | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs(attempt - 1));
    try {
      const res = await fetch(webhook.url, { method: 'POST', headers, body });
      lastStatus = res.status;
      if (res.ok) return { ok: true, attempts: attempt + 1, lastStatus };
      if (!shouldRetryStatus(res.status)) {
        return { ok: false, attempts: attempt + 1, lastStatus };
      }
    } catch (err) {
      // 接続そのものが失敗した場合。相手が落ちている可能性が高いので送り直す。
      console.error(`送信Webhook ${webhook.id} への接続失敗:`, err);
      lastStatus = null;
    }
  }
  return { ok: false, attempts: maxRetries + 1, lastStatus };
}

/**
 * 配送の結果を記録する。
 *
 * 連続失敗の回数を持つのは、運用側が「いつから壊れているか」を
 * 画面で気づけるようにするため。自動では止めない。黙って止まる方が、
 * 送られていないことに気づくのが遅れる。
 */
export async function recordDeliveryOutcome(
  db: D1Database,
  webhookId: string,
  ok: boolean,
): Promise<void> {
  if (ok) {
    await db
      .prepare(
        `UPDATE outgoing_webhooks
            SET consecutive_failures = 0, last_failed_at = NULL
          WHERE id = ? AND consecutive_failures != 0`,
      )
      .bind(webhookId)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE outgoing_webhooks
          SET consecutive_failures = consecutive_failures + 1,
              last_failed_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(webhookId)
    .run();
}
