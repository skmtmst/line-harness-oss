import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { asD1 } from '../../test/d1-test-helper.js';
import { RETENTION_TABLES, tenantScopeCondition } from '../data-retention-tables.js';
import { beginMediaObjectDeletion, claimMediaDeletion, finishMediaDeletion, releaseMediaDeletionLease, releaseUnstartedMediaDeletion } from './deletion-jobs.js';

describe('media deletion job claim', () => {
  it('keys are captured once and an expired owner cannot start object deletion', async () => {
    const raw = new Database(':memory:');
    try {
      raw.exec(`CREATE TABLE media(id TEXT PRIMARY KEY,line_account_id TEXT,r2_key TEXT);
        CREATE TABLE media_versions(media_id TEXT,r2_key TEXT);
        INSERT INTO media VALUES('m','a','current');
        INSERT INTO media_versions VALUES('m','previous'),('m','current');`);
      raw.exec(readFileSync(new URL('../../migrations/762_media_deletion_jobs.sql', import.meta.url), 'utf8'));
      const db = asD1(raw);
      const claim = (owner: string, now: string, leaseUntil: string) => claimMediaDeletion(db, { mediaId: 'm', accountId: 'a', owner, now, leaseUntil });
      const first = await claim('first', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z');
      expect(JSON.parse(first!.r2_keys_json).sort()).toEqual(['current', 'previous']);
      expect(await claim('second', '2026-01-01T00:00:30Z', '2026-01-01T00:02:00Z')).toBeNull();
      raw.prepare("INSERT INTO media_versions VALUES('m','late')").run();
      const second = await claim('second', '2026-01-01T00:01:01Z', '2026-01-01T00:02:00Z');
      expect(JSON.parse(second!.r2_keys_json).sort()).toEqual(['current', 'previous']);
      expect(await beginMediaObjectDeletion(db, 'm', 'a', 'first', '2026-01-01T00:01:02Z')).toBe(false);
      expect(await releaseUnstartedMediaDeletion(db, 'm', 'a', 'first')).toBe(false);
      expect(await beginMediaObjectDeletion(db, 'm', 'a', 'second', '2026-01-01T00:01:02Z')).toBe(true);
      expect(await releaseUnstartedMediaDeletion(db, 'm', 'a', 'second')).toBe(false);
      expect(await finishMediaDeletion(db, 'm', 'a', 'first', '2026-01-01T00:01:03Z')).toBe(false);
      expect(await releaseMediaDeletionLease(db, 'm', 'a', 'second', '2026-01-01T00:01:03Z')).toBe(true);
      const retry = await claim('retry', '2026-01-01T00:01:04Z', '2026-01-01T00:02:00Z');
      expect(retry?.status).toBe('deleting');
      expect(retry?.r2_keys_json).toBe(second!.r2_keys_json);
      expect(await finishMediaDeletion(db, 'm', 'a', 'retry', '2026-01-01T00:01:05Z')).toBe(true);
      expect(raw.prepare("SELECT status,r2_keys_json FROM media_deletion_jobs WHERE media_id='m'").get()).toEqual({ status: 'completed', r2_keys_json: second!.r2_keys_json });
      expect(raw.prepare("SELECT id FROM media WHERE id='m'").get()).toBeUndefined();
      raw.exec("CREATE TABLE line_accounts(id TEXT PRIMARY KEY,tenant_id TEXT); INSERT INTO line_accounts VALUES('a','tenant-a')");
      expect(RETENTION_TABLES.media_deleted_key_fingerprints.category).toBe('global');
      raw.prepare(`DELETE FROM media_deletion_jobs WHERE ${tenantScopeCondition('media_deletion_jobs')}`).run('tenant-a');
      expect(raw.prepare('SELECT * FROM media_deletion_jobs').all()).toEqual([]);
      const fingerprints=raw.prepare('SELECT * FROM media_deleted_key_fingerprints ORDER BY sha256').all();
      expect(fingerprints).toEqual(['current','previous'].map(key=>({sha256:createHash('sha256').update(key).digest('hex')})).sort((a,b)=>a.sha256.localeCompare(b.sha256)));
      expect(JSON.stringify(fingerprints)).not.toMatch(/current|previous|line_account_id/);
    } finally { raw.close(); }
  });
});

it('使用中で削除をやめた場合は指紋を残さない', async () => {
  const raw=new Database(':memory:');
  try {
    raw.exec("CREATE TABLE media(id TEXT PRIMARY KEY,line_account_id TEXT,r2_key TEXT); CREATE TABLE media_versions(media_id TEXT,r2_key TEXT); INSERT INTO media VALUES('m','a','key')");
    raw.exec(readFileSync(new URL('../../migrations/762_media_deletion_jobs.sql',import.meta.url),'utf8'));
    const db=asD1(raw);
    expect(await claimMediaDeletion(db,{mediaId:'m',accountId:'a',owner:'o',now:'2026-01-01T00:00:00Z',leaseUntil:'2026-01-01T00:01:00Z'})).not.toBeNull();
    expect(await releaseUnstartedMediaDeletion(db,'m','a','o')).toBe(true);
    expect(raw.prepare('SELECT * FROM media_deleted_key_fingerprints').all()).toEqual([]);
  } finally {raw.close();}
});

it('送信中の参照はアカウントの保存期限で消せる', async () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../../migrations/762_media_deletion_jobs.sql', import.meta.url), 'utf8'));
    raw.exec("CREATE TABLE line_accounts(id TEXT PRIMARY KEY,tenant_id TEXT); INSERT INTO line_accounts VALUES('a','tenant-a'),('b','tenant-b'); INSERT INTO media_send_claims VALUES('first','m','a','later'),('second','m','b','later')");
    expect(RETENTION_TABLES.media_send_claims.category).toBe('purge');
    raw.prepare(`DELETE FROM media_send_claims WHERE ${tenantScopeCondition('media_send_claims')}`).run('tenant-a');
    expect(raw.prepare('SELECT claim_id FROM media_send_claims').all()).toEqual([{claim_id:'second'}]);
  } finally { raw.close(); }
});
