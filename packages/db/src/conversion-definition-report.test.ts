import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getConversionDefinitionReport,
  getConversionReport,
} from './conversion-definitions.js';

/*
 * R284/R285: レポートの取消集計の回帰試験。実SQLiteで実SQLを回す。
 * - R284: 合計・日別・経路別・地点別は同じ取消集合から引く。総数と純数を別に持つ。
 * - R285: 取消・再計上は選んでいるアカウントの範囲だけで数える。
 * 取消の正本は「成果単位」: 報酬の取消調整が付いた成果、または取消台帳の
 * 最新が reverse の成果を除く(restore が最新なら数え直しに戻る)。
 * 期間の区切りは成果の発生日。報酬調整は成果1件の取消として記録額で除く
 * (調整額ではなく成果額。一覧の取消表示と一致させる)。
 */

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

const RANGE = { from: '2026-09-01', to: '2026-09-30' };
const PREVIOUS = { from: '2026-08-01', to: '2026-08-31' };
const SCOPE_A = { allowedAccountIds: ['account-A'], includeUnassigned: false };

function seed(): void {
  sqlite.exec(`
    CREATE TABLE conversion_points(id TEXT, name TEXT, event_type TEXT, line_account_id TEXT);
    CREATE TABLE conversion_events(id TEXT, conversion_point_id TEXT, value_snapshot INTEGER, attributed_ref_code TEXT, created_at TEXT);
    CREATE TABLE conversion_event_reversals(id TEXT, conversion_event_id TEXT, kind TEXT, created_at TEXT);
    CREATE TABLE affiliate_adjustments(id TEXT, source_entry_id TEXT, reason_type TEXT, amount_minor INTEGER, created_at TEXT);
    CREATE TABLE affiliate_reward_entries(id TEXT, conversion_event_id TEXT);
    CREATE TABLE friends(id TEXT, line_account_id TEXT);
    CREATE TABLE ref_tracking(ref_code TEXT, friend_id TEXT, created_at TEXT);
    INSERT INTO conversion_points VALUES
      ('point-A', 'Synthetic A', 'purchase', 'account-A'),
      ('point-B', 'Synthetic B', 'purchase', 'account-B');
    INSERT INTO conversion_events VALUES
      ('a1', 'point-A', 1000, 'route-1', '2026-09-20 10:00:00'),
      ('a2', 'point-A', 1000, 'route-1', '2026-09-20 11:00:00'),
      ('a3', 'point-A', 500, 'route-2', '2026-09-21 10:00:00'),
      ('b1', 'point-B', 9000, 'route-B', '2026-09-20 10:00:00');
    INSERT INTO friends VALUES
      ('friend-a1', 'account-A'), ('friend-a2', 'account-A'),
      ('friend-a3', 'account-A'), ('friend-b1', 'account-B');
    INSERT INTO ref_tracking VALUES
      ('route-1', 'friend-a1', '2026-09-20'), ('route-1', 'friend-a2', '2026-09-20'),
      ('route-2', 'friend-a3', '2026-09-21'), ('route-B', 'friend-b1', '2026-09-20');
  `);
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  db = asD1(sqlite);
  seed();
});

function report(scope = SCOPE_A, lineAccountId: string | null = 'account-A') {
  return getConversionDefinitionReport(db, {
    scope,
    // 既定はAだけを見る。未指定にしたい試験は第2引数に null を渡す。
    lineAccountId: lineAccountId ?? undefined,
    range: { ...RANGE, timeZone: 'Asia/Tokyo' },
    previousRange: { ...PREVIOUS, timeZone: 'Asia/Tokyo' },
  });
}

const sum = (rows: Array<{ netCount: number; netValue: number }>) => ({
  count: rows.reduce((total, row) => total + row.netCount, 0),
  value: rows.reduce((total, row) => total + row.netValue, 0),
});

describe('R284 取消は全断面で同じ集合から引く', () => {
  it('1件を取り消すと純成果は全断面で2件1500円、総数は3件2500円', async () => {
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('reverse-a1', 'a1', 'reverse', '2026-09-22 10:00:00')`);
    const data = await report();
    expect(data.kpis.netCount).toBe(2);
    expect(data.kpis.netValue).toBe(1500);
    expect(data.kpis.recordedCount).toBe(3);
    expect(data.kpis.recordedValue).toBe(2500);
    expect(data.kpis.cancellationCount).toBe(1);
    expect(data.kpis.cancellationValue).toBe(1000);
    expect(sum(data.daily)).toEqual({ count: 2, value: 1500 });
    expect(sum(data.byRoute)).toEqual({ count: 2, value: 1500 });
    const point = data.byDefinition.find((row) => row.conversionPointId === 'point-A');
    expect(point?.netCount).toBe(2);
    expect(point?.netValue).toBe(1500);
    expect(point?.cancellationCount).toBe(1);
    const route1 = data.byRoute.find((row) => row.routeKey === 'route-1');
    expect(route1?.netCount).toBe(1);
    expect(route1?.netValue).toBe(1000);
    expect(route1?.audience).toBe(2);
    expect(route1?.conversionRate).toBe(50);
  });

  it('再計上(restore)すると数え直しに戻り取消は消える', async () => {
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('reverse-a1', 'a1', 'reverse', '2026-09-22 10:00:00')`);
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('restore-a1', 'a1', 'restore', '2026-09-23 10:00:00')`);
    const data = await report();
    expect(data.kpis.netCount).toBe(3);
    expect(data.kpis.netValue).toBe(2500);
    expect(data.kpis.cancellationCount).toBeNull();
    expect(data.kpis.cancellationValue).toBeNull();
    expect(sum(data.daily)).toEqual({ count: 3, value: 2500 });
    expect(sum(data.byRoute)).toEqual({ count: 3, value: 2500 });
  });

  it('別期間の成果の取消はその期間の純数から引き、見ている期間の取消には混ぜない', async () => {
    sqlite.exec(`INSERT INTO conversion_events VALUES('a0', 'point-A', 700, 'route-1', '2026-08-10 10:00:00')`);
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('reverse-a0', 'a0', 'reverse', '2026-09-22 10:00:00')`);
    const data = await report();
    // 9月の取消は0。8月の1件は8月の純数から除く(前期間の純数0)。
    expect(data.kpis.netCount).toBe(3);
    expect(data.kpis.cancellationCount).toBeNull();
    expect(data.kpis.previousNetCount).toBe(0);
  });

  it('報酬の取消調整は成果1件の取消として記録額で除く', async () => {
    sqlite.exec(`INSERT INTO affiliate_reward_entries VALUES('reward-a1', 'a1')`);
    sqlite.exec(`INSERT INTO affiliate_adjustments VALUES('cancel-reward-a1', 'reward-a1', 'cancel', -300, '2026-09-22 10:00:00')`);
    const data = await report();
    expect(data.kpis.netCount).toBe(2);
    expect(data.kpis.netValue).toBe(1500);
    expect(data.kpis.cancellationCount).toBe(1);
    expect(data.kpis.cancellationValue).toBe(1000);
    expect(sum(data.daily)).toEqual({ count: 2, value: 1500 });
  });

  it('台帳が無い環境では取消を0に倒し、純数=総数で壊さない', async () => {
    sqlite.exec(`DROP TABLE conversion_event_reversals; DROP TABLE affiliate_adjustments; DROP TABLE affiliate_reward_entries;`);
    const data = await report();
    expect(data.kpis.netCount).toBe(3);
    expect(data.kpis.netValue).toBe(2500);
    expect(data.kpis.reversalState).toBe('unavailable');
    expect(sum(data.daily)).toEqual({ count: 3, value: 2500 });
  });
});

describe('R285 取消は選んでいるアカウントの範囲だけで数える', () => {
  it('Aだけの権限ではBの取消・再計上がAの応答を変えない', async () => {
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('reverse-a1', 'a1', 'reverse', '2026-09-22 10:00:00')`);
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('reverse-b1', 'b1', 'reverse', '2026-09-22 10:00:00')`);
    const data = await report();
    expect(data.kpis.netCount).toBe(2);
    expect(data.kpis.cancellationCount).toBe(1);
    expect(data.kpis.cancellationValue).toBe(1000);
    expect(data.byDefinition.map((row) => row.conversionPointId)).toEqual(['point-A']);

    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('restore-a1', 'a1', 'restore', '2026-09-23 10:00:00')`);
    const restored = await report();
    expect(restored.kpis.netCount).toBe(3);
    expect(restored.kpis.cancellationCount).toBeNull();
    expect(restored.kpis.cancellationValue).toBeNull();
  });

  it('複数アカウント権限では両方の取消を数える', async () => {
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('reverse-a1', 'a1', 'reverse', '2026-09-22 10:00:00')`);
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('reverse-b1', 'b1', 'reverse', '2026-09-22 10:00:00')`);
    const data = await report(
      { allowedAccountIds: ['account-A', 'account-B'], includeUnassigned: false },
      null,
    );
    expect(data.kpis.netCount).toBe(2);
    expect(data.kpis.cancellationCount).toBe(2);
    expect(data.kpis.cancellationValue).toBe(10000);
  });

  it('未割当の地点はincludeUnassignedのときだけ数える', async () => {
    sqlite.exec(`INSERT INTO conversion_points VALUES('point-free', 'Unassigned', 'purchase', NULL)`);
    sqlite.exec(`INSERT INTO conversion_events VALUES('f1', 'point-free', 400, 'route-1', '2026-09-20 10:00:00')`);
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('reverse-f1', 'f1', 'reverse', '2026-09-22 10:00:00')`);
    const excluded = await report();
    expect(excluded.kpis.netCount).toBe(3);
    expect(excluded.kpis.cancellationCount).toBeNull();
    const included = await report(
      { allowedAccountIds: ['account-A'], includeUnassigned: true },
      null,
    );
    expect(included.kpis.netCount).toBe(3);
    expect(included.kpis.cancellationCount).toBe(1);
    expect(included.kpis.cancellationValue).toBe(400);
  });

  it('旧形式の応答は範囲内の総数を返す', async () => {
    sqlite.exec(`INSERT INTO conversion_event_reversals VALUES('reverse-a1', 'a1', 'reverse', '2026-09-22 10:00:00')`);
    const rows = await getConversionReport(db, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      scope: SCOPE_A,
    });
    expect(rows.map((row) => row.conversionPointId)).toEqual(['point-A']);
    expect(rows.find((row) => row.conversionPointId === 'point-A')).toMatchObject({
      totalCount: 3,
      totalValue: 2500,
    });
  });
});
