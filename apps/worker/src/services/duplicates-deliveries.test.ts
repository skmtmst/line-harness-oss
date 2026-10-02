import { afterEach, describe, expect, it } from 'vitest';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import { countOverlappingDeliveries } from './duplicates-stats.js';

describe('統合ユーザーに重なって届いた通数', () => {
  const databases: ReturnType<typeof createTestD1>[] = [];
  afterEach(() => databases.splice(0).forEach(({ raw }) => raw.close()));

  it('同じ配信の複数本文を保ち、重複分だけ数え、見られるアカウントに絞る', async () => {
    const testDb = createTestD1();
    databases.push(testDb);
    testDb.raw.prepare("INSERT INTO users (id, display_name) VALUES ('person-1', '試験用')").run();
    for (const [id, account] of [['f1', 'a1'], ['f2', 'a2'], ['f3', 'a3']]) {
      insertFriend(testDb.raw, id, { line_account_id: account, user_id: 'person-1' });
    }
    const insert = testDb.raw.prepare(`INSERT INTO messages_log
      (id, friend_id, direction, message_type, content, broadcast_id, delivery_type)
      VALUES (?, ?, 'outgoing', 'text', '試験本文', ?, ?)`);
    for (const friend of ['f1', 'f2']) {
      insert.run(`${friend}-1`, friend, 'broadcast-1', 'push');
      insert.run(`${friend}-2`, friend, 'broadcast-1', 'push');
    }
    insert.run('separate', 'f3', 'broadcast-2', 'push');
    insert.run('test', 'f2', 'broadcast-1', 'test');
    insert.run('manual', 'f2', null, 'push');
    expect(await countOverlappingDeliveries(testDb.db)).toBe(2);
    expect(await countOverlappingDeliveries(testDb.db, ['a1'])).toBe(0);
    expect(await countOverlappingDeliveries(testDb.db, [])).toBe(0);
  });

  it('統合していない人は別の人として数える', async () => {
    const testDb = createTestD1();
    databases.push(testDb);
    insertFriend(testDb.raw, 'f1');
    insertFriend(testDb.raw, 'f2');
    testDb.raw.exec(`INSERT INTO messages_log
      (id, friend_id, direction, message_type, content, broadcast_id)
      VALUES ('m1', 'f1', 'outgoing', 'text', '試験本文', 'broadcast-1'),
             ('m2', 'f2', 'outgoing', 'text', '試験本文', 'broadcast-1')`);
    expect(await countOverlappingDeliveries(testDb.db)).toBe(0);
  });

  it('配信実績を取れないときは null を返す', async () => {
    const db = { prepare() { throw new Error('取得不能'); } } as unknown as D1Database;
    expect(await countOverlappingDeliveries(db)).toBeNull();
  });
});
