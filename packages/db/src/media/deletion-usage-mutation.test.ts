import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { asD1 } from '../../test/d1-test-helper.js';
import { applyMediaUsageMutation } from './definitions-reads.js';

it.each(['checking', 'completed'])('保存と使用台帳のbatchで削除状態 %s を照合する', async (status) => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(`CREATE TABLE media(id TEXT,line_account_id TEXT,r2_key TEXT);
      CREATE TABLE media_versions(media_id TEXT,r2_key TEXT);
      CREATE TABLE media_usages(media_id TEXT,ref_kind TEXT,ref_id TEXT,scanned_at TEXT);
      CREATE TABLE test_content(id TEXT PRIMARY KEY,body TEXT);
      INSERT INTO media VALUES('m','account','old-key');`);
    sqlite.exec(readFileSync(new URL('../../migrations/762_media_deletion_jobs.sql', import.meta.url), 'utf8'));
    if (status === 'completed') sqlite.exec("DELETE FROM media WHERE id = 'm'");
    const actual = asD1(sqlite);
    const race = { ...actual, batch: async (statements: D1PreparedStatement[]) => {
      sqlite.prepare(`INSERT INTO media_deletion_jobs(media_id,line_account_id,r2_keys_json,status,created_at,updated_at)
        VALUES('m','account','["old-key"]',?,'now','now')`).run(status);
      return actual.batch(statements);
    } } as D1Database;
    await expect(applyMediaUsageMutation(race, {
      lineAccountId: 'account', refKind: 'template', refId: 'template',
      searchableContent: ['https://example.test/old-key'],
      mutationStatements: [race.prepare('INSERT INTO test_content VALUES (?,?)').bind('template', 'old-key')],
    })).rejects.toThrow('media_deletion_in_progress');
    expect(sqlite.prepare('SELECT * FROM test_content').all()).toEqual([]);
    expect(sqlite.prepare('SELECT * FROM media_usages').all()).toEqual([]);
  } finally { sqlite.close(); }
});

it('作業記録が消えたあとも、JSON本文中の古い固定画像URLを拒む', async () => {
  const sqlite=new Database(':memory:');
  try {
    sqlite.exec(`CREATE TABLE media(id TEXT,line_account_id TEXT,r2_key TEXT);
      CREATE TABLE media_versions(media_id TEXT,r2_key TEXT);
      CREATE TABLE media_usages(media_id TEXT,ref_kind TEXT,ref_id TEXT,scanned_at TEXT);
      CREATE TABLE test_content(id TEXT PRIMARY KEY,body TEXT);`);
    sqlite.exec(readFileSync(new URL('../../migrations/762_media_deletion_jobs.sql', import.meta.url),'utf8'));
    const {createHash}=await import('node:crypto');
    sqlite.prepare('INSERT INTO media_deleted_key_fingerprints(sha256) VALUES(?)').run(createHash('sha256').update('media/old/final/deleted.png').digest('hex'));
    const db=asD1(sqlite);
    const content=JSON.stringify({message:'画像 https://example.test/images/media/old/final/deleted.png を確認'});
    await expect(applyMediaUsageMutation(db,{lineAccountId:'new',refKind:'template',refId:'t',searchableContent:[content],mutationStatements:[db.prepare('INSERT INTO test_content VALUES (?,?)').bind('t',content)]})).rejects.toThrow('media_deletion_in_progress');
    expect(sqlite.prepare('SELECT * FROM test_content').all()).toEqual([]);
  } finally {sqlite.close();}
});
