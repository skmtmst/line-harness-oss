import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '180_codex_cloud_tasks.sql'),
  'utf8',
);

function database(): Database.Database {
  const db = new Database(':memory:');
  db.exec(migration);
  return db;
}

describe('180_codex_cloud_tasks', () => {
  test('同じSlack投稿を再送しても台帳は1行だけになる', () => {
    const db = database();
    const insert = db.prepare(`
      INSERT INTO codex_cloud_tasks (
        slack_event_id, team_id, channel_id, message_ts, thread_ts, requester_user_id
      ) VALUES (?, 'T1', 'C1', '100.1', '100.1', 'U1')
    `);
    insert.run('Ev1');
    expect(() => insert.run('Ev2')).toThrow(/UNIQUE constraint failed/);
    expect(db.prepare('SELECT COUNT(*) AS count FROM codex_cloud_tasks').get()).toEqual({ count: 1 });
    db.close();
  });

  test('未定義の状態を保存できず、依頼本文の列を持たない', () => {
    const db = database();
    expect(() => db.prepare(`
      INSERT INTO codex_cloud_tasks (
        slack_event_id, team_id, channel_id, message_ts, thread_ts, requester_user_id, status
      ) VALUES ('Ev1', 'T1', 'C1', '100.1', '100.1', 'U1', 'unknown')
    `).run()).toThrow(/CHECK constraint failed/);
    const columns = db.prepare("PRAGMA table_info('codex_cloud_tasks')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain('prompt');
    expect(columns.map((column) => column.name)).not.toContain('text');
    db.close();
  });
});
