#!/usr/bin/env tsx
/**
 * V6オートメーション移行dry-run。
 *
 * SELECTだけを実行し、結果を標準出力へ出す。新旧どちらのDBにも書き込まない。
 *
 *   pnpm tsx scripts/dry-run-v6-automations.ts staging
 *   pnpm tsx scripts/dry-run-v6-automations.ts production --json
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  analyzeLegacyAutomations,
  type LegacyAutomationMigrationRow,
} from '../packages/db/src/automation-migration';
import { databaseNameOf, extractJson } from './deploy/migrate';
import { ENV_POLICY } from './deploy/preflight';
import { isDeployEnv } from './deploy/deploy-lock';

const READ_ONLY_QUERY = `
  SELECT id, name, line_account_id, event_type, conditions, actions, is_active, priority
  FROM automations
  ORDER BY id
`;

function loadRows(environment: 'staging' | 'production'): LegacyAutomationMigrationRow[] {
  const config = ENV_POLICY[environment].config;
  const database = databaseNameOf(readFileSync(config, 'utf8'));
  const raw = execFileSync(
    './node_modules/.bin/wrangler',
    ['d1', 'execute', database, '--remote', '--config', config, '--command', READ_ONLY_QUERY, '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = extractJson(raw) as Array<{ results?: LegacyAutomationMigrationRow[] }>;
  return parsed[0]?.results ?? [];
}

function main(): void {
  const [environment, ...options] = process.argv.slice(2);
  if (!environment || !isDeployEnv(environment)) {
    console.error('使い方: dry-run-v6-automations.ts <staging|production> [--json]');
    process.exit(1);
  }

  const report = analyzeLegacyAutomations(loadRows(environment));
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
    console.log(`\n[${item.decision}] ${item.id} ${item.name}`);
    for (const reason of item.reasons) console.log(`  - ${reason}`);
  }
}

if (process.argv[1]?.endsWith('dry-run-v6-automations.ts')) main();
