import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createAnalyticsCrossAudience,
  createAnalyticsCrossRun,
  evaluateAnalyticsCross,
  getAnalyticsCrossRun,
  processAnalyticsCrossRun,
  recoverStalledAnalyticsCrossRuns,
  validateAnalyticsCrossQuery,
} from '../src/analytics-cross.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() { return { results: statement.all(...params) as T[], success: true, meta: {} }; },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      const results: unknown[] = [];
      sqlite.transaction(() => {
        for (const statement of statements) results.push(statement.run());
      })();
      return Promise.all(results) as T;
    },
  } as unknown as D1Database;
}

const BASE_QUERY = {
  rowAxis: { kind: 'route' },
  columnAxis: { kind: 'tag' },
  measure: { kind: 'unique_friends' },
  filters: [],
  periodFrom: '2026-08-01T00:00:00.000Z',
  periodTo: '2026-08-07T23:59:59.999Z',
};

describe('V6クロス分析', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts (
         id, channel_id, name, channel_access_token, channel_secret, timezone
       ) VALUES ('account-a','ca','A','ta','sa','Asia/Tokyo'),
                ('account-b','cb','B','tb','sb','Asia/Tokyo')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO entry_routes (id, ref_code, name) VALUES ('route-1','r1','広告A')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id, ref_code, score)
       VALUES ('friend-a','Ua','account-a','r1',60),
              ('friend-b','Ub','account-a',NULL,10),
              ('friend-x','Ux','account-b','r1',60)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tags (id, name, line_account_id)
       VALUES ('tag-1','申込済み','account-a'), ('tag-2','未使用','account-a')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friend_tags (friend_id, tag_id) VALUES ('friend-a','tag-1')`,
    ).run();
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('軸・15条件・期間・任意イベントを許可一覧で検証する', () => {
    expect(validateAnalyticsCrossQuery({ ...BASE_QUERY, timeZone: 'Asia/Tokyo' }))
      .toMatchObject({ rowAxis: { kind: 'route' }, filters: [] });
    expect(() => validateAnalyticsCrossQuery({
      ...BASE_QUERY, timeZone: 'Asia/Tokyo', rowAxis: { kind: 'raw_sql' },
    })).toThrow('analytics_cross_axis_unknown:raw_sql');
    expect(() => validateAnalyticsCrossQuery({
      ...BASE_QUERY,
      timeZone: 'Asia/Tokyo',
      filters: Array.from({ length: 16 }, () => ({
        axis: { kind: 'tag' }, operator: 'include', valueKeys: ['tag-1'],
      })),
    })).toThrow('analytics_cross_filters_max_15');
  });

  it('選択ますでは同じ友だちを1回だけ数える', () => {
    const axis = {
      valuesByFriend: new Map([
        ['friend-a', new Set(['a'])],
        ['friend-b', new Set(['b'])],
      ]),
      labels: new Map([['a', 'A'], ['b', 'B']]),
      missing: { key: '__none__', label: '未設定' },
    };
    const result = evaluateAnalyticsCross({
      friendIds: ['friend-a', 'friend-b'], row: axis, column: axis, filters: [],
      previousRow: axis, previousColumn: axis, previousFilters: [],
      measureByFriend: new Map([['friend-a', 1], ['friend-b', 1]]),
      previousMeasureByFriend: new Map([['friend-a', 1], ['friend-b', 1]]),
    });
    expect(result.cells.find((cell) => cell.rowKey === 'a' && cell.columnKey === 'a'))
      .toMatchObject({ value: 1, uniqueFriends: 1, difference: 0 });
  });

  it('非同期実行し、別アカウントを混ぜず、不変結果から24時間対象者を作る', async () => {
    const queued = await createAnalyticsCrossRun(db, {
      lineAccountId: 'account-a', query: BASE_QUERY, timeZone: 'Asia/Tokyo',
      dataCutoffAt: '2026-08-08T00:00:00.000Z', createdBy: 'staff-1',
    });
    expect(queued.state).toBe('pending');
    const result = await processAnalyticsCrossRun(db, queued.id);
    expect(result).toMatchObject({ state: 'available', totalFriends: 2, totalValue: 2 });
    expect(result.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowLabel: '広告A', columnLabel: '申込済み', value: 1 }),
      expect.objectContaining({ rowLabel: '経路不明', columnLabel: 'タグなし', value: 1 }),
    ]));
    const stored = await getAnalyticsCrossRun(db, 'account-a', queued.id);
    expect(stored?.state).toBe('available');
    expect(await getAnalyticsCrossRun(db, 'account-b', queued.id)).toBeNull();
    const targetCell = result.cells.find((cell) => cell.value === 1 && cell.rowLabel === '広告A')!;
    const audience = await createAnalyticsCrossAudience(db, {
      lineAccountId: 'account-a', runId: queued.id,
      rowKey: targetCell.rowKey, columnKey: targetCell.columnKey,
      now: new Date('2026-08-08T00:00:00.000Z'),
    });
    expect(audience).toMatchObject({ memberCount: 1, expiresAt: '2026-08-09T00:00:00.000Z' });
    expect(sqlite.prepare(
      `SELECT friend_id FROM analytics_result_audience_members WHERE audience_id = ?`,
    ).all(audience.id)).toEqual([{ friend_id: 'friend-a' }]);
    expect(() => sqlite.prepare(
      `UPDATE analytics_cross_runs SET result_json = '{}' WHERE id = ?`,
    ).run(queued.id)).toThrow('analytics_cross_run_immutable');
  });

  it('必要な行動履歴が未接続なら0件ではなく取得不可にする', async () => {
    const queued = await createAnalyticsCrossRun(db, {
      lineAccountId: 'account-a',
      query: { ...BASE_QUERY, rowAxis: { kind: 'behavior', eventType: 'url_clicked' } },
      timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-08-08T00:00:00.000Z',
    });
    const result = await processAnalyticsCrossRun(db, queued.id);
    expect(result).toMatchObject({
      state: 'unavailable', totalValue: 0,
      stateReason: expect.stringContaining('url_clicked'),
    });
  });

  it('有効だが該当者0人の条件を参照切れにしない', async () => {
    const queued = await createAnalyticsCrossRun(db, {
      lineAccountId: 'account-a',
      query: {
        ...BASE_QUERY,
        filters: [{ axis: { kind: 'tag' }, operator: 'include', valueKeys: ['tag-2'] }],
      },
      timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-08-08T00:00:00.000Z',
    });
    const result = await processAnalyticsCrossRun(db, queued.id);
    expect(result).toMatchObject({ state: 'available', totalFriends: 0, totalValue: 0 });
  });

  it('延べ件数ではイベント数を数え、セルの友だちは重複させない', async () => {
    sqlite.prepare(
      `INSERT INTO analytics_event_coverage (
         line_account_id, event_type, available_from, state, updated_at
       ) VALUES ('account-a','message_received','2026-07-01T00:00:00.000Z','available','2026-08-08')`,
    ).run();
    const insert = sqlite.prepare(
      `INSERT INTO analytics_events (
         id, line_account_id, friend_id, event_type, source_kind, source_id,
         occurred_at, dimensions_json, idempotency_key
       ) VALUES (?, 'account-a', 'friend-a', 'message_received', 'test', ?, ?, '{}', ?)`,
    );
    insert.run('event-1', 'm1', '2026-08-02T00:00:00.000Z', 'm1');
    insert.run('event-2', 'm2', '2026-08-03T00:00:00.000Z', 'm2');
    const queued = await createAnalyticsCrossRun(db, {
      lineAccountId: 'account-a',
      query: {
        ...BASE_QUERY,
        measure: { kind: 'events', eventType: 'message_received' },
      },
      timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-08-08T00:00:00.000Z',
    });
    const result = await processAnalyticsCrossRun(db, queued.id);
    expect(result).toMatchObject({ state: 'available', totalFriends: 1, totalValue: 2 });
    expect(result.cells.find((cell) => cell.rowLabel === '広告A' && cell.columnLabel === '申込済み'))
      .toMatchObject({ value: 2, uniqueFriends: 1 });
  });

  it('許可した10種類の軸を実データから読み、自由文は軸にしない', async () => {
    sqlite.exec(`
      INSERT INTO friend_fields (
        id, name, field_key, type, options_json, is_personal
      ) VALUES ('field-1','プラン','plan','select','["A","B"]',0);
      INSERT INTO friend_field_values (friend_id, field_id, value)
        VALUES ('friend-a','field-1','A');
      INSERT INTO scenarios (id, name, trigger_type, line_account_id)
        VALUES ('scenario-1','案内','manual','account-a');
      INSERT INTO friend_scenarios (
        id, friend_id, scenario_id, status
      ) VALUES ('fs-1','friend-a','scenario-1','active');
      INSERT INTO forms (id, name, fields)
        VALUES ('form-1','申込','[{"name":"plan","type":"radio","options":["A","B"]}]');
      INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
        VALUES ('sub-1','form-1','friend-a','{"plan":"A"}','2026-08-02T09:00:00.000+09:00');
      INSERT INTO conversion_points (id, name, event_type, line_account_id)
        VALUES ('point-1','購入','purchase','account-a');
      INSERT INTO staff (id, line_account_id, name, display_name)
        VALUES ('staff-1','account-a','担当','担当');
      INSERT INTO menus (id, line_account_id, name, duration_minutes, base_price)
        VALUES ('menu-1','account-a','相談',60,0);
      INSERT INTO bookings (
        id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
        block_ends_at, status, price_at_booking, requested_at
      ) VALUES (
        'booking-1','account-a','friend-a','staff-1','menu-1',
        '2026-08-03T00:00:00.000Z','2026-08-03T01:00:00.000Z',
        '2026-08-03T01:00:00.000Z','confirmed',0,'2026-08-01T00:00:00.000Z'
      );
    `);
    const coverage = sqlite.prepare(
      `INSERT INTO analytics_event_coverage (
         line_account_id, event_type, available_from, state, updated_at
       ) VALUES ('account-a',?,'2026-07-01T00:00:00.000Z','available','2026-08-08')`,
    );
    for (const type of [
      'conversion_approved', 'ec.order.confirmed', 'ec.order.shipped',
      'ec.subscription.upcoming', 'ec.subscription.payment_failed',
      'ec.subscription.cancelled',
    ]) coverage.run(type);
    const eventInsert = sqlite.prepare(
      `INSERT INTO analytics_events (
         id, line_account_id, friend_id, event_type, source_kind, source_id,
         occurred_at, dimensions_json, idempotency_key
       ) VALUES (?, 'account-a', 'friend-a', ?, 'test', ?,
                 '2026-08-03T00:00:00.000Z', ?, ?)`,
    );
    eventInsert.run('conversion-1', 'conversion_approved', 'conversion-1',
      '{"conversionPointId":"point-1"}', 'conversion-1');
    eventInsert.run('purchase-1', 'ec.order.confirmed', 'purchase-1',
      '{"status":"confirmed"}', 'purchase-1');

    const axes: Array<{ axis: unknown; expected: string }> = [
      { axis: { kind: 'field_choice', fieldId: 'field-1' }, expected: 'A' },
      { axis: { kind: 'score_band' }, expected: '50〜99' },
      { axis: { kind: 'scenario_status', scenarioId: 'scenario-1' }, expected: '進行中' },
      { axis: { kind: 'form_choice', formId: 'form-1', fieldKey: 'plan' }, expected: 'A' },
      { axis: { kind: 'conversion_point' }, expected: '購入' },
      { axis: { kind: 'booking_status' }, expected: '確定' },
      { axis: { kind: 'purchase_status' }, expected: '注文確定' },
    ];
    for (const item of axes) {
      const queued = await createAnalyticsCrossRun(db, {
        lineAccountId: 'account-a',
        query: { ...BASE_QUERY, rowAxis: item.axis, columnAxis: { kind: 'score_band' } },
        timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-08-08T00:00:00.000Z',
      });
      const result = await processAnalyticsCrossRun(db, queued.id);
      expect(result.rowValues.map((value) => value.label), JSON.stringify(item.axis))
        .toContain(item.expected);
    }
    sqlite.prepare(
      `INSERT INTO friend_fields (
         id, name, field_key, type, options_json, is_personal
       ) VALUES ('personal-1','本名','real_name','text',NULL,1)`,
    ).run();
    await expect(createAnalyticsCrossRun(db, {
      lineAccountId: 'account-a',
      query: { ...BASE_QUERY, rowAxis: { kind: 'field_choice', fieldId: 'personal-1' } },
      timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-08-08T00:00:00.000Z',
    }).then((queued) => processAnalyticsCrossRun(db, queued.id)))
      .rejects.toThrow('analytics_cross_field_reference_missing');
  });

  it('取得開始前を含む行動履歴は部分データと明示する', async () => {
    sqlite.prepare(
      `INSERT INTO analytics_event_coverage (
         line_account_id, event_type, available_from, state, updated_at
       ) VALUES ('account-a','url_clicked','2026-08-01T00:00:00.000Z','available','2026-08-08')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO analytics_events (
         id, line_account_id, friend_id, event_type, source_kind, source_id,
         occurred_at, dimensions_json, idempotency_key
       ) VALUES ('event-1','account-a','friend-a','url_clicked','test','click-1',
                 '2026-08-02T00:00:00.000Z','{}','click-1')`,
    ).run();
    const queued = await createAnalyticsCrossRun(db, {
      lineAccountId: 'account-a',
      query: { ...BASE_QUERY, rowAxis: { kind: 'behavior', eventType: 'url_clicked' } },
      timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-08-08T00:00:00.000Z',
    });
    const result = await processAnalyticsCrossRun(db, queued.id);
    expect(result).toMatchObject({ state: 'partial', totalFriends: 2 });
  });

  it('まだ到来していない期間を0件にせず部分データにする', async () => {
    const queued = await createAnalyticsCrossRun(db, {
      lineAccountId: 'account-a', query: BASE_QUERY, timeZone: 'Asia/Tokyo',
      dataCutoffAt: '2026-08-04T00:00:00.000Z',
    });
    const result = await processAnalyticsCrossRun(db, queued.id);
    expect(result).toMatchObject({
      state: 'partial', stateReason: expect.stringContaining('対象期間の途中'),
    });
  });

  it('10分止まった処理だけをpendingへ戻す', async () => {
    const queued = await createAnalyticsCrossRun(db, {
      lineAccountId: 'account-a', query: BASE_QUERY, timeZone: 'Asia/Tokyo',
      dataCutoffAt: '2026-08-08T00:00:00.000Z',
    });
    sqlite.prepare(
      `UPDATE analytics_cross_runs SET state = 'running', started_at = '2026-08-08T00:00:00.000Z'
        WHERE id = ?`,
    ).run(queued.id);
    expect(await recoverStalledAnalyticsCrossRuns(
      db, new Date('2026-08-08T00:11:00.000Z'),
    )).toBe(1);
    expect(sqlite.prepare(`SELECT state FROM analytics_cross_runs WHERE id = ?`)
      .get(queued.id)).toEqual({ state: 'pending' });
  });
});
