#!/usr/bin/env tsx
/**
 * V6分析読取イベントの移行dry-run。
 * SELECTだけを実行し、既存行も新しい分析テーブルも変更しない。
 *
 *   pnpm tsx scripts/dry-run-v6-analytics.ts staging
 *   pnpm tsx scripts/dry-run-v6-analytics.ts production --json
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  analyzeLegacyAnalyticsSources,
  type LegacyAnalyticsSourceRow,
} from '../packages/db/src/analytics-migration';
import { databaseNameOf, extractJson } from './deploy/migrate';
import { ENV_POLICY } from './deploy/preflight';
import { isDeployEnv } from './deploy/deploy-lock';

const READ_ONLY_QUERY = `
  SELECT * FROM (
    SELECT 'friend_add_events' AS source_kind, e.id AS source_id,
           e.line_account_id, 'direct' AS account_resolution,
           e.friend_id, 'friend_add' AS event_type, e.occurred_at
      FROM friend_add_events e
    UNION ALL
    SELECT 'messages_log', m.id, COALESCE(m.line_account_id, f.line_account_id),
           CASE WHEN m.line_account_id IS NOT NULL THEN 'direct'
                WHEN f.line_account_id IS NOT NULL THEN 'friend_current' ELSE 'missing' END,
           m.friend_id,
           CASE WHEN m.direction = 'incoming' THEN 'message_received' ELSE 'message_sent' END,
           m.created_at
      FROM messages_log m LEFT JOIN friends f ON f.id = m.friend_id
    UNION ALL
    SELECT 'link_clicks', c.id, l.line_account_id,
           CASE WHEN l.line_account_id IS NULL THEN 'missing' ELSE 'direct' END,
           c.friend_id, 'url_clicked', c.clicked_at
      FROM link_clicks c JOIN tracked_links l ON l.id = c.tracked_link_id
    UNION ALL
    SELECT 'form_submissions', s.id, f.line_account_id,
           CASE WHEN f.line_account_id IS NULL THEN 'missing' ELSE 'friend_current' END,
           s.friend_id, 'form_submitted', s.created_at
      FROM form_submissions s LEFT JOIN friends f ON f.id = s.friend_id
    UNION ALL
    SELECT 'conversion_events', c.id, f.line_account_id,
           CASE WHEN f.line_account_id IS NULL THEN 'missing' ELSE 'friend_current' END,
           c.friend_id, 'conversion_created', c.created_at
      FROM conversion_events c LEFT JOIN friends f ON f.id = c.friend_id
    UNION ALL
    SELECT 'site_events', s.id, f.line_account_id,
           CASE WHEN f.line_account_id IS NULL THEN 'missing' ELSE 'friend_current' END,
           s.friend_id, 'site_event', s.occurred_at
      FROM site_events s LEFT JOIN friends f ON f.id = s.friend_id
  ) ORDER BY source_kind, source_id
`;

function loadRows(environment: 'staging' | 'production'): LegacyAnalyticsSourceRow[] {
  const config = ENV_POLICY[environment].config;
  const database = databaseNameOf(readFileSync(config, 'utf8'));
  const raw = execFileSync(
    './node_modules/.bin/wrangler',
    ['d1', 'execute', database, '--remote', '--config', config, '--command', READ_ONLY_QUERY, '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = extractJson(raw) as Array<{ results?: LegacyAnalyticsSourceRow[] }>;
  return parsed[0]?.results ?? [];
}

function main(): void {
  const [environment, ...options] = process.argv.slice(2);
  if (!environment || !isDeployEnv(environment)) {
    console.error('使い方: dry-run-v6-analytics.ts <staging|production> [--json]');
    process.exit(1);
  }
  const report = analyzeLegacyAnalyticsSources(loadRows(environment));
  if (options.includes('--json')) {
    console.log(JSON.stringify({ environment, ...report }, null, 2));
    return;
  }
  console.log(`対象: ${environment}`);
  console.log(`合計: ${report.total}件`);
  console.log(`  自動変換: ${report.autoConvert}件`);
  console.log(`  要確認: ${report.needsReview}件`);
  console.log(`  除外: ${report.excluded}件`);
  console.log(`  重複候補: ${report.duplicateKeys}件`);
  for (const item of report.assessments.filter((entry) => entry.decision !== 'auto_convert').slice(0, 100)) {
    console.log(`\n[${item.decision}] ${item.sourceKind}:${item.sourceId}`);
    for (const reason of item.reasons) console.log(`  - ${reason}`);
  }
  if (report.needsReview + report.excluded > 100) {
    console.log('\n先頭100件だけ表示しました。全件は --json で確認してください。');
  }
}

if (process.argv[1]?.endsWith('dry-run-v6-analytics.ts')) main();
