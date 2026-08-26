import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getAnalyticsFriendsOverview,
  getAnalyticsReactionsOverview,
  getAnalyticsRoutesOverview,
  getAnalyticsUsageOverview,
  type AnalyticsOverviewContext,
} from '../src/analytics-overviews.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
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

const CONTEXT: AnalyticsOverviewContext = {
  lineAccountId: 'account-a',
  timeZone: 'Asia/Tokyo',
  fromDate: '2026-08-01',
  toDate: '2026-08-30',
  from: '2026-07-31T15:00:00.000Z',
  toExclusive: '2026-08-30T15:00:00.000Z',
  dataCutoffAt: '2026-08-30T16:00:00.000Z',
};

describe('V6分析の概要4画面', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(
      `INSERT INTO line_accounts (
         id, channel_id, name, channel_access_token, channel_secret, timezone
       ) VALUES ('account-a','ca','A','ta','sa','Asia/Tokyo'),
                ('account-b','cb','B','tb','sb','UTC')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id, is_following, is_hidden)
       VALUES ('friend-a','Ua','account-a',1,0),
              ('friend-b','Ub','account-a',0,0),
              ('friend-x','Ux','account-b',1,0)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO analytics_event_coverage (
         line_account_id, event_type, available_from, state, updated_at
       ) VALUES ('account-a','friend_add','2026-07-01T00:00:00.000Z','available','2026-08-30'),
                ('account-a','friend_unfollow','2026-07-01T00:00:00.000Z','available','2026-08-30')`,
    ).run();
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('友だち増減は照合済みの真の0件と未集計を区別する', async () => {
    sqlite.prepare(
      `INSERT INTO analytics_reconciliation_runs (
         id, line_account_id, range_from, range_to, status, started_at, completed_at
       ) VALUES ('recon-a','account-a','2026-08-01','2026-08-30','matched','2026-08-30','2026-08-30')`,
    ).run();
    const result = await getAnalyticsFriendsOverview(db, CONTEXT);
    expect(result.data).toMatchObject({
      state: 'available',
      metrics: {
        added: { value: 0, state: 'available' },
        removed: { value: 0, state: 'available' },
        currentFriends: { value: 1, state: 'available' },
      },
    });

    sqlite.prepare(`DELETE FROM analytics_reconciliation_runs`).run();
    const pending = await getAnalyticsFriendsOverview(db, CONTEXT);
    expect(pending.data.metrics.added).toMatchObject({ value: 0, state: 'pending' });
  });

  it('初回・再追加・日別増減を選択中アカウントだけで集計する', async () => {
    sqlite.prepare(
      `INSERT INTO friend_add_events (
         id, line_account_id, friend_id, webhook_event_id, friend_kind, occurred_at
       ) VALUES ('add-a','account-a','friend-a','wa','first_time','2026-08-05T00:00:00.000Z'),
                ('add-b','account-a','friend-b','wb','returning','2026-08-06T00:00:00.000Z'),
                ('add-x','account-b','friend-x','wx','first_time','2026-08-05T00:00:00.000Z')`,
    ).run();
    const insertMetric = sqlite.prepare(
      `INSERT INTO analytics_daily_metrics (
         line_account_id, metric_date, metric_key, dimension_key, dimension_value,
         numerator, state, data_cutoff_at
       ) VALUES (?, ?, 'event_total', 'event_type', ?, ?, 'available', '2026-08-30')`,
    );
    insertMetric.run('account-a', '2026-08-05', 'friend_add', 2);
    insertMetric.run('account-a', '2026-08-06', 'friend_unfollow', 1);
    insertMetric.run('account-b', '2026-08-05', 'friend_add', 99);

    const result = await getAnalyticsFriendsOverview(db, CONTEXT);
    expect(result.data.metrics).toMatchObject({
      added: { value: 2 }, removed: { value: 1 }, net: { value: 1 },
      firstTime: { value: 1 }, returning: { value: 1 }, currentFriends: { value: 1 },
    });
  });

  it('配信反応は20人未満・取得待ち・自社URLを別の状態で返す', async () => {
    sqlite.prepare(
      `INSERT INTO broadcasts (
         id, title, message_type, message_content, status, sent_at,
         total_count, success_count, line_account_id
       ) VALUES ('b-small','少人数','text','x','sent','2026-08-10T00:00:00.000Z',10,10,'account-a'),
                ('b-wait','取得待ち','text','x','sent','2026-08-11T00:00:00.000Z',30,30,'account-a')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO broadcast_insights (
         id, broadcast_id, delivered, unique_impression, unique_click, status
       ) VALUES ('bi-small','b-small',10,NULL,NULL,'ready'),
                ('bi-wait','b-wait',NULL,NULL,NULL,'pending')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tracked_links (id, name, original_url, line_account_id)
       VALUES ('link-a','A','https://example.com','account-a'),
              ('link-x','X','https://example.com','account-b')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO link_clicks (id, tracked_link_id, friend_id, clicked_at)
       VALUES ('click-a','link-a','friend-a','2026-08-10T03:00:00.000Z'),
              ('click-x','link-x','friend-x','2026-08-10T03:00:00.000Z')`,
    ).run();

    const result = await getAnalyticsReactionsOverview(db, CONTEXT);
    expect(result.data.campaigns.find((item) => item.id === 'b-small')?.opened.state)
      .toBe('insufficient');
    expect(result.data.campaigns.find((item) => item.id === 'b-wait')?.opened.state)
      .toBe('pending');
    expect(result.data.metrics.trackedClicks).toMatchObject({ value: 1, state: 'available' });
    expect(result.data.trackedClickHours[12].clicks).toBe(1);
  });

  it('配信がない期間は取得不可ではなく0件にする', async () => {
    const result = await getAnalyticsReactionsOverview(db, CONTEXT);
    expect(result.data.metrics).toMatchObject({
      sent: { value: 0, state: 'available' },
      opened: { value: 0, state: 'available' },
      lineClicked: { value: 0, state: 'available' },
    });
  });

  it('流入経路は第一接触で帰属し、広告費がないとき0円にしない', async () => {
    sqlite.prepare(
      `INSERT INTO entry_routes (id, ref_code, name)
       VALUES ('route-a','ra','広告A'), ('route-b','rb','広告B')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friend_add_events (
         id, line_account_id, friend_id, webhook_event_id, friend_kind,
         attribution_status, ref_code, entry_route_id, occurred_at
       ) VALUES ('touch-a','account-a','friend-a','w1','first_time','captured','ra','route-a','2026-08-01T00:00:00.000Z'),
                ('touch-b','account-a','friend-a','w2','returning','captured','rb','route-b','2026-08-01T00:00:00.000Z'),
                ('unknown','account-a','friend-b','w3','first_time','unavailable',NULL,NULL,'2026-08-02T00:00:00.000Z')`,
    ).run();

    const result = await getAnalyticsRoutesOverview(db, CONTEXT);
    const routeA = result.data.routes.find((item) => item.id === 'route-a');
    const routeB = result.data.routes.find((item) => item.id === 'route-b');
    expect(routeA?.currentFriends.value).toBe(1);
    expect(routeB?.currentFriends.value).toBe(0);
    expect(routeA?.adCost).toMatchObject({ value: null, state: 'unavailable' });
    expect(result.data.routes.find((item) => item.id === '__unknown__')?.friendAdds.value).toBe(1);
  });

  it('最初が経路不明なら、後の再追加リンクへ第一接触を付け替えない', async () => {
    sqlite.prepare(
      `INSERT INTO entry_routes (id, ref_code, name) VALUES ('route-a','ra','広告A')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friend_add_events (
         id, line_account_id, friend_id, webhook_event_id, friend_kind,
         attribution_status, ref_code, entry_route_id, occurred_at
       ) VALUES ('first-unknown','account-a','friend-a','w1','first_time','unavailable',NULL,NULL,'2026-08-01T00:00:00.000Z'),
                ('later-route','account-a','friend-a','w2','returning','captured','ra','route-a','2026-08-02T00:00:00.000Z')`,
    ).run();

    const result = await getAnalyticsRoutesOverview(db, CONTEXT);
    expect(result.data.routes.find((item) => item.id === 'route-a')?.currentFriends.value).toBe(0);
  });

  it('使われ方は所属を安全に分けられない旧データを合計へ混ぜない', async () => {
    sqlite.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
       VALUES ('template-a','A','text','a','account-a'),
              ('template-x','X','text','x','account-b')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO messages_log (
         id, friend_id, direction, message_type, content, template_id_at_send,
         line_account_id, created_at
       ) VALUES ('message-a','friend-a','outgoing','text','a','template-a','account-a','2026-08-10')`,
    ).run();

    const result = await getAnalyticsUsageOverview(db, CONTEXT);
    const templates = result.data.categories.find((item) => item.key === 'templates');
    const mediaVars = result.data.categories.find((item) => item.key === 'media_vars');
    expect(templates?.created.value).toBe(1);
    expect(templates?.inUse.value).toBe(1);
    expect(mediaVars?.created).toMatchObject({ value: null, state: 'unavailable' });
    expect(result.data).toMatchObject({ state: 'partial', automaticDeletion: false });
  });
});
