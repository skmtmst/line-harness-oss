import { accountFeatureOffExclusionSql } from './account-settings.js';

/**
 * v6-25 §15: 実行履歴の保持期間。
 * 条件外を含む明細は90日。それ以前は日別件数だけを13か月残す。
 * 「待つ」の上限も明細保持期間（90日）までなので、waiting のまま残る行は
 * 運用の取りこぼしとして消さない。消すのは確定済みだけ。
 *
 * 定期処理（6時間ごとの重い処理）から呼ぶ。D1 の 1 文 100 bind 制限に
 * 当たらないよう、古い方から 1000 件ずつ畳んで消す。
 */

export const AUTOMATION_RUN_DETAIL_RETENTION_DAYS = 90;
export const AUTOMATION_DAILY_RETENTION_MONTHS = 13;

/** 期限が来ても消さない未確定の状態。 */
const TERMINAL_RUN_STATUSES = ['success', 'partial', 'failed', 'cancelled', 'skipped_condition'];

const PURGE_BATCH_SIZE = 1000;

function monthCutoffDay(now: Date, months: number): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

export interface AutomationRetentionResult {
  runs: number;
  steps: number;
  dailyBuckets: number;
  dailyExpired: number;
}

export async function purgeExpiredAutomationRuns(
  db: D1Database,
  now: Date = new Date(),
): Promise<AutomationRetentionResult> {
  const nowIso = now.toISOString();
  const dailyCutoff = monthCutoffDay(now, AUTOMATION_DAILY_RETENTION_MONTHS);
  const offAutomations = (alias: string): string =>
    `AND NOT ${accountFeatureOffExclusionSql(`${alias}.line_account_id`, 'automations')}`;
  let runs = 0;
  let steps = 0;
  let dailyBuckets = 0;

  for (;;) {
    const targets = await db.prepare(`
      SELECT r.id, r.line_account_id, r.automation_id,
             date(r.created_at, '+9 hours') AS day, r.status,
             COALESCE(step_counts.cnt, 0) AS step_count
        FROM automation_runs r
        LEFT JOIN (
          SELECT automation_run_id, COUNT(*) AS cnt FROM automation_run_steps
           GROUP BY automation_run_id
        ) step_counts ON step_counts.automation_run_id = r.id
       WHERE datetime(r.created_at) < datetime(?, '-${AUTOMATION_RUN_DETAIL_RETENTION_DAYS} days')
         AND r.status IN (${TERMINAL_RUN_STATUSES.map(() => '?').join(',')})
         ${offAutomations('r')}
       ORDER BY r.created_at, r.id LIMIT ?
    `).bind(nowIso, ...TERMINAL_RUN_STATUSES, PURGE_BATCH_SIZE).all<{
      id: string; line_account_id: string; automation_id: string; day: string;
      status: string; step_count: number;
    }>();
    if (targets.results.length === 0) break;
    const idsJson = JSON.stringify(targets.results.map((row) => row.id));
    const eligible = `r.id IN (SELECT value FROM json_each(?))
      AND datetime(r.created_at) < datetime(?, '-${AUTOMATION_RUN_DETAIL_RETENTION_DAYS} days')
      AND r.status IN (${TERMINAL_RUN_STATUSES.map(() => '?').join(',')})
      ${offAutomations('r')}`;
    const bindings = [idsJson, nowIso, ...TERMINAL_RUN_STATUSES];
    // 集計保存・子明細・親履歴を同じトランザクションで確定する。
    // 競合した後続処理には対象が残らず、失敗時には履歴も集計も戻る。
    const results = await db.batch([
      db.prepare(`
        INSERT INTO automation_run_daily_counts
          (line_account_id, automation_id, day, status, run_count, step_count, created_at, updated_at)
        SELECT r.line_account_id, r.automation_id, date(r.created_at, '+9 hours'), r.status,
               COUNT(*), SUM((SELECT COUNT(*) FROM automation_run_steps s WHERE s.automation_run_id = r.id)),
               ?, ?
          FROM automation_runs r WHERE ${eligible}
         GROUP BY r.line_account_id, r.automation_id, date(r.created_at, '+9 hours'), r.status
        ON CONFLICT(line_account_id, automation_id, day, status) DO UPDATE SET
          run_count = automation_run_daily_counts.run_count + excluded.run_count,
          step_count = automation_run_daily_counts.step_count + excluded.step_count,
          updated_at = excluded.updated_at
      `).bind(nowIso, nowIso, ...bindings),
      db.prepare(`DELETE FROM automation_run_steps
        WHERE automation_run_id IN (SELECT r.id FROM automation_runs r WHERE ${eligible})`)
        .bind(...bindings),
      db.prepare(`DELETE FROM automation_runs
        WHERE id IN (SELECT r.id FROM automation_runs r WHERE ${eligible})`).bind(...bindings),
    ]);
    dailyBuckets += Number(results[0].meta?.changes ?? 0);
    steps += Number(results[1].meta?.changes ?? 0);
    runs += Number(results[2].meta?.changes ?? 0);
    if (targets.results.length < PURGE_BATCH_SIZE) break;
  }

  const expired = await db.prepare(`
    DELETE FROM automation_run_daily_counts WHERE day < ?
  `).bind(dailyCutoff).run();

  return {
    runs, steps, dailyBuckets,
    dailyExpired: Number(expired.meta?.changes ?? 0),
  };
}
