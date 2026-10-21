import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unstable_readConfig } from 'wrangler';
import { cloudflare, command, requireValue } from './common.js';
import { assertUnchanged, currentPlan, databaseName, digest, readPlan, receiptPath } from './database.js';

export type BackupPolicy = { bucket: string; prefix: string; retentionDays: number; approval: string };
export function assertBackupPolicy(policy: BackupPolicy, managed: any, custom: any, lifecycle: any, liveBuckets: string[]): void {
  if (!/^[a-z0-9][a-z0-9-]+[a-z0-9]$/.test(policy.bucket) || !/^[a-zA-Z0-9_-]+\/$/.test(policy.prefix) || !Number.isSafeInteger(policy.retentionDays) || policy.retentionDays <= 0 || !policy.approval?.trim() || liveBuckets.includes(policy.bucket)) throw new Error('backup_policy');
  if (managed?.enabled !== false || !Array.isArray(custom?.domains) || custom.domains.some((domain: any) => domain.enabled !== false)) throw new Error('backup_public_or_unknown');
  const rules = lifecycle?.rules;
  if (!Array.isArray(rules)) throw new Error('backup_retention_unknown');
  const applicable = rules.filter((rule: any) => rule.enabled === true && typeof rule.conditions?.prefix === 'string' && (policy.prefix.startsWith(rule.conditions.prefix) || rule.conditions.prefix.startsWith(policy.prefix)) && rule.deleteObjectsTransition);
  const coversBackupPrefix = applicable.some((rule: any) => policy.prefix.startsWith(rule.conditions.prefix));
  if (!coversBackupPrefix || applicable.some((rule: any) => rule.deleteObjectsTransition.condition?.type !== 'Age' || rule.deleteObjectsTransition.condition.maxAge !== policy.retentionDays * 86400)) throw new Error('backup_retention');
}
export function encryptBackup(plain: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('backup_key');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from('LHD1'), iv, cipher.getAuthTag(), data]);
}
export function decryptBackup(data: Buffer, key: Buffer): Buffer {
  if (data.subarray(0, 4).toString() !== 'LHD1' || data.length < 33) throw new Error('backup_format');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(4, 16));
  decipher.setAuthTag(data.subarray(16, 32));
  return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]);
}
export async function backupDatabase(sha: string): Promise<void> {
  const database = databaseName(), plan = readPlan();
  assertUnchanged(plan, currentPlan(database));
  const policy: BackupPolicy = JSON.parse(requireValue(process.env.PRODUCTION_BACKUP_POLICY));
  const keyText = requireValue(process.env.PRODUCTION_BACKUP_KEY);
  if (!/^[0-9a-f]{64}$/.test(keyText)) throw new Error('backup_key');
  const key = Buffer.from(keyText, 'hex');
  const root = `r2/buckets/${encodeURIComponent(policy.bucket)}`;
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  assertBackupPolicy(policy, await cloudflare(`${root}/domains/managed`), await cloudflare(`${root}/domains/custom`), await cloudflare(`${root}/lifecycle`), source.r2_buckets.map((bucket: { bucket_name: string }) => bucket.bucket_name));
  const run = requireValue(process.env.GITHUB_RUN_ID), attempt = requireValue(process.env.GITHUB_RUN_ATTEMPT);
  if (!/^\d+$/.test(run) || !/^\d+$/.test(attempt)) throw new Error('backup_run');
  const object = `${policy.bucket}/${policy.prefix}${sha}-${run}-${attempt}.enc`;
  const dir = mkdtempSync(join(requireValue(process.env.RUNNER_TEMP), 'production-backup-'));
  try {
    const raw = JSON.parse(command('npx', ['wrangler', 'd1', 'time-travel', 'info', database, '--json']));
    const bookmark = raw.bookmark ?? raw.result?.bookmark;
    if (typeof bookmark !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/i.test(bookmark)) throw new Error('backup_bookmark');
    const sqlPath = join(dir, 'export.sql');
    command('npx', ['wrangler', 'd1', 'export', database, '--remote', `--output=${sqlPath}`]);
    const sql = readFileSync(sqlPath, 'utf8');
    if (!sql.trim() || !/CREATE TABLE\b/i.test(sql)) throw new Error('backup_export_empty');
    const plain = Buffer.from(JSON.stringify({ sha, plan, bookmark, sql, createdAt: new Date().toISOString(), policy }));
    const encrypted = encryptBackup(plain, key), encryptedPath = join(dir, 'backup.enc'), fetchedPath = join(dir, 'verified.enc');
    writeFileSync(encryptedPath, encrypted, { mode: 0o600 });
    command('npx', ['wrangler', 'r2', 'object', 'put', object, `--file=${encryptedPath}`, '--remote']);
    command('npx', ['wrangler', 'r2', 'object', 'get', object, `--file=${fetchedPath}`, '--remote']);
    const stored = readFileSync(fetchedPath);
    if (digest(stored) !== digest(encrypted) || !decryptBackup(stored, key).equals(plain)) throw new Error('backup_round_trip');
    writeFileSync(receiptPath(), JSON.stringify({ verified: true, sha, planDigest: digest(JSON.stringify(plan)) }), { mode: 0o600 });
  } finally {
    // Only our own disposable export/encrypted copy, never repository work or provider data.
    rmSync(dir, { recursive: true, force: true });
    key.fill(0);
  }
}
