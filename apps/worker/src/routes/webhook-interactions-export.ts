import { jstDate as japanDate } from '@line-crm/shared';
import type { Context } from 'hono';
import { listWebhookInteractions } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { webhookResponseLabel } from '../services/webhook-interactions.js';

/** route でアカウント権限を確認した後、安全な項目だけを出力する。 */
export async function exportWebhookInteractions(c: Context<Env>, lineAccountId: string) {
  const direction = c.req.query('direction');
  const status = c.req.query('status');
  const result = await listWebhookInteractions(c.env.DB, {
    lineAccountId,
    periodDays: Number(c.req.query('periodDays') ?? 30),
    direction: direction === 'incoming' || direction === 'outgoing' ? direction : undefined,
    status: status === 'succeeded' || status === 'failed' ? status : undefined,
    search: c.req.query('search'),
    exportAll: true,
  });
  if (result.total > 5000 || result.items.length > 5000) {
    return c.json({ success: false, error: '5,000件以内になるよう期間や検索条件を絞ってください' }, 422);
  }
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+@\-]|^[\t\r\n]/u.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  // 本文・ヘッダ・一致値・資格情報やクエリ付き URL は出力しない。
  const lines = [
    ['日時', '向き', 'つなぎ先', '出来事', '状態', '返事', '試行回数', 'かかった時間（ms）'],
    ...result.items.map(row => [
      row.started_at, row.direction, row.webhook_name, row.event_type,
      row.status, webhookResponseLabel(row), row.attempt_count, row.duration_ms,
    ]),
  ];
  c.set('outputAudit', {
    count: result.items.length,
    accountIds: [lineAccountId],
    accountCounts: { [lineAccountId]: result.items.length },
  });
  const date = japanDate();
  return new Response('\uFEFF' + lines.map(row => row.map(cell).join(',')).join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="webhook-interactions-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
