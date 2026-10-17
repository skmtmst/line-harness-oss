import { describe, expect, test, vi } from 'vitest';
import { createDisplayReadCache, withDisplayReadCache } from '../src/display-read-cache.js';

function fixture() {
  let value: unknown = { value: 3, asOf: '2026-10-18T00:00:00Z', state: 'partial' };
  const calls = vi.fn(async () => structuredClone(value));
  const run = vi.fn(async () => { value = { value: 4 }; return { success: true }; });
  const batch = vi.fn(async () => { value = { value: 5 }; return []; });
  const exec = vi.fn(async () => { value = { value: 6 }; return {}; });
  const originalStatements: object[] = [];
  const prepare = () => {
    const s = { bind: (..._args: unknown[]) => prepare(), first: calls, all: calls, raw: run, run };
    originalStatements.push(s);
    return s;
  };
  const source = { prepare, batch, exec } as unknown as D1Database;
  return { source, calls, run, batch, exec, originalStatements, set: (v: unknown) => { value = v; } };
}
const select = (db: D1Database, account = 'a') => db.prepare('SELECT value FROM metrics WHERE account_id=?').bind(account).first<{ value: number }>();

describe('display calculation cache', () => {
  test('cold/warm share a read, preserve source time/state and isolate returned objects', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    const first = await select(c.db);
    expect(first).toEqual({ value: 3, asOf: '2026-10-18T00:00:00Z', state: 'partial' });
    first!.value = 99;
    expect(await select(c.db)).toEqual({ value: 3, asOf: '2026-10-18T00:00:00Z', state: 'partial' });
    const warm = await select(c.db);
    warm!.value = 88;
    expect(await select(c.db)).toHaveProperty('value', 3);
    expect(f.calls).toHaveBeenCalledTimes(1);
  });
  test('concurrent identical reads make one SQL call; callers receive separate values', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    const [a, b] = await Promise.all([select(c.db), select(c.db)]);
    expect(a).toEqual(b); expect(a).not.toBe(b); expect(f.calls).toHaveBeenCalledTimes(1);
  });
  test('expiry is measured from read start, never extended by warm reads', async () => {
    let now = 0;
    const f = fixture(), c = createDisplayReadCache(f.source, () => now);
    await select(c.db); now = 999; await select(c.db);
    expect(f.calls).toHaveBeenCalledTimes(1);
    now = 1000; await select(c.db); expect(f.calls).toHaveBeenCalledTimes(2);
  });
  test('a read completing after TTL is not retained', async () => {
    let now = 0;
    const f = fixture(), c = createDisplayReadCache(f.source, () => now);
    f.calls.mockImplementationOnce(async () => { now = 1001; return { value: 7 }; });
    await select(c.db); await select(c.db); expect(f.calls).toHaveBeenCalledTimes(2);
  });
  test('explicit invalidation cannot let a late old read replace a newer value', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    let resolve!: (v: unknown) => void;
    f.calls.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const old = select(c.db); await Promise.resolve();
    c.invalidate(); f.set({ value: 8 });
    expect(await select(c.db)).toEqual({ value: 8 });
    resolve({ value: 1 }); await old;
    expect(await select(c.db)).toEqual({ value: 8 }); expect(f.calls).toHaveBeenCalledTimes(2);
  });
  test.each(['run', 'batch', 'exec'] as const)('%s invalidates reads and passes original statements to D1', async method => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    await select(c.db);
    const s = c.db.prepare('UPDATE metrics SET value=4 WHERE account_id=?').bind('a');
    if (method === 'run') await s.run();
    if (method === 'exec') await c.db.exec('UPDATE metrics SET value=6');
    if (method === 'batch') {
      await c.db.batch([s]);
      expect(f.originalStatements).toContain(f.batch.mock.calls[0][0]?.[0]);
    }
    expect((await select(c.db))?.value).toBe(method === 'run' ? 4 : method === 'batch' ? 5 : 6);
    expect(f.calls).toHaveBeenCalledTimes(2);
  });
  test('failed writes also invalidate; reads while a write is pending are never retained', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    await select(c.db);
    let reject!: (e: Error) => void;
    f.run.mockImplementationOnce(() => new Promise((_r, j) => { reject = j; }));
    const write = c.db.prepare('UPDATE metrics SET value=4').run();
    await select(c.db); await select(c.db); expect(f.calls).toHaveBeenCalledTimes(3);
    reject(new Error('write failed')); await expect(write).rejects.toThrow('write failed');
    await select(c.db); expect(f.calls).toHaveBeenCalledTimes(4);
  });
  test('two DBs and successive calculations never share data, even with identical binds', async () => {
    const a = fixture(), b = fixture(); b.set({ value: 999 });
    expect(await withDisplayReadCache(a.source, select)).toHaveProperty('value', 3);
    expect(await withDisplayReadCache(b.source, select)).toHaveProperty('value', 999);
    a.set({ value: 4 });
    expect(await withDisplayReadCache(a.source, select)).toHaveProperty('value', 4);
    expect(a.calls).toHaveBeenCalledTimes(2);
  });
  test('account, filter, type, timezone, period, column and result form are separate keys', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    await select(c.db, 'a'); await select(c.db, 'b');
    const q = 'SELECT value FROM metrics WHERE account_id=? AND timezone=? AND period=?';
    await c.db.prepare(q).bind('a', 'Asia/Tokyo', 'today').first();
    await c.db.prepare(q).bind('a', 'UTC', 'today').first();
    await c.db.prepare(q).bind('a', 'UTC', 'week').first();
    await c.db.prepare(q).bind('a', 'UTC', 1).first();
    await c.db.prepare(q).bind('a', 'UTC', '1').first();
    await c.db.prepare(q).bind('a', 'UTC', '1').first('value');
    await c.db.prepare(q).bind('a', 'UTC', '1').all();
    expect(f.calls).toHaveBeenCalledTimes(9);
  });
  test('byte binds use contents rather than ArrayBuffer JSON identity', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    await c.db.prepare('SELECT ?').bind(new Uint8Array([1]).buffer).first();
    await c.db.prepare('SELECT ?').bind(new Uint8Array([2]).buffer).first();
    await c.db.prepare('SELECT ?').bind(new Uint8Array([1]).buffer).first();
    expect(f.calls).toHaveBeenCalledTimes(2);
  });
  test.each([null, { success: false, results: [] }])('missing/failed results are not retained: %j', async value => {
    const f = fixture(), c = createDisplayReadCache(f.source); f.set(value);
    expect(await select(c.db)).toEqual(value);
    f.set({ value: 7 }); expect(await select(c.db)).toEqual({ value: 7 });
    expect(f.calls).toHaveBeenCalledTimes(2);
  });
  test('rejected reads are retryable without manufacturing a zero', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    f.calls.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(select(c.db)).rejects.toThrow('DB unavailable');
    expect(await select(c.db)).toHaveProperty('value', 3); expect(f.calls).toHaveBeenCalledTimes(2);
  });
  test('partial and unconfigured data retain null values', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    f.set({ value: null, state: 'unconfigured', asOf: null });
    expect(await select(c.db)).toEqual({ value: null, state: 'unconfigured', asOf: null });
    expect(await select(c.db)).toEqual({ value: null, state: 'unconfigured', asOf: null });
  });
  test('disposed scopes cannot be repopulated by pending reads', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    let resolve!: (v: unknown) => void;
    f.calls.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = select(c.db); await Promise.resolve(); c.dispose();
    resolve({ value: 1 }); await pending;
    await select(c.db); await select(c.db); expect(f.calls).toHaveBeenCalledTimes(3);
  });
  test('large results and excess unique queries bypass retention', async () => {
    const f = fixture(), c = createDisplayReadCache(f.source);
    f.set({ value: 'x'.repeat(1_048_577) });
    await select(c.db); await select(c.db); expect(f.calls).toHaveBeenCalledTimes(2);
    f.set({ value: 3 });
    for (let i = 0; i < 129; i++) await select(c.db, String(i));
    await select(c.db, '128'); expect(f.calls).toHaveBeenCalledTimes(132);
  });
});
