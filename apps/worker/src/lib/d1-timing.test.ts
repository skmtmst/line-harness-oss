import { afterEach, expect, it, vi } from 'vitest';
import { createD1Timing, timedD1 } from './d1-timing.js';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const secret = { value: 'secret', meta: { duration: 9999 } };
  const result = { results: [secret], meta: { duration: 2, timings: { sql_duration_ms: 1.25 } } };
  const statements = new WeakSet<object>();
  const first = vi.fn(async (...args: unknown[]) => { now += 20; return args.length ? secret.value : secret; });
  const run = vi.fn(async () => { now += 30; return result; });
  const raw = vi.fn(async () => { now += 15; return [['secret']]; });
  function statement() {
    const item = { bind: vi.fn(() => statement()), first, all: run, run, raw };
    statements.add(item);
    return item;
  }
  const source = {
    prepare: vi.fn(() => statement()),
    batch: vi.fn(async (items: object[]) => {
      expect(items.every(item => statements.has(item))).toBe(true);
      now += 40;
      return items.map(() => result);
    }),
    exec: vi.fn(async () => { now += 50; return { count: 2, duration: 3 }; }),
    withSession: vi.fn(() => ({ prepare: source.prepare, batch: source.batch, getBookmark: () => 'bookmark' })),
  };
  const timing = createD1Timing();
  return { source, db: timedD1(source as unknown as D1Database, timing), timing, first, run, result, secret };
}

it('first/all/run/raw/batch/execとsessionを1呼出し1往復で数え、戻り値と引数を保つ', async () => {
  const { db, source, timing, first, secret, result } = fixture();
  const stmt = db.prepare('SELECT secret').bind('secret', 7);
  expect(timing.count).toBe(0);
  expect(await stmt.first()).toBe(secret);
  expect(await stmt.first('value')).toBe('secret');
  expect(first).toHaveBeenLastCalledWith('value');
  expect(await stmt.all()).toBe(result);
  expect(await stmt.run()).toBe(result);
  expect(await stmt.raw({ columnNames: true })).toEqual([['secret']]);
  expect(await db.batch([stmt, db.prepare('UPDATE secret')])).toEqual([result, result]);
  await db.exec('SELECT 1; SELECT 2;');
  const session = db.withSession('first-primary');
  expect(source.withSession).toHaveBeenCalledWith('first-primary');
  expect(session.getBookmark()).toBe('bookmark');
  await session.prepare('SELECT 1').first();
  await session.batch([stmt]);
  expect(timing).toMatchObject({ count: 9, pending: 0, duration: 265, sqlCount: 5, sqlDuration: 6.25 });
});

it('失敗の待ちも数え、同じ例外を呼び出し元へ渡す', async () => {
  const { db, timing, first } = fixture();
  const error = new Error('private SQL detail');
  first.mockRejectedValueOnce(error);
  await expect(db.prepare('SELECT secret').first()).rejects.toBe(error);
  expect(timing).toMatchObject({ count: 1, pending: 0, sqlCount: 0 });
});

it('並行呼出しの合計待ちと、応答時点で未完了の背景処理を区別する', async () => {
  const { db, timing, first } = fixture();
  let finish!: (value: never) => void;
  first.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = db.prepare('SELECT secret').first();
  await db.prepare('SELECT 1').run();
  expect(timing).toMatchObject({ count: 2, pending: 1, duration: 30 });
  timing.closed = true;
  const snapshot = { ...timing };
  finish(null as never);
  await pending;
  await db.prepare('SELECT 2').all();
  expect(timing).toEqual(snapshot);
});
