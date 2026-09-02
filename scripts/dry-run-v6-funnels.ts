#!/usr/bin/env tsx
/** 現行ファネル定義を変更せず、V6へ自動変換できるかだけを調べる。 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  analyzeLegacyFunnelDefinitions,
  type LegacyFunnelDefinitionRow,
} from '../packages/db/src/analytics-funnel-migration';
import { databaseNameOf, extractJson } from './deploy/migrate';
import { ENV_POLICY } from './deploy/preflight';
import { isDeployEnv } from './deploy/deploy-lock';

const READ_ONLY_QUERY = `
  SELECT f.id AS funnel_id, f.line_account_id, f.segment_json, f.window_days,
         s.id AS step_id, s.step_order, s.label, s.kind, s.match_json,
         CASE
           WHEN s.id IS NULL THEN NULL
           WHEN s.kind = 'tag' THEN EXISTS(
             SELECT 1 FROM tags t
              WHERE t.id = json_extract(s.match_json, '$.tagId')
                AND t.line_account_id = f.line_account_id
           )
           WHEN s.kind = 'field' THEN EXISTS(
             SELECT 1 FROM friend_fields ff WHERE ff.id = json_extract(s.match_json, '$.fieldId')
           )
           WHEN s.kind = 'form' THEN EXISTS(
             SELECT 1 FROM forms fm WHERE fm.id = json_extract(s.match_json, '$.formId')
           )
           WHEN s.kind = 'link_click' THEN EXISTS(
             SELECT 1 FROM tracked_links tl
              WHERE tl.id = json_extract(s.match_json, '$.trackedLinkId')
                AND tl.line_account_id = f.line_account_id
           )
           WHEN s.kind = 'conversion' THEN EXISTS(
             SELECT 1 FROM conversion_points cp
              WHERE cp.id = json_extract(s.match_json, '$.conversionPointId')
                AND cp.line_account_id = f.line_account_id
           )
           ELSE 1
         END AS reference_exists
    FROM funnels f
    LEFT JOIN funnel_steps s ON s.funnel_id = f.id
   ORDER BY f.id, s.step_order, s.id
`;

function loadRows(environment: 'staging' | 'production'): LegacyFunnelDefinitionRow[] {
  const config = ENV_POLICY[environment].config;
  const database = databaseNameOf(readFileSync(config, 'utf8'));
  const raw = execFileSync(
    './node_modules/.bin/wrangler',
    ['d1', 'execute', database, '--remote', '--config', config, '--command', READ_ONLY_QUERY, '--json'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const parsed = extractJson(raw) as Array<{ results?: LegacyFunnelDefinitionRow[] }>;
  return parsed[0]?.results ?? [];
}

function main(): void {
  const [environment, ...options] = process.argv.slice(2);
  if (!environment || !isDeployEnv(environment)) {
    console.error('使い方: dry-run-v6-funnels.ts <staging|production> [--json]');
    process.exit(1);
  }
  const report = analyzeLegacyFunnelDefinitions(loadRows(environment));
  if (options.includes('--json')) {
    console.log(JSON.stringify({ environment, ...report }, null, 2));
    return;
  }
  console.log(`対象: ${environment}`);
  console.log(`合計: ${report.total}件`);
  console.log(`  自動変換: ${report.autoConvert}件`);
  console.log(`  要確認: ${report.needsReview}件`);
  console.log(`  除外: ${report.excluded}件`);
  for (const item of report.assessments.filter((entry) => entry.decision !== 'auto_convert')) {
    console.log(`\n[${item.decision}] ${item.funnelId}`);
    for (const reason of item.reasons) console.log(`  - ${reason}`);
  }
}

if (process.argv[1]?.endsWith('dry-run-v6-funnels.ts')) main();
