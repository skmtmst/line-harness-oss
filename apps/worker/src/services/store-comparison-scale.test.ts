import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { gapFixture } from '../test-utils/gap1.js';
import { comparisonData } from './store-comparison-export.js';
import { comparisonKeys, comparisonPeriod, storeNumbers } from './store-comparison.js';
import { readStoreComparisonNumbers } from './store-comparison-reads.js';

let fixture: ReturnType<typeof gapFixture>;
beforeEach(() => { fixture = gapFixture(); });
afterEach(() => { fixture.raw.close(); vi.restoreAllMocks(); });
const period = comparisonPeriod('2026-10-01', '2026-10-02');
const previous = comparisonPeriod('2026-09-29', '2026-09-30');

function seed(count: number, observations = true) {
  const ids = Array.from({ length: count }, (_, i) => 'scale-' + String(i).padStart(5, '0'));
  const account = fixture.raw.prepare(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id)
    VALUES(?,?,?,'synthetic','synthetic','t')`);
  const daily = fixture.raw.prepare(`INSERT INTO hq_store_daily_metrics(account_id,date,friends_added,friends_blocked,friends_at_start,broadcast_recipients,broadcast_clicks,bookings,visits,no_shows,state,computed_at)
    VALUES(?,?,2,1,?,?,1,?,4,1,?,'2026-10-03T00:00:00Z')`);
  const sample = fixture.raw.prepare(`INSERT INTO hq_store_response_samples(account_id,chat_id,pending_since,responded_at,minutes) VALUES(?,?,?,?,?)`);
  fixture.raw.transaction(() => {
    ids.forEach((id, i) => {
      account.run(id, id, 'Synthetic ' + i);
      if (i % 2 === 0) fixture.raw.prepare("INSERT INTO account_styles(line_account_id,style,selection_mode,updated_at) VALUES(?,'salon','configured','now')").run(id);
      if (!observations) return;
      ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].forEach((day, n) => {
        if (i % 7 === 0 && n === 3) return;
        daily.run(id, day, n % 2 === 0 ? 100 : 200, i % 5 === 0 ? 0 : 10,
          i % 13 === 0 && n === 2 ? null : i % 9 + n, i % 11 === 0 && n === 2 ? 'failed' : 'partial');
      });
      sample.run(id, 'chat-' + id, 'previous-1', '2026-09-29T00:00:00+09:00', i + 1);
      sample.run(id, 'chat-' + id, 'previous-2', '2026-09-29T01:00:00+09:00', i + 4);
      sample.run(id, 'chat-' + id, 'previous-3', '2026-09-30T01:00:00+09:00', i + 100);
      sample.run(id, 'chat-' + id, 'current-1', '2026-09-30T15:00:00Z', i + 2);
      sample.run(id, 'chat-' + id, 'current-2', '2026-10-02T01:00:00+09:00', i + 9);
      sample.run(id, 'chat-' + id, 'outside', '2026-10-03T00:00:00+09:00', 99999);
    });
    daily.run('b', '2026-10-01', 100, 10, 999999, 'ready');
    daily.run('b', '2026-10-02', 100, 10, 999999, 'ready');
  })();
  return ids;
}

test('160店舗の集計・欠測・失敗・NULLと期間の実中央値が従来の単店集計と一致する', async () => {
  const ids = seed(160);
  for (const range of [period, previous]) {
    const prepare = vi.spyOn(fixture.db, 'prepare');
    const bulk = await readStoreComparisonNumbers(fixture.db, ids, range);
    expect(prepare).toHaveBeenCalledTimes(1);
    prepare.mockRestore();
    expect(bulk.size).toBe(ids.length);
    expect(bulk.has('b')).toBe(false);
    for (const id of ids) {
      const expected = await storeNumbers(fixture.db, id, range);
      expect(bulk.get(id)).toMatchObject({ style: expected.style, computedAt: expected.computedAt, values: expected.values });
    }
  }
});

test('160店舗を並べた先頭20件と次の20件、前期間差と平均との差を維持する', async () => {
  const ids = seed(160), accounts = ids.map(id => ({ id }));
  const current = new Map(await Promise.all(ids.map(async id => [id, await storeNumbers(fixture.db, id, period)] as const)));
  const prior = new Map(await Promise.all(ids.map(async id => [id, await storeNumbers(fixture.db, id, previous)] as const)));
  const expectedAverage = Object.fromEntries(comparisonKeys.map(key => {
    const values = ids.map(id => current.get(id)!.values[key]).filter((value): value is number => value !== null);
    return [key, values.length >= 3 ? values.reduce((sum, value) => sum + value, 0) / values.length : null];
  }));
  const sorted = [...ids].sort((a, b) => {
    const x = current.get(a)!.values.bookings, y = current.get(b)!.values.bookings;
    return x === null ? y === null ? a.localeCompare(b) : 1 : y === null ? -1 : y - x || a.localeCompare(b);
  });
  for (const compare of ['previous', 'average']) {
    for (const page of [1, 2]) {
      const prepare = vi.spyOn(fixture.db, 'prepare');
      const result = await comparisonData(fixture.db, accounts, 't', { from: period.from, to: period.to, compare, page: String(page), order: 'desc' });
      expect(prepare).toHaveBeenCalledTimes(compare === 'previous' ? 2 : 1);
      prepare.mockRestore();
      expect(result.rows.map(row => row.accountId)).toEqual(sorted.slice((page - 1) * 20, page * 20));
      expect(result.average).toEqual(expectedAverage);
      expect(result.total).toBe(160);
      expect(result.computedAt).toBeNull();
      for (const row of result.rows) for (const key of comparisonKeys) {
        const value = current.get(row.accountId)!.values[key];
        const baseline = compare === 'previous' ? prior.get(row.accountId)!.values[key] : expectedAverage[key];
        expect(row.metrics[key]).toMatchObject({ value, diff: value !== null && baseline !== null ? value - baseline : null, available: value !== null });
      }
    }
  }
});

test('5000店舗でも前期間比較は2SQL、日別履歴を返さずページ分だけ返す', async () => {
  const ids = seed(5000, false), prepare = vi.spyOn(fixture.db, 'prepare');
  const result = await comparisonData(fixture.db, ids.map(id => ({ id })), 't', { from: period.from, to: period.to });
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(result.total).toBe(5000);
  expect(result.rows).toHaveLength(20);
  expect(result.rows.map(row => row.accountId)).toEqual(ids.slice(0, 20));
  expect(result.rows.every(row => Object.values(row.metrics).every(metric => metric.value === null))).toBe(true);
});

test('可視店なしはSQLなし、3店未満の平均はnull、読み取り失敗は成功しない', async () => {
  const prepare = vi.spyOn(fixture.db, 'prepare');
  expect(await comparisonData(fixture.db, [], 't', { from: period.from, to: period.to })).toMatchObject({ rows: [], total: 0, computedAt: null });
  expect(prepare).not.toHaveBeenCalled();
  const ids = seed(2);
  const result = await comparisonData(fixture.db, ids.map(id => ({ id })), 't', { from: previous.from, to: previous.to, compare: 'average' });
  expect(Object.values(result.average).every(value => value === null)).toBe(true);
  fixture.raw.exec('ALTER TABLE hq_store_daily_metrics RENAME TO unavailable_metrics');
  await expect(comparisonData(fixture.db, ids.map(id => ({ id })), 't', { from: period.from, to: period.to })).rejects.toThrow();
});
