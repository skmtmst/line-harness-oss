#!/usr/bin/env tsx
/**
 * 紹介者のアカウント帰属を移行前に確認する読み取り専用dry-run。
 *
 *   pnpm db:dry-run-affiliate-account-scope staging
 *   pnpm db:dry-run-affiliate-account-scope production --json
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { databaseNameOf, extractJson } from './deploy/migrate';
import { ENV_POLICY } from './deploy/preflight';
import { isDeployEnv } from './deploy/deploy-lock';

export type AffiliateAccountScopeDryRunRow = {
  affiliate_id: string;
  candidate_account_count: number;
  candidate_account_ids: string | null;
};

export const AFFILIATE_ACCOUNT_SCOPE_DRY_RUN_QUERY = `
  WITH candidates AS (
    SELECT a.id AS affiliate_id, f.line_account_id
      FROM affiliates a
      JOIN friends f ON f.id = a.friend_id
     WHERE f.line_account_id IS NOT NULL
    UNION
    SELECT al.affiliate_id, al.line_account_id
      FROM affiliate_links al
     WHERE al.line_account_id IS NOT NULL
    UNION
    SELECT al.affiliate_id, off.line_account_id
      FROM affiliate_links al
      JOIN affiliate_offers off ON off.id = al.offer_id
     WHERE off.line_account_id IS NOT NULL
    UNION
    SELECT ce.affiliate_id, f.line_account_id
      FROM conversion_events ce
      JOIN friends f ON f.id = ce.friend_id
     WHERE ce.affiliate_id IS NOT NULL
       AND f.line_account_id IS NOT NULL
  )
  SELECT a.id AS affiliate_id,
         COUNT(DISTINCT c.line_account_id) AS candidate_account_count,
         GROUP_CONCAT(DISTINCT c.line_account_id) AS candidate_account_ids
    FROM affiliates a
    LEFT JOIN candidates c ON c.affiliate_id = a.id
   GROUP BY a.id
   ORDER BY candidate_account_count DESC, a.id
`;

export function summarizeAffiliateAccountScope(rows: AffiliateAccountScopeDryRunRow[]) {
  return {
    total: rows.length,
    assignable: rows.filter((row) => row.candidate_account_count === 1).length,
    unassigned: rows.filter((row) => row.candidate_account_count === 0).length,
    conflicting: rows.filter((row) => row.candidate_account_count > 1).length,
    needsReview: rows.filter((row) => row.candidate_account_count !== 1),
  };
}

function loadRows(environment: 'staging' | 'production'): AffiliateAccountScopeDryRunRow[] {
  const config = ENV_POLICY[environment].config;
  const database = databaseNameOf(readFileSync(config, 'utf8'));
  const raw = execFileSync(
    './node_modules/.bin/wrangler',
    ['d1', 'execute', database, '--remote', '--config', config, '--command', AFFILIATE_ACCOUNT_SCOPE_DRY_RUN_QUERY, '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = extractJson(raw) as Array<{ results?: AffiliateAccountScopeDryRunRow[] }>;
  return parsed[0]?.results ?? [];
}

function main(): void {
  const [environment, ...options] = process.argv.slice(2);
  if (!environment || !isDeployEnv(environment)) {
    console.error('使い方: dry-run-affiliate-account-scope.ts <staging|production> [--json]');
    process.exit(1);
  }

  const report = summarizeAffiliateAccountScope(loadRows(environment));
  if (options.includes('--json')) {
    console.log(JSON.stringify({ environment, ...report }, null, 2));
  } else {
    console.log(`対象: ${environment}`);
    console.log(`紹介者: ${report.total}件`);
    console.log(`  自動補完できる: ${report.assignable}件`);
    console.log(`  所属候補なし: ${report.unassigned}件`);
    console.log(`  候補が複数: ${report.conflicting}件`);
    for (const row of report.needsReview) {
      console.log(`  - ${row.affiliate_id}: ${row.candidate_account_ids ?? '候補なし'}`);
    }
  }

  if (report.needsReview.length > 0) process.exitCode = 2;
}

if (process.argv[1]?.endsWith('dry-run-affiliate-account-scope.ts')) main();
