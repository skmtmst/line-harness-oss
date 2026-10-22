import { jstDate as japanDate } from '@line-crm/shared';
import { logger } from '@line-crm/shared/server';
/**
 * #838 第1段: 定期CSV書き出しの実行役。
 *
 * sixHourly のスケジューラから呼ばれ、その日(JST)分がまだ無い
 * アカウントへ友だちCSVの書き出し履歴を1件作る。実体は既存の
 * `friend_export_jobs`（292）と同じ形で、ダウンロード時に最新の
 * 友だち一覧からCSVを組み立てる `/api/friends/exports/:id/download`
 * がそのまま使える。新しい表や配信経路は増やさない。
 *
 * 定期実行分は `created_by='system'`・`created_by_name='定期実行'`
 * で画面の履歴（/friends/migrations の書き出し・取り込み履歴）に
 * 手動分と区別して出る。
 */
import { getLineAccounts } from '@line-crm/db';
import type { Env } from '../worker-env.js';

function jstDate(iso: string): string {
  return japanDate(new Date(iso));
}

const EXPORT_TTL_MS = 7 * 86_400_000;

export async function processDueScheduledExports(
  env: Env['Bindings'],
  input: { now: string },
): Promise<{ generated: number; skipped: number; failed: number }> {
  const today = jstDate(input.now);
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const accounts = await getLineAccounts(env.DB);
  for (const account of accounts) {
    if (!account.is_active) continue;
    try {
      // 保存はUTC、日次の区切りはJST。旧UUIDの履歴も同じ暦日で見つける。
      const existing = await env.DB.prepare(
        `SELECT id FROM friend_export_jobs
          WHERE line_account_id = ? AND created_by = 'system'
            AND date(created_at, '+9 hours') = ?`,
      ).bind(account.id, today).first<{ id: string }>();
      if (existing) {
        skipped += 1;
        continue;
      }
      const count = await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM friends WHERE line_account_id = ?',
      ).bind(account.id).first<{ count: number }>();
      const expiresAt = new Date(Date.parse(input.now) + EXPORT_TTL_MS).toISOString();
      const inserted = await env.DB.prepare(
        `INSERT INTO friend_export_jobs
          (id, line_account_id, filter_json, columns_json, encoding, status, row_count,
           created_by, created_by_name, created_at, expires_at)
         SELECT ?, ?, ?, '["basic"]', 'utf-8', 'completed', ?, 'system', '定期実行', ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM friend_export_jobs
            WHERE line_account_id = ? AND created_by = 'system' AND date(created_at, '+9 hours') = ?)
          ON CONFLICT(id) DO NOTHING`,
      ).bind(
        `scheduled-friend-export:${account.id}:${today}`, account.id, JSON.stringify({ accountId: account.id, trigger: 'daily' }),
        count?.count ?? 0, input.now, expiresAt, account.id, today,
      ).run();
      if (inserted.meta.changes === 1) generated += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      logger.error("scheduled_export_failed");
    }
  }
  return { generated, skipped, failed };
}
