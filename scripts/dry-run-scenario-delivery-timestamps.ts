#!/usr/bin/env tsx
/**
 * Scenario delivery timestamp normalization dry-run.
 * SELECT only: this script never updates staging or production data.
 *
 *   pnpm db:dry-run-scenario-delivery-timestamps staging
 *   pnpm db:dry-run-scenario-delivery-timestamps production --json
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  analyzeScenarioDeliveryTimestamps,
  type ScenarioDeliveryTimestampRow,
} from '../packages/db/src/scenario-delivery-timestamps';
import { databaseNameOf, extractJson } from './deploy/migrate';
import { ENV_POLICY } from './deploy/preflight';
import { isDeployEnv } from './deploy/deploy-lock';

const READ_ONLY_QUERY = `
  SELECT id, next_delivery_at
  FROM friend_scenarios
  WHERE next_delivery_at IS NOT NULL
  ORDER BY id
`;

function loadRows(environment: 'staging' | 'production'): ScenarioDeliveryTimestampRow[] {
  const config = ENV_POLICY[environment].config;
  const database = databaseNameOf(readFileSync(config, 'utf8'));
  const raw = execFileSync(
    './node_modules/.bin/wrangler',
    ['d1', 'execute', database, '--remote', '--config', config, '--command', READ_ONLY_QUERY, '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = extractJson(raw) as Array<{ results?: ScenarioDeliveryTimestampRow[] }>;
  return parsed[0]?.results ?? [];
}

function main(): void {
  const [environment, ...options] = process.argv.slice(2);
  if (!environment || !isDeployEnv(environment)) {
    console.error('使い方: dry-run-scenario-delivery-timestamps.ts <staging|production> [--json]');
    process.exit(1);
  }

  const report = analyzeScenarioDeliveryTimestamps(loadRows(environment));
  if (options.includes('--json')) {
    console.log(JSON.stringify({ environment, ...report }, null, 2));
  } else {
    console.log(`対象: ${environment}`);
    console.log(`合計: ${report.total}件`);
    console.log(`  変換不要: ${report.canonical}件`);
    console.log(`  自動変換: ${report.normalizable}件`);
    console.log(`  要確認: ${report.invalid}件`);
    for (const row of report.invalidSamples) {
      console.log(`  - ${row.id}: ${row.next_delivery_at}`);
    }
  }

  if (report.invalid > 0) process.exitCode = 2;
}

if (process.argv[1]?.endsWith('dry-run-scenario-delivery-timestamps.ts')) main();
