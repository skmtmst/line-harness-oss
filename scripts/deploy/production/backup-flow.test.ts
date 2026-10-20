import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_readConfig } from 'wrangler';
import * as common from './common.js';
import { backupDatabase } from './backup.js';
import { applyDatabase, digest, planDatabase, receiptPath } from './database.js';

const pending = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../d1-pending-readonly.mjs', () => ({ readPending: pending.read }));
const sha = 'a'.repeat(40), bookmark = 'a'.repeat(8) + '-' + 'b'.repeat(8) + '-' + 'c'.repeat(8) + '-' + 'd'.repeat(32);
let dir: string, calls: string[][], stored: Buffer | undefined;
let fail: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'l01-backup-test-'));
  calls = []; stored = undefined; fail = '';
  const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
  for (const [name, value] of Object.entries({ RUNNER_TEMP: dir, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', APPROVED_MIGRATIONS: '[]', D1_DATABASE_NAME: source.d1_databases[0].database_name, D1_DATABASE_ID: source.d1_databases[0].database_id, CLOUDFLARE_ACCOUNT_ID: source.account_id, PRODUCTION_BACKUP_KEY: '1'.repeat(64), PRODUCTION_BACKUP_POLICY: JSON.stringify({ bucket: 'synthetic-private-backups', prefix: 'approved/', retentionDays: 7, approval: 'synthetic-owner-approval' }) })) vi.stubEnv(name, value);
  pending.read.mockReturnValue({ count: 0, pending: [], ledgerExists: true });
  vi.spyOn(common, 'cloudflare').mockImplementation(async path => {
    if (fail === 'metadata') throw new Error('secret-provider-body');
    if (path.endsWith('/managed')) return { enabled: fail === 'public' };
    if (path.endsWith('/custom')) return { domains: [] };
    return { rules: [{ enabled: true, conditions: { prefix: 'approved/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 7 * 86400 } } }] };
  });
  vi.spyOn(common, 'command').mockImplementation((binary, args) => {
    calls.push([binary, ...args]);
    if (args.includes('time-travel')) return fail === 'bookmark' ? '{}' : JSON.stringify({ bookmark });
    if (args.includes('export')) {
      if (fail === 'export') throw new Error('secret-provider-body');
      writeFileSync(args.find(arg => arg.startsWith('--output='))!.slice(9), 'CREATE TABLE synthetic_only (id INTEGER);');
    }
    if (args.includes('put')) {
      if (fail === 'upload') throw new Error('secret-provider-body');
      stored = readFileSync(args.find(arg => arg.startsWith('--file='))!.slice(7));
    }
    if (args.includes('get')) {
      if (fail === 'download') throw new Error('secret-provider-body');
      writeFileSync(args.find(arg => arg.startsWith('--file='))!.slice(7), fail === 'corrupt' ? Buffer.from('corrupt') : stored!);
    }
    return '';
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe('production DB flow with local files and fully stubbed providers', () => {
  it('plans without writes, stores encrypted SQL plus bookmark, verifies readback, then allows apply', async () => {
    expect(planDatabase()).toBe(0);
    expect(calls).toEqual([]);
    await backupDatabase(sha);
    const receipt = JSON.parse(readFileSync(receiptPath(), 'utf8'));
    expect(receipt).toMatchObject({ sha, verified: true });
    expect(stored!.includes(Buffer.from('CREATE TABLE'))).toBe(false);
    expect(stored!.includes(Buffer.from(bookmark))).toBe(false);
    expect(calls.map(call => call.slice(1, 4).join(' '))).toEqual(['wrangler d1 time-travel', 'wrangler d1 export', 'wrangler r2 object', 'wrangler r2 object']);
    expect(readdirSync(dir)).not.toContain(expect.stringMatching(/^production-backup-/));
    expect(() => applyDatabase(sha)).not.toThrow();
    expect(calls.some(call => call.includes('execute'))).toBe(false); // Empty plan causes no DDL.
  });
  it.each(['metadata', 'public', 'bookmark', 'export', 'upload', 'download', 'corrupt'])('backup failure at %s cannot authorize apply', async point => {
    planDatabase(); fail = point;
    await expect(backupDatabase(sha)).rejects.toThrow();
    expect(() => applyDatabase(sha)).toThrow();
    expect(calls.some(call => call.includes('execute') || call.includes('scripts/deploy/apply-d1-migrations.sh'))).toBe(false);
    expect(readdirSync(dir).some(name => name.startsWith('production-backup-'))).toBe(false);
  });
  it('applies a nonempty approved plan only after durable backup, then requires zero remaining', async () => {
    const name = '001_round2.sql';
    vi.stubEnv('APPROVED_MIGRATIONS', JSON.stringify([{ name, sha256: digest(readFileSync(join('packages/db/migrations', name))) }]));
    pending.read.mockReturnValue({ count: 1, pending: [name], ledgerExists: true });
    expect(planDatabase()).toBe(1);
    await backupDatabase(sha);
    const realStub = vi.mocked(common.command).getMockImplementation()!;
    vi.mocked(common.command).mockImplementation((binary, args) => {
      const value = realStub(binary, args);
      if (binary === 'bash') pending.read.mockReturnValue({ count: 0, pending: [], ledgerExists: true });
      return value;
    });
    applyDatabase(sha);
    const get = calls.findIndex(call => call.includes('get'));
    const ddl = calls.findIndex(call => call.includes('execute'));
    const apply = calls.findIndex(call => call.includes('scripts/deploy/apply-d1-migrations.sh'));
    expect(get).toBeGreaterThan(-1); expect(ddl).toBeGreaterThan(get); expect(apply).toBeGreaterThan(ddl);
    expect(readFileSync(join(dir, 'd1-pending-migrations.txt'), 'utf8')).toBe(`packages/db/migrations/${name}\n`);
  });
  it('changed pending state, unapproved SQL or missing backup stops before writes', async () => {
    planDatabase();
    expect(() => applyDatabase(sha)).toThrow();
    pending.read.mockReturnValue({ count: 1, pending: ['999_missing.sql'], ledgerExists: true });
    await expect(backupDatabase(sha)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it('requires the receipt for this release and unchanged plan immediately before apply', async () => {
    planDatabase(); await backupDatabase(sha);
    const before = calls.length;
    expect(() => applyDatabase('b'.repeat(40))).toThrow();
    pending.read.mockReturnValue({ count: 0, pending: [], ledgerExists: false });
    expect(() => applyDatabase(sha)).toThrow();
    expect(calls.length).toBe(before);
  });
});
