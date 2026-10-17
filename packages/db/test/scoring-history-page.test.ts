import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFriendScoreHistory, getFriendScoreHistoryPage } from '../src/scoring.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
let db: D1Database;
const input = { friendId: 'a1', lineAccountId: 'a', limit: 100 };
beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('a','a','A','',''),('b','b','B','','');
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES ('a1','Ua1','a'),('a2','Ua2','a'),('b1','Ub1','b')`);
  db = asD1(raw);
});
afterEach(() => raw.close());
function seed(count: number) {
  const insert = raw.prepare(`INSERT INTO friend_scores(id,friend_id,score_change,created_at)
    VALUES (?,'a1',1,'2026-10-01')`);
  raw.transaction(() => {
    for (let i = 0; i < count; i++) insert.run(`score-${String(i).padStart(5, '0')}`);
  })();
}

it('returns empty and exact 100-row boundaries without a spurious next page', async () => {
  expect(await getFriendScoreHistoryPage(db, input)).toEqual({ items: [], nextCursor: null });
  seed(100);
  const page = await getFriendScoreHistoryPage(db, input);
  expect(page.items).toHaveLength(100);
  expect(page.nextCursor).toBeNull();
});

it('keeps equal timestamps stable and does not repeat rows when a newer event arrives', async () => {
  seed(201);
  const first = await getFriendScoreHistoryPage(db, input);
  expect(first.items[0].id).toBe('score-00200');
  expect(first.nextCursor).toMatchObject({ id: 'score-00101' });
  raw.exec(`INSERT INTO friend_scores(id,friend_id,score_change,created_at)
    VALUES ('new','a1',2,'2026-10-02'),('other','a2',3,'2026-10-01'),('other-store','b1',3,'2026-10-01')`);
  const second = await getFriendScoreHistoryPage(db, { ...input, cursor: first.nextCursor! });
  const third = await getFriendScoreHistoryPage(db, { ...input, cursor: second.nextCursor! });
  expect(second.items[0].id).toBe('score-00100');
  expect(third.items.map(row => row.id)).toEqual(['score-00000']);
  expect(third.nextCursor).toBeNull();
  const ids = [...first.items, ...second.items, ...third.items].map(row => row.id);
  expect(ids).toHaveLength(201);
  expect(new Set(ids).size).toBe(201);
});

it('rejects cursor reuse for another friend or store and filters store ids in SQL', async () => {
  seed(101);
  const first = await getFriendScoreHistoryPage(db, input);
  const prepare = vi.spyOn(db, 'prepare');
  for (const changed of [{ friendId: 'a2' }, { lineAccountId: 'b' }]) {
    await expect(getFriendScoreHistoryPage(db, { ...input, ...changed, cursor: first.nextCursor! }))
      .rejects.toThrow('score_history_cursor_scope_mismatch');
  }
  expect(prepare).not.toHaveBeenCalled();
  expect(await getFriendScoreHistoryPage(db, { ...input, lineAccountId: 'b' })).toEqual({ items: [], nextCursor: null });
  expect(await getFriendScoreHistoryPage(db, { ...input, lineAccountId: "a' OR 1=1 --" })).toEqual({ items: [], nextCursor: null });
});

it('bounds 50,000 rows in one query while keeping the existing complete history for exports', async () => {
  seed(50_000);
  const prepare = vi.spyOn(db, 'prepare');
  const page = await getFriendScoreHistoryPage(db, input);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(page.items).toHaveLength(100);
  expect(page.items[0].id).toBe('score-49999');
  expect(page.nextCursor).toMatchObject({ id: 'score-49900' });
  expect(await getFriendScoreHistory(db, 'a1')).toHaveLength(50_000);
});

it('uses the existing list limit and treats cursor text as bound values', async () => {
  seed(301);
  expect((await getFriendScoreHistoryPage(db, { ...input, limit: 50_000 })).items).toHaveLength(200);
  expect((await getFriendScoreHistoryPage(db, { ...input, limit: -1 })).items).toHaveLength(100);
  const cursor = { friendId: 'a1', lineAccountId: 'a', createdAt: "'); DROP TABLE friends; --", id: 'id' };
  await getFriendScoreHistoryPage(db, { ...input, cursor });
  expect(raw.prepare('SELECT COUNT(*) AS n FROM friends').get()).toEqual({ n: 3 });
});
