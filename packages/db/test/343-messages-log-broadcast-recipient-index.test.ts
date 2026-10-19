import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const INDEX_NAME = 'idx_messages_log_broadcast_friend_direction';
const RECIPIENT_LOOKUP = `
  SELECT 1 FROM messages_log
   WHERE broadcast_id = ? AND friend_id = ? AND direction = 'outgoing'
     AND COALESCE(delivery_type, '') != 'test'
   LIMIT 1
`;

describe('343 差し込み配信の既送信照合索引', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
  });

  afterEach(() => db.close());

  it('migration・schema・bootstrapが同じ複合索引を持つ', () => {
    const expected = 'ON messages_log (broadcast_id, friend_id, direction)';
    for (const file of [
      'migrations/343_messages_log_broadcast_recipient_index.sql',
      'schema.sql',
      'bootstrap.sql',
    ]) {
      const sql = readFileSync(join(ROOT, file), 'utf8');
      expect(sql).toContain(INDEX_NAME);
      expect(sql).toContain(expected);
    }
  });

  it('受信者ごとの既送信照合で複合索引の3列を使う', () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${RECIPIENT_LOOKUP}`)
      .all('broadcast-1', 'friend-1') as Array<{ detail: string }>;
    const details = plan.map(({ detail }) => detail).join('\n');

    expect(details).not.toContain('SCAN messages_log');
    expect(details).toContain(`USING INDEX ${INDEX_NAME}`);
    expect(details).toContain('(broadcast_id=? AND friend_id=? AND direction=?)');
  });
});
