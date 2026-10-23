import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { processCustomerSegments, CUSTOMER_SEGMENT_BATCH_SIZE } from './customer-segments.js';
import { processStoreComparison, STORE_COMPARISON_DAILY_BATCH_SIZE } from './store-comparison.js';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => {
  fixture = createTestD1();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external calls forbidden'); }));
});
afterEach(() => { fixture.raw.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function accounts(count: number) {
  const insert = fixture.raw.prepare(`INSERT INTO line_accounts
    (id,channel_id,name,channel_access_token,channel_secret,created_at)
    VALUES(?,?,?,'fixture-token','fixture-secret','2026-10-22T00:00:00Z')`);
  fixture.raw.transaction(() => {
    for (let index = 0; index < count; index++) {
      const id = `store-${String(index).padStart(5, '0')}`;
      insert.run(id, `channel-${id}`, id);
    }
  })();
}

test('5,000 accounts receive daily customer snapshots without an unbounded invocation', async () => {
  accounts(5_000);
  const start = Date.parse('2026-10-22T19:00:00Z'); // 04:00 JST
  let queries = 0, maxQueries = 0;
  const counted = new Proxy(fixture.db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => { queries++; return target.prepare(sql); };
    return Reflect.get(target, key);
  } });
  const ticks = Math.ceil(5_000 / CUSTOMER_SEGMENT_BATCH_SIZE);
  for (let tick = 0; tick < ticks; tick++) {
    queries = 0;
    await processCustomerSegments(counted, new Date(start + tick * 60_000));
    maxQueries = Math.max(maxQueries, queries);
  }
  expect(ticks).toBeLessThan(20 * 60);
  expect(maxQueries).toBeLessThan(60);
  expect(fixture.raw.prepare("SELECT count(*) n FROM customer_activity_runs WHERE status='ready'").get())
    .toEqual({ n: 5_000 });
  expect(fixture.raw.prepare("SELECT status FROM customer_activity_runs WHERE account_id='store-04999'").get())
    .toEqual({ status: 'ready' });
  expect(fetch).not.toHaveBeenCalled();
}, 60_000);

test('5,000 accounts receive yesterday comparisons in the available daily window', async () => {
  accounts(5_000);
  const start = Date.parse('2026-10-22T19:30:00Z'); // 04:30 JST
  let queries = 0, maxQueries = 0;
  const counted = new Proxy(fixture.db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => { queries++; return target.prepare(sql); };
    return Reflect.get(target, key);
  } });
  const ticks = Math.ceil(5_000 / STORE_COMPARISON_DAILY_BATCH_SIZE);
  for (let tick = 0; tick < ticks; tick++) {
    queries = 0;
    await processStoreComparison(counted, new Date(start + tick * 60_000));
    maxQueries = Math.max(maxQueries, queries);
  }
  expect(ticks).toBeLessThan(19.5 * 60);
  expect(maxQueries).toBeLessThan(60);
  expect(fixture.raw.prepare("SELECT count(*) n FROM hq_store_daily_metrics WHERE date='2026-10-22' AND state='partial'").get())
    .toEqual({ n: 5_000 });
  expect(fetch).not.toHaveBeenCalled();
}, 60_000);

test('one failed customer account does not block the following four, including a duplicate tick', async () => {
  accounts(5);
  fixture.raw.exec(`CREATE TRIGGER fail_one BEFORE INSERT ON customer_activity_runs
    WHEN NEW.account_id='store-00000' AND NEW.status='ready'
    BEGIN SELECT RAISE(ABORT,'customer fixture failure'); END`);
  const now = new Date('2026-10-22T19:00:00Z');
  const results = await Promise.allSettled([
    processCustomerSegments(fixture.db, now), processCustomerSegments(fixture.db, now),
  ]);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(fixture.raw.prepare('SELECT status,count(*) n FROM customer_activity_runs GROUP BY status ORDER BY status').all())
    .toEqual([{ status: 'failed', n: 1 }, { status: 'ready', n: 4 }]);
  await processCustomerSegments(fixture.db, new Date(now.getTime() + 60_000));
  expect(fixture.raw.prepare("SELECT last_attempt_at FROM customer_activity_runs WHERE account_id='store-00000'").get())
    .toEqual({ last_attempt_at: now.toISOString() });
});

test('overlapping comparison ticks do not duplicate observations and continue after one failed account', async () => {
  accounts(5);
  fixture.raw.exec(`CREATE TRIGGER fail_one BEFORE INSERT ON hq_store_daily_metrics
    WHEN NEW.account_id='store-00000' AND NEW.state!='failed'
    BEGIN SELECT RAISE(ABORT,'comparison fixture failure'); END`);
  const now = new Date('2026-10-22T19:30:00Z');
  const results = await Promise.allSettled([
    processStoreComparison(fixture.db, now), processStoreComparison(fixture.db, now),
  ]);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(fixture.raw.prepare('SELECT state,count(*) n FROM hq_store_daily_metrics GROUP BY state ORDER BY state').all())
    .toEqual([{ state: 'failed', n: 1 }, { state: 'partial', n: 4 }]);
  expect(fetch).not.toHaveBeenCalled();
});

test('unfinished customer accounts keep priority across a calendar boundary', async () => {
  accounts(6);
  fixture.raw.exec(`INSERT INTO customer_activity_runs(account_id,computed_at,last_attempt_at,status)
    SELECT id,CASE WHEN id='store-00000' THEN '2026-10-22T00:00:00Z' ELSE '2026-10-20T00:00:00Z' END,
      '2026-10-22T00:00:00Z','ready' FROM line_accounts`);
  const now = new Date('2026-10-22T19:00:00Z');
  await processCustomerSegments(fixture.db, now);
  expect(fixture.raw.prepare("SELECT computed_at FROM customer_activity_runs WHERE account_id='store-00000'").get())
    .toEqual({ computed_at: '2026-10-22T00:00:00Z' });
  expect(fixture.raw.prepare('SELECT count(*) n FROM customer_activity_runs WHERE computed_at=?').get(now.toISOString()))
    .toEqual({ n: 5 });
});

test('a permanently failing customer prefix cannot reclaim all slots when its cooldown ends', async () => {
  accounts(400);
  fixture.raw.exec(`CREATE TRIGGER fail_prefix BEFORE INSERT ON customer_activity_runs
    WHEN NEW.account_id<'store-00300' AND NEW.status='ready'
    BEGIN SELECT RAISE(ABORT,'customer fixture failure'); END`);
  const start = Date.parse('2026-10-22T19:00:00Z');
  for (let tick = 0; tick < 80; tick += 1) {
    await processCustomerSegments(fixture.db, new Date(start + tick * 60_000)).catch(() => {});
  }
  expect(fixture.raw.prepare(`SELECT status,COUNT(*) AS total FROM customer_activity_runs GROUP BY status ORDER BY status`).all())
    .toEqual([{ status: 'failed', total: 300 }, { status: 'ready', total: 100 }]);
});

test('a permanently failing comparison prefix cannot starve the unattempted daily tail', async () => {
  accounts(400);
  fixture.raw.exec(`CREATE TRIGGER fail_prefix BEFORE INSERT ON hq_store_daily_metrics
    WHEN NEW.account_id<'store-00300' AND NEW.state!='failed'
    BEGIN SELECT RAISE(ABORT,'comparison fixture failure'); END`);
  const start = Date.parse('2026-10-22T19:30:00Z');
  for (let tick = 0; tick < 80; tick += 1) {
    await processStoreComparison(fixture.db, new Date(start + tick * 60_000)).catch(() => {});
  }
  expect(fixture.raw.prepare(`SELECT state,COUNT(*) AS total FROM hq_store_daily_metrics
    WHERE date='2026-10-22' GROUP BY state ORDER BY state`).all())
    .toEqual([{ state: 'failed', total: 300 }, { state: 'partial', total: 100 }]);
});

test('historical comparison retries rotate independently of successful daily refreshes', async () => {
  accounts(70);
  fixture.raw.exec(`UPDATE line_accounts SET created_at='2026-10-21T00:00:00Z';
    CREATE TRIGGER fail_history BEFORE INSERT ON hq_store_daily_metrics
    WHEN NEW.account_id<'store-00060' AND NEW.date='2026-10-21' AND NEW.state!='failed'
    BEGIN SELECT RAISE(ABORT,'history fixture failure'); END`);
  const start = Date.parse('2026-10-22T19:30:00Z');
  for (let tick = 0; tick < 70; tick += 1) {
    await processStoreComparison(fixture.db, new Date(start + tick * 60_000)).catch(() => {});
  }
  expect(fixture.raw.prepare(`SELECT state,COUNT(*) AS total FROM hq_store_daily_metrics
    WHERE date='2026-10-21' GROUP BY state ORDER BY state`).all())
    .toEqual([{ state: 'failed', total: 60 }, { state: 'partial', total: 10 }]);
  expect(fixture.raw.prepare(`SELECT COUNT(*) AS total FROM hq_store_daily_metrics
    WHERE date='2026-10-22' AND state='partial'`).get()).toEqual({ total: 70 });
});

test('the time budget stops before another account and the next invocation resumes it', async () => {
  accounts(6);
  let clock = Date.parse('2026-10-22T19:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const slow = new Proxy(fixture.db, { get(target, key) {
    if (key === 'batch') return async <T = unknown>(statements: D1PreparedStatement[]) => {
      const result = await target.batch<T>(statements);
      clock += 60_000;
      return result;
    };
    return Reflect.get(target, key);
  } });
  const now = new Date(clock);
  await processCustomerSegments(slow, now);
  expect(fixture.raw.prepare('SELECT count(*) n FROM customer_activity_runs').get()).toEqual({ n: 1 });
  await processCustomerSegments(fixture.db, now);
  expect(fixture.raw.prepare('SELECT count(*) n FROM customer_activity_runs').get()).toEqual({ n: 6 });
  expect(fixture.raw.prepare("SELECT count(*) n FROM platform_settings WHERE key='scheduled-work:customer-segments'").get())
    .toEqual({ n: 0 });
});
