import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import * as cache from '@line-crm/db/src/display-read-cache.js';
import { getDashboardOverview } from '@line-crm/db/src/dashboard-overview.js';
import { gapFixture, seedGapBooking } from '../test-utils/gap1.js';
import { comparisonData } from './store-comparison-export.js';
import { styleSnapshot, styleWindow } from './style-analytics.js';
import { styleSchedule } from './style-schedule.js';

let d: ReturnType<typeof gapFixture>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T03:00:00Z'));
  d = gapFixture();
  seedGapBooking(d, 'booking', 'confirmed', '2026-10-18T05:00:00Z');
  d.raw.exec(`INSERT INTO account_styles(line_account_id,style,selection_mode,settings_json,answers_json,updated_at)
    VALUES('a','salon','configured','{}','{}','2026-10-18T03:00:00Z');
    INSERT INTO hq_store_daily_metrics(account_id,date,bookings,visits,no_shows,state,computed_at)
    VALUES('a','2026-10-17',2,1,0,'partial','2026-10-18T00:00:00Z'),
    ('a','2026-10-16',1,0,0,'partial','2026-10-17T00:00:00Z');`);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external_forbidden'); }));
});
afterEach(() => { d.raw.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function measuredDb(db: D1Database) {
  let reads = 0;
  const wrap = (s: D1PreparedStatement): D1PreparedStatement => new Proxy(s, {
    get(target, name) {
      if (name === 'bind') return (...params: unknown[]) => wrap(target.bind(...params));
      if (name === 'first' || name === 'all') return async (...args: unknown[]) => {
        reads++;
        // Same simulated D1 round trip for cached and uncached runs.
        await new Promise(resolve => setTimeout(resolve, 2));
        return Reflect.apply(target[name], target, args);
      };
      const value: unknown = Reflect.get(target, name, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const source = new Proxy(db, {
    get(target, name) {
      if (name === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      const value: unknown = Reflect.get(target, name, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db: source, count: () => reads };
}

test('same-data SQL/latency comparison retains dashboard and daily-comparison responses', async () => {
  const original = cache.withDisplayReadCache;
  for (const [name, calculate] of [
    ['dashboard', (db: D1Database) => getDashboardOverview(db, 'today', { allowedAccountIds: ['a'], includeUnassigned: false })],
    ['comparison', (db: D1Database) => comparisonData(db, [{ id: 'a' }], 't', { from: '2026-10-17', to: '2026-10-17' })],
  ] as const) {
    const measurements: Array<{ cached: boolean; sql: number; ms: number }> = [];
    let expected: unknown;
    for (const enabled of [false, true]) {
      const spy = vi.spyOn(cache, 'withDisplayReadCache').mockImplementation(enabled ? original : async (db, calculate) => calculate(db));
      const m = measuredDb(d.db), start = performance.now();
      const result = await calculate(m.db);
      measurements.push({ cached: enabled, sql: m.count(), ms: performance.now() - start });
      if (!enabled) expected = result;
      else expect(result).toEqual(expected);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    }
    process.stdout.write(JSON.stringify({ benchmark: name, simulatedD1Ms: 2, measurements }) + '\n');
    expect(measurements[1].sql).toBeLessThan(measurements[0].sql);
  }
});

test('style analytics/schedule have identical outputs with cache enabled or bypassed', async () => {
  const original = cache.withDisplayReadCache;
  const calculate: Array<[string, (db: D1Database) => Promise<unknown>]> = [
    ['analytics', async db => {
      const { resultId: _resultId, ...data } = await styleSnapshot(db, 'a', 'salon', {}, undefined, Date.now(), { kinds: ['booking'] });
      return data;
    }],
    ['schedule', async db => styleSchedule(db, 'a', { style: 'salon', ...await styleWindow(db, 'a', {}) }, {}, undefined, undefined, { kinds: ['booking'] })],
  ];
  for (const [name, run] of calculate) {
    let expected: unknown;
    const measurements = [];
    for (const enabled of [false, true]) {
      const spy = vi.spyOn(cache, 'withDisplayReadCache').mockImplementation(enabled ? original : async (db, calculate) => calculate(db));
      const m = measuredDb(d.db), start = performance.now();
      const result = await run(m.db);
      measurements.push({ cached: enabled, sql: m.count(), ms: performance.now() - start });
      if (enabled) expect(result).toEqual(expected);
      else expected = result;
      spy.mockRestore();
    }
    expect(measurements[1].sql).toBeLessThanOrEqual(measurements[0].sql);
    process.stdout.write(JSON.stringify({ benchmark: name, simulatedD1Ms: 2, measurements }) + '\n');
  }
});

test('style cache retains rights/kinds, staff, filtering and creates fresh audience results', async () => {
  const now = Date.now();
  const a = await styleSnapshot(d.db, 'a', 'salon', {}, undefined, now, { kinds: ['booking'] });
  const b = await styleSnapshot(d.db, 'a', 'salon', {}, undefined, now, { kinds: [] });
  expect(a.items.map(x => x.id)).toContain('booking');
  expect(b.items).toEqual([]); expect(b.newBookings).toEqual([]);
  expect(a.resultId).not.toBe(b.resultId);
  const own = await styleSnapshot(d.db, 'a', 'salon', {}, 'bs2', now, { kinds: ['booking'] });
  expect(own.items).toEqual([]);
  const other = await styleSnapshot(d.db, 'b', 'salon', {}, undefined, now, { kinds: ['booking'] });
  expect(other.items).toEqual([]);
  d.raw.exec("UPDATE bookings SET status='cancelled',lock_version=lock_version+1 WHERE id='booking'");
  const next = await styleSnapshot(d.db, 'a', 'salon', {}, undefined, now, { kinds: ['booking'] });
  expect(next.items.find(x => x.id === 'booking')?.status).toBe('cancelled');
  expect(fetch).not.toHaveBeenCalled();
});

test('schedule rechecks live rows and resolves timezone/day boundaries on every calculation', async () => {
  const window = await styleWindow(d.db, 'a', {});
  const snapshot = { style: 'salon' as const, ...window };
  const first = await styleSchedule(d.db, 'a', snapshot, {}, undefined, undefined, { kinds: ['booking'] });
  expect(first.entries.map(x => x.id)).toContain('booking:booking');
  expect(first.availability).toMatchObject({ status: 'unconfigured', reason: 'business_hours_required' });
  const restricted = await styleSchedule(d.db, 'a', snapshot, {}, undefined, undefined, { kinds: [] });
  expect(restricted.entries).toEqual([]);
  d.raw.exec("UPDATE booking_settings SET timezone='America/Los_Angeles' WHERE line_account_id='a'");
  const local = await styleWindow(d.db, 'a', {}, Date.parse('2026-10-18T00:30:00Z'));
  expect(local.fromDate).toBe('2026-10-17'); expect(local.timeZone).toBe('America/Los_Angeles');
  const tokyo = await styleWindow(d.db, 'b', {}, Date.parse('2026-10-18T00:30:00Z'));
  expect(tokyo.fromDate).toBe('2026-10-18');
  expect(fetch).not.toHaveBeenCalled();
});
