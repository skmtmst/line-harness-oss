import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unstable_readConfig } from 'wrangler';
import { command, requireValue } from './common.js';
// @ts-expect-error Existing SELECT-only CLI
import { readPending } from '../d1-pending-readonly.mjs';

export type Migration = { name: string; sha256: string };
export type Plan = { pending: Migration[]; ledgerExists: boolean };
export const digest = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
export function assertApproved(actual: Migration[], approved: unknown): void {
  if (!Array.isArray(approved) || approved.some(item => !item || !/^\d{3,}_[A-Za-z0-9_-]+\.sql$/.test(item.name) || !/^[0-9a-f]{64}$/.test(item.sha256)) || JSON.stringify(actual) !== JSON.stringify(approved.map(item => ({ name: item.name, sha256: item.sha256 })))) throw new Error('migration_approval_mismatch');
}
export function databaseName(): string {
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  const name = requireValue(process.env.D1_DATABASE_NAME);
  if (source.d1_databases?.length !== 1 || source.d1_databases[0].database_name !== name || source.d1_databases[0].database_id !== requireValue(process.env.D1_DATABASE_ID) || source.account_id !== requireValue(process.env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('database_identity');
  return name;
}
export function currentPlan(database: string, dir = 'packages/db/migrations'): Plan {
  const status = readPending(database, dir);
  const pending = status.pending.map((name: string) => ({ name, sha256: digest(readFileSync(join(dir, name))) }));
  assertApproved(pending, JSON.parse(requireValue(process.env.APPROVED_MIGRATIONS)));
  return { pending, ledgerExists: status.ledgerExists };
}
export function planPath(): string { return join(requireValue(process.env.RUNNER_TEMP), 'production-d1-plan.json'); }
export function receiptPath(): string { return join(requireValue(process.env.RUNNER_TEMP), 'production-backup-receipt.json'); }
export function readPlan(): Plan { return JSON.parse(readFileSync(planPath(), 'utf8')); }
export function planDatabase(): number {
  const plan = currentPlan(databaseName());
  writeFileSync(planPath(), JSON.stringify(plan), { mode: 0o600 });
  return plan.pending.length;
}
export function assertUnchanged(before: Plan, current: Plan): void {
  if (JSON.stringify(before) !== JSON.stringify(current)) throw new Error('pending_changed');
}
export function applyDatabase(sha: string): void {
  const database = databaseName(), plan = readPlan();
  assertUnchanged(plan, currentPlan(database));
  const receipt = JSON.parse(readFileSync(receiptPath(), 'utf8'));
  if (receipt.sha !== sha || receipt.planDigest !== digest(JSON.stringify(plan)) || receipt.verified !== true) throw new Error('backup_not_verified');
  const pendingFile = join(requireValue(process.env.RUNNER_TEMP), 'd1-pending-migrations.txt');
  writeFileSync(pendingFile, plan.pending.map(item => `packages/db/migrations/${item.name}\n`).join(''), { mode: 0o600 });
  if (plan.pending.length) {
    // The first write happens only after the verified encrypted backup.
    command('npx', ['wrangler', 'd1', 'execute', database, '--remote', '--command', 'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)']);
    command('bash', ['scripts/deploy/apply-d1-migrations.sh', database, pendingFile]);
  }
  // Approval was for the previous pending list; the remaining count must be zero.
  const remaining = readPending(database);
  if (remaining.count !== 0) throw new Error('migrations_remaining');
}
export function assertNoPending(): void {
  if (readPending(databaseName()).count !== 0) throw new Error('migrations_remaining');
}
