import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('762 media deletion job', () => {
  it('既存のメディアを変えずに削除対象のキーと再試行状態を保持する', () => {
    const db = new Database(':memory:');
    try {
      db.exec("CREATE TABLE media(id TEXT PRIMARY KEY, r2_key TEXT NOT NULL); INSERT INTO media VALUES('m', 'old-key');");
      db.exec(readFileSync(new URL('../migrations/762_media_deletion_jobs.sql', import.meta.url), 'utf8'));
      db.prepare('INSERT INTO media_deletion_jobs (media_id,line_account_id,r2_keys_json,status,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('m', 'account', JSON.stringify(['old-key', 'new-key']), 'deleting', 'now', 'now');
      db.prepare('DELETE FROM media WHERE id=?').run('m');
      expect(db.prepare('SELECT r2_keys_json,status FROM media_deletion_jobs WHERE media_id=?').get('m'))
        .toEqual({ r2_keys_json: '["old-key","new-key"]', status: 'deleting' });
      expect(() => db.prepare('UPDATE media_deletion_jobs SET r2_keys_json=?').run('{}')).toThrow();
      expect(() => db.prepare("INSERT INTO media_deletion_guards(blocked) SELECT 1 WHERE EXISTS(SELECT 1 FROM media_deletion_jobs WHERE media_id=?)").run('m')).toThrow('media_deletion_in_progress');
      expect(db.prepare('SELECT COUNT(*) AS count FROM media_deletion_guards').get()).toEqual({ count: 0 });
    } finally { db.close(); }
  });
});
