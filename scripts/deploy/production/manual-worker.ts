#!/usr/bin/env tsx
/** Worker-only production release when GitHub Actions is unavailable.
 * Run the reviewed gate from its branch against a clean, current main checkout.
 * This never applies D1 migrations.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unstable_readConfig } from 'wrangler';
import { assertNoPending } from './database.js';
import { assertHeaderRules, prepareWorker, verifyHeaders, workerArtifactPath } from './artifacts.js';
import { publishWorker } from './publish.js';
import { assertSha, command } from './common.js';
const releaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

type Active = { deploymentId: string; versionId: string };

export function activeDeployment(value: unknown): Active {
  const deployment = value as { id?: unknown; versions?: Array<{ version_id?: unknown; percentage?: unknown }> };
  const version = deployment?.versions?.[0];
  if (typeof deployment?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(deployment.id) ||
      deployment.versions?.length !== 1 || typeof version?.version_id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(version.version_id) || version.percentage !== 100) {
    throw new Error('active_version_unknown');
  }
  return { deploymentId: deployment.id, versionId: version.version_id };
}

export function assertManualArgs(args: string[]): { apply: boolean; approvalRef: string; parent: string; recordDir: string; targetCheckout: string; stagingVersion: string; stagingDeployment: string; stagingProofFile: string } {
  const apply = args.includes('--apply');
  const allowed = ['--apply', '--dry-run', '--approval-ref', '--parent-repo', '--record-dir', '--target-checkout', '--staging-version', '--staging-deployment', '--staging-proof-file'];
  if (args.some(arg => arg.startsWith('--') && !allowed.includes(arg))) throw new Error('unknown_argument');
  if (apply && args.includes('--dry-run')) throw new Error('conflicting_mode');
  const flag = (name: string): string => {
    const index = args.indexOf(name);
    return index < 0 ? '' : args[index + 1] ?? '';
  };
  const approvalRef = flag('--approval-ref');
  const parent = flag('--parent-repo') || process.env.LINE_HARNESS_PARENT_REPO || '';
  const recordDir = flag('--record-dir');
  const targetCheckout = flag('--target-checkout') || process.cwd();
  const stagingVersion = flag('--staging-version');
  const stagingDeployment = flag('--staging-deployment');
  const stagingProofFile = flag('--staging-proof-file');
  if (apply && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:#.*)?$/.test(approvalRef)) throw new Error('approval_record');
  if (!isAbsolute(parent) || !isAbsolute(recordDir) || !isAbsolute(targetCheckout) || resolve(recordDir).startsWith(`${resolve(targetCheckout)}${sep}`)) throw new Error('paths');
  if (![stagingVersion, stagingDeployment].every(value => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value))) throw new Error('staging_proof_ids');
  if (stagingProofFile && !isAbsolute(stagingProofFile)) throw new Error('staging_proof_path');
  return { apply, approvalRef, parent, recordDir, targetCheckout, stagingVersion, stagingDeployment, stagingProofFile };
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

function wranglerJson(args: string[]): any {
  return JSON.parse(command('pnpm', ['exec', 'wrangler', ...args, '--json']));
}

async function currentActive(name: string): Promise<Active> {
  return activeDeployment(wranglerJson(['deployments', 'status', '--name', name]));
}

function sourcePreflight(parent: string): string {
  const sha = command('git', ['rev-parse', 'HEAD']).trim();
  assertSha(sha);
  if (command('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim() !== 'main') throw new Error('main_only');
  if (command('git', ['status', '--porcelain', '--untracked-files=all']).trim() ||
      command('git', ['-C', parent, 'status', '--porcelain', '--untracked-files=all']).trim()) throw new Error('dirty_checkout');
  command('git', ['fetch', 'origin']);
  if (command('git', ['rev-parse', 'origin/main']).trim() !== sha) throw new Error('main_remote_changed');
  return sha;
}

function preflight(parent: string, approvalRef: string): string {
  const sha = sourcePreflight(parent);
  command('pnpm', ['deploy:preflight', 'production', '--parent-repo', parent, '--approved-by', 'skmtmst', '--approval-ref', approvalRef]);
  return sha;
}

export function versionCommit(value: unknown): string {
  const data = value as { resources?: { bindings?: Array<{ name?: unknown; type?: unknown; text?: unknown }> } };
  const matches = data?.resources?.bindings?.filter(binding => binding.name === 'BUILD_GIT_COMMIT' && binding.type === 'plain_text') ?? [];
  if (matches.length !== 1 || typeof matches[0].text !== 'string') throw new Error('version_commit_missing');
  assertSha(matches[0].text);
  return matches[0].text;
}

export function assertStagingDeployment(value: unknown, versionId: string): void {
  const data = value as { versions?: Array<{ version_id?: unknown; percentage?: unknown }> };
  if (data?.versions?.length !== 1 || data.versions[0]?.version_id !== versionId || data.versions[0]?.percentage !== 100) throw new Error('staging_deployment_mismatch');
}

export function assertSavedStagingProof(value: unknown, sha: string, versionId: string, deploymentId: string): void {
  const proof = value as Record<string, unknown>;
  if (proof?.candidate_sha !== sha || proof.candidate_version_id !== versionId ||
      proof.candidate_deployment_id !== deploymentId || proof.candidate_health_status !== 'ok' ||
      proof.db_migrations_applied !== 0 || typeof proof.recorded_at !== 'string' ||
      Number.isNaN(Date.parse(proof.recorded_at))) throw new Error('staging_saved_proof_mismatch');
}

async function stagingProof(sha: string, versionId: string, deploymentId: string, proofFile: string): Promise<void> {
  const name = 'nen-line-stg';
  const version = wranglerJson(['versions', 'view', versionId, '--name', name]);
  if (version?.id !== versionId || versionCommit(version) !== sha) throw new Error('staging_version_sha');
  const deployments = wranglerJson(['deployments', 'list', '--name', name]);
  const deployment = Array.isArray(deployments) ? deployments.find(value => value.id === deploymentId) : null;
  if (deployment?.id === deploymentId) { assertStagingDeployment(deployment, versionId); return; }
  if (!proofFile) throw new Error('staging_deployment_not_recent');
  const path = realpathSync(proofFile), stats = statSync(path);
  if (!stats.isFile() || (stats.mode & 0o077) !== 0) throw new Error('staging_proof_file_unsafe');
  assertSavedStagingProof(JSON.parse(readFileSync(path, 'utf8')), sha, versionId, deploymentId);
}

export function backupBookmark(value: unknown): string {
  const data = value as { bookmark?: unknown; result?: { bookmark?: unknown } };
  const bookmark = data?.bookmark ?? data?.result?.bookmark;
  if (typeof bookmark !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/i.test(bookmark)) throw new Error('backup_bookmark');
  return bookmark;
}

async function publicHealth(): Promise<void> {
  const response = await fetch('https://api.musubo.jp/api/health', { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('production_health');
  const body = await response.json() as { success?: boolean; data?: { status?: string } };
  if (body.success !== true || body.data?.status !== 'ok') throw new Error('production_health');
}

export async function verifyHotfixResponses(fetcher: typeof fetch = fetch): Promise<void> {
  const checks = [
    { url: 'https://api.musubo.jp/', status: 200, type: 'text/html' },
    { url: 'https://api.musubo.jp/api/accounts', status: 401, type: 'application/json' },
  ];
  for (const check of checks) {
    const response = await fetcher(check.url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.status !== check.status || !response.headers.get('content-type')?.includes(check.type)) throw new Error('production_response');
    await response.body?.cancel();
  }
}

function ensureWorkerHeaders(): void {
  if (existsSync('apps/worker/public/_headers')) { verifyHeaders('worker'); return; }
  const source = `${releaseRoot}/apps/worker/public/_headers`;
  const built = 'apps/worker/dist/client/_headers';
  copyFileSync(source, built);
  assertHeaderRules(readFileSync(source, 'utf8'), readFileSync(built, 'utf8'), 'worker');
}

function productionIdentity(): string {
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  const whoami = wranglerJson(['whoami']);
  const database = wranglerJson(['d1', 'info', 'nen-line']);
  if (source.name !== 'nen-line' || source.vars?.DEPLOY_ENV !== 'production' ||
      !source.routes?.some((route: { pattern?: string; custom_domain?: boolean }) => route.pattern === 'api.musubo.jp' && route.custom_domain === true) ||
      source.d1_databases?.length !== 1 || source.d1_databases[0].database_name !== 'nen-line' ||
      database?.uuid !== source.d1_databases[0].database_id ||
      !whoami?.accounts?.some((account: { id?: string }) => account.id === source.account_id)) throw new Error('production_identity');
  process.env.SECURITY_WORKER_NAME = source.name;
  process.env.CLOUDFLARE_ACCOUNT_ID = source.account_id;
  process.env.D1_DATABASE_NAME = source.d1_databases[0].database_name;
  process.env.D1_DATABASE_ID = source.d1_databases[0].database_id;
  return source.name;
}

async function run(args: string[]): Promise<void> {
  const options = assertManualArgs(args);
  process.chdir(realpathSync(options.targetCheckout));
  const sha = options.apply ? preflight(options.parent, options.approvalRef) : sourcePreflight(options.parent);
  const name = productionIdentity();
  await stagingProof(sha, options.stagingVersion, options.stagingDeployment, options.stagingProofFile);
  process.env.APPROVED_MIGRATIONS = '[]';
  assertNoPending();
  command('pnpm', ['--filter', 'worker', 'build']);
  prepareWorker(sha);
  ensureWorkerHeaders();
  const artifact = workerArtifactPath(name);
  command('pnpm', ['exec', 'wrangler', 'deploy', '--config', artifact, '--dry-run']);
  if (!options.apply) {
    console.log(`manual_worker_dry_run: PASS ${sha}`);
    return;
  }

  if (process.env.OPERATIONS_PAUSED !== 'true') throw new Error('operations_pause_confirmation');
  const recordDir = assertRecordDirectory(options.recordDir, process.cwd(), options.parent);
  if (command('git', ['status', '--porcelain', '--untracked-files=all']).trim()) throw new Error('dirty_checkout');
  const before = await currentActive(name);
  const backup = { type: 'd1-time-travel', bookmark: backupBookmark(wranglerJson(['d1', 'time-travel', 'info', 'nen-line'])), capturedAt: new Date().toISOString(), retentionDays: 30 };
  const receipt = `${recordDir}/worker-${sha}.json`;
  writeFileSync(receipt, JSON.stringify({ sha, before, backup, phase: 'backed_up', recordedAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });

  if (preflight(options.parent, options.approvalRef) !== sha) throw new Error('source_changed');
  await stagingProof(sha, options.stagingVersion, options.stagingDeployment, options.stagingProofFile);
  assertNoPending();
  const latest = await currentActive(name);
  if (latest.versionId !== before.versionId || latest.deploymentId !== before.deploymentId) throw new Error('concurrent_production_deploy');
  publishWorker(sha);
  // On failure, retain the lock and receipt for diagnosis and deliberate rollback.
  writeFileSync(receipt, JSON.stringify({ sha, before, backup, phase: 'deployed_pending_verification', recordedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  for (let attempt = 0; ; attempt++) {
    try { await publicHealth(); break; }
    catch (error) {
      if (attempt >= 14) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  await verifyHotfixResponses();
  const after = await currentActive(name);
  if (after.versionId === before.versionId) throw new Error('deployment_version_unchanged');
  const deployed = wranglerJson(['versions', 'view', after.versionId, '--name', name]);
  if (deployed?.id !== after.versionId || versionCommit(deployed) !== sha) throw new Error('production_version_sha');
  writeFileSync(receipt, JSON.stringify({ sha, before, after, backup, phase: 'verified', recordedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(`manual_worker_release: PASS ${sha} version=${after.versionId} receipt=${receipt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).catch(() => {
    // Never print provider response bodies, paths, or credentials.
    console.error('manual_worker_release: FAIL; inspect the local receipt and keep any acquired production lock');
    process.exitCode = 1;
  });
}
