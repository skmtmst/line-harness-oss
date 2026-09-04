import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordAnalyticsEvent } from '../src/analytics-events.js';
import {
  rebuildAnalyticsDailyMetrics,
  rebuildAnalyticsDailyMetricsChunk,
  getAnalyticsProjectionSchedulerCursor,
  purgeExpiredAnalyticsReadData,
  recentAnalyticsProjectionRange,
  saveAnalyticsProjectionSchedulerCursor,
} from '../src/analytics-projection.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database, queries?: string[]): D1Database {
  function prepare(query: string): D1PreparedStatement {
    queries?.push(query);
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
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

describe('V6分析イベントと日別投影', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts (
         id, channel_id, name, channel_access_token, channel_secret, timezone
       ) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
    ).run(
      'account-a', 'channel-a', 'A店', 'token-a', 'secret-a', 'Asia/Tokyo',
      'account-b', 'channel-b', 'B店', 'token-b', 'secret-b', 'Asia/Tokyo',
    );
    sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id)
       VALUES ('friend-a', 'line-user-a', 'account-a'),
              ('friend-b', 'line-user-b', 'account-b')`,
    ).run();
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('本文やURLを保存せず、許可した分析項目だけを残す', async () => {
    const event = await recordAnalyticsEvent(db, {
      lineAccountId: 'account-a',
      friendId: 'friend-a',
      eventType: 'message_received',
      sourceKind: 'line_webhook',
      sourceId: 'webhook-1',
      occurredAt: '2026-08-25T23:30:00.000Z',
      dimensions: {
        messageType: 'text',
        matched: true,
        text: '顧客が入力した本文',
        url: 'https://example.com/?secret=1',
      },
    });

    expect(event.dimensions).toEqual({ messageType: 'text', matched: true });
    expect(JSON.stringify(event)).not.toContain('顧客が入力した本文');
    expect(JSON.stringify(event)).not.toContain('secret=1');
  });

  it('再配達された同じ発生元は同じ1件を返す', async () => {
    const input = {
      lineAccountId: 'account-a',
      friendId: 'friend-a',
      eventType: 'friend_add',
      sourceKind: 'line_webhook',
      sourceId: 'webhook-2',
      occurredAt: '2026-08-26T00:00:00.000Z',
    } as const;
    const first = await recordAnalyticsEvent(db, input);
    const second = await recordAnalyticsEvent(db, input);

    expect(second.id).toBe(first.id);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM analytics_events`).get())
      .toEqual({ count: 1 });
  });

  it('未知の種類とタイムゾーンなしの時刻を拒否する', async () => {
    await expect(recordAnalyticsEvent(db, {
      lineAccountId: 'account-a', eventType: 'mystery', sourceKind: 'test', sourceId: '1',
      occurredAt: '2026-08-26T00:00:00.000Z',
    })).rejects.toThrow('analytics_event_type_unknown:mystery');
    await expect(recordAnalyticsEvent(db, {
      lineAccountId: 'account-a', eventType: 'friend_add', sourceKind: 'test', sourceId: '2',
      occurredAt: '2026-08-26T00:00:00',
    })).rejects.toThrow('analytics_event_time_requires_timezone');
  });

  it('UTCの日付ではなくアカウントの暦日で集計し、別アカウントを混ぜない', async () => {
    await recordAnalyticsEvent(db, {
      lineAccountId: 'account-a', friendId: 'friend-a', eventType: 'message_received',
      sourceKind: 'line_webhook', sourceId: 'a-1', occurredAt: '2026-08-25T23:30:00.000Z',
      dimensions: { messageType: 'text' },
    });
    await recordAnalyticsEvent(db, {
      lineAccountId: 'account-a', friendId: 'friend-a', eventType: 'message_received',
      sourceKind: 'line_webhook', sourceId: 'a-2', occurredAt: '2026-08-26T00:30:00.000Z',
      dimensions: { messageType: 'image' },
    });
    await recordAnalyticsEvent(db, {
      lineAccountId: 'account-b', friendId: 'friend-b', eventType: 'message_received',
      sourceKind: 'line_webhook', sourceId: 'b-1', occurredAt: '2026-08-26T00:30:00.000Z',
    });

    const result = await rebuildAnalyticsDailyMetrics(db, {
      accountId: 'account-a',
      timeZone: 'Asia/Tokyo',
      range: { fromDate: '2026-08-26', toDate: '2026-08-26' },
      dataCutoffAt: '2026-08-26T01:00:00.000Z',
    });
    expect(result).toMatchObject({
      sourceEventCount: 2,
      projectedCount: 2,
      mismatchCount: 0,
      status: 'matched',
    });
    expect(sqlite.prepare(`
      SELECT metric_date, metric_key, dimension_value, numerator, state
      FROM analytics_daily_metrics
      WHERE line_account_id = 'account-a'
      ORDER BY metric_key
    `).all()).toEqual([
      {
        metric_date: '2026-08-26', metric_key: 'event_total',
        dimension_value: 'message_received', numerator: 2, state: 'available',
      },
      {
        metric_date: '2026-08-26', metric_key: 'unique_friends',
        dimension_value: 'message_received', numerator: 1, state: 'available',
      },
    ]);

    await rebuildAnalyticsDailyMetrics(db, {
      accountId: 'account-a',
      timeZone: 'Asia/Tokyo',
      range: { fromDate: '2026-08-26', toDate: '2026-08-26' },
      dataCutoffAt: '2026-08-26T01:05:00.000Z',
    });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM analytics_reconciliation_runs`).get())
      .toEqual({ count: 1 });
  });

  it('1万件超の読込・確定後の中間行整理を3千件ずつ再開する', async () => {
    const projectionQueries: string[] = [];
    db = asD1(sqlite, projectionQueries);
    const insertFriend = sqlite.prepare(`
      INSERT INTO friends (id, line_user_id, line_account_id)
      VALUES (?, ?, 'account-a')
    `);
    const insert = sqlite.prepare(`
      INSERT INTO analytics_events (
        id, line_account_id, friend_id, event_type, source_kind, source_id,
        occurred_at, idempotency_key
      ) VALUES (?, 'account-a', ?, 'message_received', 'test', ?,
                '2026-08-26T00:00:00.000Z', ?)
    `);
    sqlite.transaction(() => {
      for (let index = 0; index < 10_501; index += 1) {
        const id = `event-${String(index).padStart(5, '0')}`;
        const friendId = `chunk-friend-${String(index).padStart(5, '0')}`;
        insertFriend.run(friendId, `chunk-line-user-${String(index).padStart(5, '0')}`);
        insert.run(id, friendId, id, id);
      }
      insert.run('event-10501', 'chunk-friend-00000', 'event-10501', 'event-10501');
    })();
    const input = {
      accountId: 'account-a',
      timeZone: 'Asia/Tokyo',
      range: { fromDate: '2026-08-26', toDate: '2026-08-26' },
      dataCutoffAt: '2026-08-26T01:00:00.000Z',
    };

    const results = [];
    for (let index = 0; index < 8; index += 1) {
      results.push(await rebuildAnalyticsDailyMetricsChunk(db, input));
    }

    expect(results[0]).toMatchObject({ completed: false, readRows: 3_000, sourceEventCount: 3_000 });
    expect(results[1]).toMatchObject({ completed: false, readRows: 3_000, sourceEventCount: 6_000 });
    expect(results[2]).toMatchObject({ completed: false, readRows: 3_000, sourceEventCount: 9_000 });
    expect(results[3]).toMatchObject({
      completed: false,
      readRows: 1_502,
      sourceEventCount: 10_502,
      projectedCount: 10_502,
      mismatchCount: 0,
      status: 'matched',
    });
    expect(results.slice(4).map((result) => result.readRows)).toEqual([3_000, 3_000, 3_000, 1_502]);
    expect(results.slice(0, 7).every((result) => result.completed === false)).toBe(true);
    expect(results[7]?.completed).toBe(true);
    for (const table of [
      'analytics_projection_friend_stage',
      'analytics_projection_metric_stage',
      'analytics_projection_progress',
    ]) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    const chunkedMetrics = sqlite.prepare(`
      SELECT metric_key, dimension_value, numerator
        FROM analytics_daily_metrics WHERE line_account_id = 'account-a'
        ORDER BY metric_key
    `).all();

    await rebuildAnalyticsDailyMetrics(db, input);
    expect(sqlite.prepare(`
      SELECT metric_key, dimension_value, numerator
        FROM analytics_daily_metrics WHERE line_account_id = 'account-a'
        ORDER BY metric_key
    `).all()).toEqual(chunkedMetrics);
    expect(chunkedMetrics).toEqual([
      { metric_key: 'event_total', dimension_value: 'message_received', numerator: 10_502 },
      { metric_key: 'unique_friends', dimension_value: 'message_received', numerator: 10_501 },
    ]);
    expect(projectionQueries.some((query) =>
      /COUNT\(\*\)[\s\S]*FROM analytics_projection_friend_stage/.test(query),
    )).toBe(false);
  });

  it('3千件すべてが別種別・別友だちでも読込と中間行書込を1万行以内にする', async () => {
    const insertFriend = sqlite.prepare(`
      INSERT INTO friends (id, line_user_id, line_account_id)
      VALUES (?, ?, 'account-a')
    `);
    const insertEvent = sqlite.prepare(`
      INSERT INTO analytics_events (
        id, line_account_id, friend_id, event_type, source_kind, source_id,
        occurred_at, idempotency_key
      ) VALUES (?, 'account-a', ?, ?, 'test', ?,
                '2026-08-26T00:00:00.000Z', ?)
    `);
    sqlite.transaction(() => {
      for (let index = 0; index < 3_000; index += 1) {
        const suffix = String(index).padStart(4, '0');
        const friendId = `budget-friend-${suffix}`;
        const eventId = `budget-event-${suffix}`;
        insertFriend.run(friendId, `budget-line-user-${suffix}`);
        insertEvent.run(eventId, friendId, `budget-type-${suffix}`, eventId, eventId);
      }
    })();

    const result = await rebuildAnalyticsDailyMetricsChunk(db, {
      accountId: 'account-a',
      timeZone: 'Asia/Tokyo',
      range: { fromDate: '2026-08-26', toDate: '2026-08-26' },
      dataCutoffAt: '2026-08-26T01:00:00.000Z',
    });
    const friendStageRows = Number(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM analytics_projection_friend_stage`,
    ).get().count);
    const metricStageRows = Number(sqlite.prepare(
      `SELECT COUNT(*) AS count FROM analytics_projection_metric_stage`,
    ).get().count);

    expect(result).toMatchObject({ completed: false, readRows: 3_000 });
    expect(friendStageRows).toBe(3_000);
    expect(metricStageRows).toBe(3_000);
    expect(result.readRows + friendStageRows + metricStageRows).toBeLessThanOrEqual(10_000);
  });

  it('直近7日をアカウントの暦日で作る', () => {
    expect(recentAnalyticsProjectionRange(
      new Date('2026-08-26T01:00:00.000Z'),
      'America/Los_Angeles',
      7,
    )).toEqual({ fromDate: '2026-08-19', toDate: '2026-08-25' });
  });

  it('アカウント巡回位置を次のcronへ保存する', async () => {
    await expect(getAnalyticsProjectionSchedulerCursor(
      db,
      '2026-08-26T00:00:00.000Z',
    )).resolves.toBe('');
    await saveAnalyticsProjectionSchedulerCursor(
      db,
      'account-a',
      '2026-08-26T00:05:00.000Z',
    );
    await expect(getAnalyticsProjectionSchedulerCursor(
      db,
      '2026-08-26T00:10:00.000Z',
    )).resolves.toBe('account-a');
  });

  it('分析イベントは13か月、日別集計は25か月を過ぎた分だけ削除する', async () => {
    const eventInsert = sqlite.prepare(`
      INSERT INTO analytics_events (
        id, line_account_id, event_type, source_kind, source_id,
        occurred_at, idempotency_key
      ) VALUES (?, 'account-a', 'friend_add', 'test', ?, ?, ?)
    `);
    eventInsert.run('old-event', 'old', '2025-07-25T00:00:00.000Z', 'old');
    eventInsert.run('kept-event', 'kept', '2025-07-27T00:00:00.000Z', 'kept');
    const metricInsert = sqlite.prepare(`
      INSERT INTO analytics_daily_metrics (
        line_account_id, metric_date, metric_key, data_cutoff_at
      ) VALUES ('account-a', ?, ?, '2026-08-26T00:00:00.000Z')
    `);
    metricInsert.run('2024-07-25', 'old');
    metricInsert.run('2024-07-27', 'kept');
    const crossInsert = sqlite.prepare(`
      INSERT INTO analytics_cross_runs (
        id, line_account_id, query_json, state, result_json, period_from, period_to,
        time_zone, data_cutoff_at, created_at
      ) VALUES (?, 'account-a', '{}', 'available', '{}', '2025-07-01', '2025-07-07',
                'Asia/Tokyo', '2025-07-08', ?)
    `);
    crossInsert.run('old-cross', '2025-07-25T00:00:00.000Z');
    crossInsert.run('kept-cross', '2025-07-27T00:00:00.000Z');
    sqlite.exec(`
      INSERT INTO analytics_saved_analyses (
        id, line_account_id, name, kind, created_by_name, created_at, updated_at
      ) VALUES ('saved-a','account-a','経路 × タグ','cross','担当A','2025-07-01','2025-07-01');
      INSERT INTO analytics_saved_analysis_versions (
        id, saved_analysis_id, line_account_id, version_number, definition_json, created_at
      ) VALUES ('saved-version-a','saved-a','account-a',1,'{}','2025-07-01');
      INSERT INTO analytics_saved_analysis_snapshots (
        id, saved_analysis_id, analysis_version_id, line_account_id,
        source_kind, source_result_id, period_from, period_to, time_zone,
        data_cutoff_at, state, result_json, created_at
      ) VALUES
        ('old-snapshot','saved-a','saved-version-a','account-a','cross','old-cross',
         '2025-07-01','2025-07-07','Asia/Tokyo','2025-07-08','available','{}','2025-07-25T00:00:00.000Z'),
        ('kept-snapshot','saved-a','saved-version-a','account-a','cross','kept-cross',
         '2025-07-01','2025-07-07','Asia/Tokyo','2025-07-08','available','{}','2025-07-27T00:00:00.000Z');
    `);
    sqlite.prepare(
      `INSERT INTO analytics_url_exposure_queue (
         message_id, line_account_id, status, attempts, available_at,
         processed_at, created_at, updated_at
       ) VALUES ('old-message','account-a','processed',1,'2025-07-25','2025-07-25','2025-07-25','2025-07-25'),
                ('kept-message','account-a','processed',1,'2025-07-27','2025-07-27','2025-07-27','2025-07-27')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO analytics_url_exposures (
         line_account_id, message_id, friend_id, tracked_link_id,
         source_kind, sent_at, created_at
       ) VALUES ('account-a','old-message',NULL,'old-link','message','2025-07-25','2025-07-25'),
                ('account-a','kept-message',NULL,'kept-link','message','2025-07-27','2025-07-27')`,
    ).run();

    const result = await purgeExpiredAnalyticsReadData(
      db,
      new Date('2026-08-26T00:00:00.000Z'),
    );

    expect(result).toMatchObject({
      events: 1,
      dailyMetrics: 1,
      crossRuns: 1,
      savedSnapshots: 1,
      urlExposures: 1,
      urlExposureQueue: 1,
    });
    expect(sqlite.prepare(`SELECT id FROM analytics_events`).all()).toEqual([{ id: 'kept-event' }]);
    expect(sqlite.prepare(`SELECT metric_key FROM analytics_daily_metrics`).all())
      .toEqual([{ metric_key: 'kept' }]);
    expect(sqlite.prepare(`SELECT id FROM analytics_cross_runs`).all())
      .toEqual([{ id: 'kept-cross' }]);
    expect(sqlite.prepare(`SELECT id FROM analytics_saved_analysis_snapshots`).all())
      .toEqual([{ id: 'kept-snapshot' }]);
    expect(sqlite.prepare(`SELECT message_id FROM analytics_url_exposures`).all())
      .toEqual([{ message_id: 'kept-message' }]);
    expect(sqlite.prepare(`SELECT message_id FROM analytics_url_exposure_queue`).all())
      .toEqual([{ message_id: 'kept-message' }]);
  });
});
