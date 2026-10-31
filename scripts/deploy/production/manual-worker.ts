#!/usr/bin/env tsx
/** Worker-only production release when GitHub Actions is unavailable.
 * Run from a clean, current main checkout. This never applies D1 migrations.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unstable_readConfig } from 'wrangler';
import { assertNoPending, planDatabase } from './database.js';
import { backupDatabase } from './backup.js';
import { prepareWorker, verifyHeaders, workerArtifactPath } from './artifacts.js';
import { publishWorker } from './publish.js';
import { verifyResponses } from './responses.js';
import { assertSha, cloudflare, command, requireValue } from './common.js';
// @ts-expect-error Existing read-only public SHA verifier
import { verifyPublicBuild } from '../verify-public-build.mjs';

type Active = { deploymentId: string; versionId: string };

export function activeDeployment(value: unknown): Active {
  const data = value as { deployments?: Array<{ id?: unknown; versions?: Array<{ version_id?: unknown; percentage?: unknown }> }> };
  const deployment = data?.deployments?.[0];
  const version = deployment?.versions?.[0];
  if (typeof deployment?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(deployment.id) ||
      deployment.versions?.length !== 1 || typeof version?.version_id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(version.version_id) || version.percentage !== 100) {
    throw new Error('active_version_unknown');
  }
  return { deploymentId: deployment.id, versionId: version.version_id };
}

export function assertManualArgs(args: string[]): { apply: boolean; approvalRef: string; parent: string; recordDir: string } {
  const apply = args.includes('--apply');
  const allowed = ['--apply', '--dry-run', '--approval-ref', '--parent-repo', '--record-dir'];
  if (args.some(arg => arg.startsWith('--') && !allowed.includes(arg))) throw new Error('unknown_argument');
  if (apply && args.includes('--dry-run')) throw new Error('conflicting_mode');
  const flag = (name: string): string => {
    const index = args.indexOf(name);
    return index < 0 ? '' : args[index + 1] ?? '';
  };
  const approvalRef = flag('--approval-ref');
  const parent = flag('--parent-repo') || process.env.LINE_HARNESS_PARENT_REPO || '';
  const recordDir = flag('--record-dir');
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:#.*)?$/.test(approvalRef)) throw new Error('approval_record');
  if (!isAbsolute(parent) || !isAbsolute(recordDir) || resolve(recordDir).startsWith(`${resolve(process.cwd())}${sep}`)) throw new Error('paths');
  return { apply, approvalRef, parent, recordDir };
}

export function assertRecordDirectory(path: string, checkout = process.cwd(), parent?: string): string {
  if (!existsSync(path)) throw new Error('record_directory_missing');
  const real = realpathSync(path), root = realpathSync(checkout);
  const parentRoot = parent ? realpathSync(parent) : null;
  if (real === root || real.startsWith(`${root}${sep}`) ||
      (parentRoot && (real === parentRoot || real.startsWith(`${parentRoot}${sep}`))) ||
      !statSync(real).isDirectory() || readdirSync(real).length > 0 ||
      (statSync(real).mode & 0o077) !== 0) throw new Error('record_directory_unsafe');
  return real;
}

async function currentActive(name: string): Promise<Active> {
  return activeDeployment(await cloudflare(`workers/scripts/${encodeURIComponent(name)}/deployments`));
}

function preflight(parent: string, approvalRef: string): string {
  const sha = command('git', ['rev-parse', 'HEAD']).trim();
  assertSha(sha);
  if (command('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== 'main') throw new Error('main_only');
  command('pnpm', ['deploy:preflight', 'production', '--parent-repo', parent, '--approved-by', 'skmtmst', '--approval-ref', approvalRef]);
  return sha;
}

async function publicStagingProof(sha: string): Promise<void> {
  await verifyPublicBuild('https://stg-api.musubo.jp', sha, '-', sha);
}

function productionIdentity(): string {
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  if (source.name !== requireValue(process.env.SECURITY_WORKER_NAME) ||
      source.account_id !== requireValue(process.env.CLOUDFLARE_ACCOUNT_ID) ||
      source.d1_databases?.length !== 1 ||
      source.d1_databases[0].database_name !== requireValue(process.env.D1_DATABASE_NAME) ||
      source.d1_databases[0].database_id !== requireValue(process.env.D1_DATABASE_ID)) throw new Error('production_identity');
  return source.name;
}

async function run(args: string[]): Promise<void> {
  const options = assertManualArgs(args);
  if (process.env.OPERATIONS_PAUSED !== 'true') throw new Error('operations_pause_confirmation');
  const sha = preflight(options.parent, options.approvalRef);
  const name = productionIdentity();
  await publicStagingProof(sha);
  process.env.APPROVED_MIGRATIONS = '[]';
  assertNoPending();
  command('pnpm', ['--filter', 'worker', 'build']);
  prepareWorker(sha);
  verifyHeaders('worker');
  const artifact = workerArtifactPath(name);
  command('pnpm', ['exec', 'wrangler', 'deploy', '--config', artifact, '--dry-run']);
  if (!options.apply) {
    console.log(`manual_worker_dry_run: PASS ${sha}`);
    return;
  }

  // The caller must choose durable, private storage outside the checkout.
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.PRODUCTION_BACKUP_KEY || !process.env.PRODUCTION_BACKUP_POLICY) throw new Error('release_credentials_or_backup_policy');
  const recordDir = assertRecordDirectory(options.recordDir, process.cwd(), options.parent);
  if (command('git', ['status', '--porcelain', '--untracked-files=all']).trim()) throw new Error('dirty_checkout');
  process.env.RUNNER_TEMP = recordDir;
  process.env.MANUAL_BACKUP_RUN_ID = String(Date.now());
  process.env.MANUAL_BACKUP_RUN_ATTEMPT = '1';
  const before = await currentActive(name);
  planDatabase(); // The approved migration set is empty; any pending SQL stops here.
  await backupDatabase(sha);
  const backup = JSON.parse(readFileSync(`${recordDir}/production-backup-receipt.json`, 'utf8'));
  const receipt = `${recordDir}/worker-${sha}.json`;
  writeFileSync(receipt, JSON.stringify({ sha, before, backup, phase: 'backed_up', recordedAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });

  if (preflight(options.parent, options.approvalRef) !== sha) throw new Error('source_changed');
  await publicStagingProof(sha);
  assertNoPending();
  const latest = await currentActive(name);
  if (latest.versionId !== before.versionId || latest.deploymentId !== before.deploymentId) throw new Error('concurrent_production_deploy');
  publishWorker(sha);
  // On failure, retain the lock and receipt for diagnosis and deliberate rollback.
  writeFileSync(receipt, JSON.stringify({ sha, before, backup, phase: 'deployed_pending_verification', recordedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  for (let attempt = 0; ; attempt++) {
    try { await verifyPublicBuild('https://api.musubo.jp', sha, '-', sha); break; }
    catch (error) {
      if (attempt >= 14) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  await verifyResponses('worker');
  const after = await currentActive(name);
  if (after.versionId === before.versionId) throw new Error('deployment_version_unchanged');
  writeFileSync(receipt, JSON.stringify({ sha, before, after, backup, phase: 'verified', recordedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(`manual_worker_release: PASS ${sha} version=${after.versionId} receipt=${receipt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch(() => {
    // Never print provider response bodies, paths, or credentials.
    console.error('manual_worker_release: FAIL; keep the production lock and inspect the local receipt');
    process.exitCode = 1;
  });
}
