import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getAnalyticsFriendsOverview,
  getAnalyticsReactionsOverview,
  getAnalyticsRoutesOverview,
  getAnalyticsUrlClicksOverview,
  getAnalyticsUsageOverview,
  type AnalyticsOverviewContext,
} from '../src/analytics-overviews.js';
import { setFriendSupportMarkBulk } from '../src/support-marks.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

  it('URLクリックは取得開始前の到達人数を0件と断定しない', async () => {
    sqlite.prepare(
      `INSERT INTO tracked_links (id, name, original_url, line_account_id, short_code)
       VALUES ('link-a','申込URL','https://example.com','account-a','apply')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO link_clicks (id, tracked_link_id, friend_id, clicked_at)
       VALUES ('click-a','link-a','friend-a','2026-08-10T03:00:00.000Z')`,
    ).run();

    const result = await getAnalyticsUrlClicksOverview(db, CONTEXT);
    expect(result.data).toMatchObject({ state: 'unavailable' });
    expect(result.data.links[0]).toMatchObject({
      clicks: { value: 1, state: 'available' },
      deliveredPeople: { value: null, state: 'unavailable' },
      clickRate: { value: null, state: 'unavailable' },
    });
  });

  it('URLクリック率は送信後に押した既知の友だちだけを分子にする', async () => {
    sqlite.prepare(
      `INSERT INTO analytics_event_coverage (
         line_account_id, event_type, available_from, state, updated_at
       ) VALUES ('account-a','url_exposed','2026-07-01T00:00:00.000Z','available','2026-08-30')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tracked_links (id, name, original_url, line_account_id, short_code)
       VALUES ('link-a','申込URL','https://example.com','account-a','apply'),
              ('link-zero','未クリックURL','https://example.com/zero','account-a','zero'),
              ('link-x','別店舗URL','https://example.com/x','account-b','other')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO analytics_url_exposures (
         line_account_id, message_id, friend_id, tracked_link_id,
         source_kind, sent_at, created_at
       ) VALUES ('account-a','m1','friend-a','link-a','broadcast','2026-08-10T02:00:00.000Z','2026-08-10'),
                ('account-a','m2','friend-b','link-a','broadcast','2026-08-10T02:00:00.000Z','2026-08-10'),
                ('account-b','mx','friend-x','link-x','broadcast','2026-08-10T02:00:00.000Z','2026-08-10')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO link_clicks (id, tracked_link_id, friend_id, clicked_at)
       VALUES ('before','link-a','friend-a','2026-08-10T01:00:00.000Z'),
              ('after','link-a','friend-a','2026-08-10T03:00:00.000Z'),
              ('anonymous','link-a',NULL,'2026-08-10T04:00:00.000Z'),
              ('other-account','link-x','friend-x','2026-08-10T04:00:00.000Z')`,
    ).run();

    const result = await getAnalyticsUrlClicksOverview(db, CONTEXT);
    const link = result.data.links.find((item) => item.trackedLinkId === 'link-a');
    expect(result.data.state).toBe('available');
    expect(link).toMatchObject({
      clicks: { value: 3 },
      knownClickPeople: { value: 1 },
      deliveredPeople: { value: 2, state: 'available' },
      clickedAfterExposurePeople: { value: 1 },
      clickRate: { value: 0.5, state: 'available' },
      usageLocations: ['broadcast'],
    });
    expect(result.data.links.find((item) => item.trackedLinkId === 'link-zero'))
      .toMatchObject({ clicks: { value: 0 }, deliveredPeople: { value: 0 } });
    expect(result.data.links.some((item) => item.trackedLinkId === 'link-x')).toBe(false);
  });

  it('150本の計測リンクのURL露出を同じ値のまま分割集計する', async () => {
    sqlite.prepare(
      `INSERT INTO analytics_event_coverage (
         line_account_id, event_type, available_from, state, updated_at
       ) VALUES ('account-a','url_exposed','2026-07-01T00:00:00.000Z','available','2026-08-30')`,
    ).run();
    const insertLink = sqlite.prepare(
      `INSERT INTO tracked_links (id, name, original_url, line_account_id, short_code)
       VALUES (?, ?, ?, 'account-a', ?)`,
    );
    const insertExposure = sqlite.prepare(
      `INSERT INTO analytics_url_exposures (
         line_account_id, message_id, friend_id, tracked_link_id,
         source_kind, sent_at, created_at
       ) VALUES ('account-a', ?, 'friend-a', ?, 'broadcast',
                 '2026-08-10T02:00:00.000Z', '2026-08-10')`,
    );
    for (let index = 0; index < 150; index += 1) {
      const id = `bulk-link-${String(index).padStart(3, '0')}`;
      insertLink.run(id, id, `https://example.com/${id}`, id);
      insertExposure.run(`message-${index}`, id);
    }

    const result = await getAnalyticsUrlClicksOverview(db, CONTEXT);
    expect(result.data.links).toHaveLength(150);
    expect(result.data.hasMore).toBe(false);
    expect(result.data.links.every((link) => (
      link.deliveredPeople.value === 1 && link.usageLocations.includes('broadcast')
    ))).toBe(true);
  });

  it('150人の対応マークを分割更新し実際の更新件数を返す', async () => {
    sqlite.prepare(
      `INSERT INTO support_marks (id, name, color, display_order, created_at)
       VALUES ('mark_working', '対応中', '#3B82F6', 1, '2026-08-26')`,
    ).run();
    const insert = sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id) VALUES (?, ?, 'account-a')`,
    );
    const friendIds = Array.from({ length: 150 }, (_, index) => `bulk-friend-${index}`);
    for (const id of friendIds) insert.run(id, `U-${id}`);

    await expect(
      setFriendSupportMarkBulk(db, friendIds, 'mark_working', {
        tenantId: '00000000-0000-4000-8000-000000000001',
        lineAccountId: 'account-a',
      }),
    ).resolves.toBe(150);
    const updated = sqlite.prepare(
      `SELECT COUNT(*) AS count FROM friends WHERE support_mark_id = 'mark_working'`,
    ).get() as { count: number };
    expect(updated.count).toBe(150);
  });

  it('URL露出の取得開始が期間途中なら一部取得と明示する', async () => {
    sqlite.prepare(
      `INSERT INTO analytics_event_coverage (
         line_account_id, event_type, available_from, state, updated_at
       ) VALUES ('account-a','url_exposed','2026-08-20T00:00:00.000Z','available','2026-08-30')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tracked_links (id, name, original_url, line_account_id)
       VALUES ('link-a','申込URL','https://example.com','account-a')`,
    ).run();

    const result = await getAnalyticsUrlClicksOverview(db, CONTEXT);
    expect(result.data).toMatchObject({
      state: 'partial',
      exposureAvailableFrom: '2026-08-20T00:00:00.000Z',
    });
    expect(result.data.links[0]).toMatchObject({
      deliveredPeople: { value: 0, state: 'partial' },
      clickRate: { value: null, state: 'partial' },
    });
  });

  it('受信者一覧を取れないLINE全員配信は到達0件にしない', async () => {
    sqlite.prepare(
      `INSERT INTO analytics_event_coverage (
         line_account_id, event_type, available_from, state, updated_at
       ) VALUES ('account-a','url_exposed','2026-07-01T00:00:00.000Z','available','2026-08-30')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tracked_links (id, name, original_url, line_account_id)
       VALUES ('link-a','全員向けURL','https://example.com','account-a')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO analytics_url_exposures (
         line_account_id, message_id, friend_id, tracked_link_id,
         source_kind, audience_state, sent_at, created_at
       ) VALUES ('account-a','line-broadcast:b1',NULL,'link-a',
                 'broadcast_all','unknown','2026-08-10T02:00:00.000Z','2026-08-10')`,
    ).run();

    const result = await getAnalyticsUrlClicksOverview(db, CONTEXT);
    expect(result.data.links[0]).toMatchObject({
      deliveredPeople: { value: null, state: 'unavailable' },
      clickedAfterExposurePeople: { value: null, state: 'unavailable' },
      clickRate: { value: null, state: 'unavailable' },
      usageLocations: ['broadcast_all'],
    });
  });
});
