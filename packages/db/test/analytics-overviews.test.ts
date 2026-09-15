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
    expect(templates?.brokenReferences).toEqual({ value: 0, state: 'available', reason: null });
    expect(mediaVars?.created).toMatchObject({ value: null, state: 'unavailable' });
    expect(result.data).toMatchObject({ state: 'partial', automaticDeletion: false });
    expect(result.data.summary.brokenReferences).toMatchObject({ value: 0, state: 'partial' });
  });

  it('使われ方の自動実行と手動送信は選択中アカウント・期間・テストを分ける', async () => {
    sqlite.prepare(
      `INSERT INTO automation_definitions (id, line_account_id, name, status)
       VALUES ('automation-a','account-a','A','active'), ('automation-x','account-b','X','active')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO automation_versions (
         id, automation_id, version_number, status, trigger_type
       ) VALUES ('version-a','automation-a',1,'published','message'),
                ('version-x','automation-x',1,'published','message')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO automation_runs (
         id, line_account_id, automation_id, automation_version_id,
         source_event_id, idempotency_key, status, is_test, started_at
       ) VALUES ('run-a','account-a','automation-a','version-a','event-a','key-a','success',0,'2026-08-10'),
                ('run-test','account-a','automation-a','version-a','event-t','key-t','success',1,'2026-08-11'),
                ('run-old','account-a','automation-a','version-a','event-o','key-o','success',0,'2026-07-01'),
                ('run-x','account-b','automation-x','version-x','event-x','key-x','success',0,'2026-08-10')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO messages_log (
         id, friend_id, direction, message_type, content, source,
         delivery_type, line_account_id, created_at
       ) VALUES ('manual-a','friend-a','outgoing','text','a','manual','push','account-a','2026-08-12'),
                ('test-a','friend-a','outgoing','text','a','manual','test','account-a','2026-08-12'),
                ('manual-x','friend-x','outgoing','text','x','manual','push','account-b','2026-08-12')`,
    ).run();

    const result = await getAnalyticsUsageOverview(db, CONTEXT);
    expect(result.data.summary).toMatchObject({
      automaticRuns: { value: 1, state: 'partial' },
      manualSends: { value: 1, state: 'available' },
      estimatedHoursSaved: { value: 0.01, state: 'partial' },
    });
    expect(result.data.summary.automaticRuns.reason).toContain('オートメーションの実行記録だけ');
    expect(result.data.summary.unusedItems.state).toBe('partial');
  });

  it('使われ方の参照切れは存在・削除済み・別アカウント・未対応種別を分ける', async () => {
    sqlite.pragma('foreign_keys = OFF');
    sqlite.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
       VALUES ('template-ok','利用可','text','ok','account-a'),
              ('template-deleted','削除前','text','deleted','account-a'),
              ('template-other','別店舗','text','other','account-b')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO auto_replies (
         id, keyword, response_type, response_content, template_id, line_account_id
       ) VALUES ('reply-ok','ok','text','ok','template-ok','account-a'),
                ('reply-deleted','deleted','text','deleted','template-deleted','account-a'),
                ('reply-other','other','text','other','template-other','account-a'),
                ('reply-b','b','text','b','missing-b','account-b')`,
    ).run();
    // 古いDBや移行途中で参照元だけが残る実データを再現する。
    sqlite.prepare(`DELETE FROM templates WHERE id = 'template-deleted'`).run();

    sqlite.prepare(
      `INSERT INTO message_templates (id, name, message_type, message_content)
       VALUES ('link-intro-ok','リンク案内・利用可','text','ok'),
              ('link-intro-deleted','リンク案内・削除前','text','deleted'),
              ('link-reward-ok','リンク特典・利用可','text','ok'),
              ('link-reward-deleted','リンク特典・削除前','text','deleted'),
              ('route-intro-ok','経路案内・利用可','text','ok'),
              ('route-intro-deleted','経路案内・削除前','text','deleted')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tracked_links (
         id, name, original_url, intro_template_id, reward_template_id, line_account_id
       ) VALUES ('link-intro-ok','案内あり','https://example.com/intro-ok','link-intro-ok',NULL,'account-a'),
                ('link-intro-deleted','案内削除','https://example.com/intro-deleted','link-intro-deleted',NULL,'account-a'),
                ('link-intro-other','別店舗案内','https://example.com/intro-other','missing-intro-other',NULL,'account-b'),
                ('link-reward-ok','特典あり','https://example.com/reward-ok',NULL,'link-reward-ok','account-a'),
                ('link-reward-deleted','特典削除','https://example.com/reward-deleted',NULL,'link-reward-deleted','account-a'),
                ('link-reward-other','別店舗特典','https://example.com/reward-other',NULL,'missing-reward-other','account-b')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO entry_routes (id, ref_code, name, intro_template_id, line_account_id)
       VALUES ('route-intro-ok','route-intro-ok','経路案内あり','route-intro-ok','account-a'),
              ('route-intro-deleted','route-intro-deleted','経路案内削除','route-intro-deleted','account-a'),
              ('route-intro-other','route-intro-other','別店舗経路案内','missing-route-other','account-b')`,
    ).run();
    sqlite.prepare(
      `DELETE FROM message_templates
        WHERE id IN ('link-intro-deleted','link-reward-deleted','route-intro-deleted')`,
    ).run();

    sqlite.prepare(
      `INSERT INTO common_action_bindings (
         id, line_account_id, common_action_id, common_action_version_id,
         consumer_type, consumer_id, consumer_path
       ) VALUES ('unsupported-binding','account-a','missing-action','missing-version',
                 'future_consumer','future-1','future.path')`,
    ).run();

    const result = await getAnalyticsUsageOverview(db, CONTEXT);
    const templates = result.data.categories.find((item) => item.key === 'templates');
    const automations = result.data.categories.find((item) => item.key === 'automations');
    const mediaVars = result.data.categories.find((item) => item.key === 'media_vars');

    expect(templates?.brokenReferences).toEqual({ value: 5, state: 'available', reason: null });
    expect(automations?.brokenReferences).toMatchObject({ value: 0, state: 'partial' });
    expect(automations?.brokenReferences.reason).toContain('future_consumer');
    expect(mediaVars?.brokenReferences).toMatchObject({ value: null, state: 'unavailable' });
    expect(result.data.summary.brokenReferences).toMatchObject({ value: 5, state: 'partial' });
    expect(result.data.summary.brokenReferences.reason).toContain('確認できた参照だけ');
    expect(result.data.checkedAt).toBe(CONTEXT.dataCutoffAt);
  });

  it('使われ方は運用中の型付き参照だけを参照元アカウント内で照合する', async () => {
    sqlite.pragma('foreign_keys = OFF');
    sqlite.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
       VALUES ('reminder-template-ok','リマインダ利用可','text','ok','account-a'),
              ('reminder-template-deleted','リマインダ削除前','text','deleted','account-a'),
              ('reminder-template-other','リマインダ別店舗','text','other','account-b')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO friend_fields (id, name, field_key, type)
       VALUES ('field-ok','利用可','field_ok','date'),
              ('field-deleted','削除前','field_deleted','date')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tags (id, name, line_account_id)
       VALUES ('tag-ok','利用可','account-a'),
              ('tag-deleted','削除前','account-a'),
              ('tag-other','別店舗','account-b')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, line_account_id, is_active)
       VALUES ('scenario-ok','利用可','manual','account-a',1),
              ('scenario-other','別店舗','manual','account-b',1)`,
    ).run();

    sqlite.prepare(
      `INSERT INTO reminders (
         id, name, line_account_id, trigger_type, trigger_field_id, current_published_version_id
       ) VALUES ('reminder-ok','利用可','account-a','friend_field','field-ok','reminder-version-ok'),
                ('reminder-deleted','削除参照','account-a','friend_field','field-deleted','reminder-version-deleted'),
                ('reminder-other','別店舗','account-b','friend_field','missing-field-other','reminder-version-other')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO reminder_versions (
         id, reminder_id, version_number, status, settings_snapshot, published_at, created_at, updated_at
       ) VALUES ('reminder-version-ok','reminder-ok',1,'draft','{}',NULL,'2026-08-01','2026-08-01'),
                ('reminder-version-deleted','reminder-deleted',1,'draft','{}',NULL,'2026-08-01','2026-08-01'),
                ('reminder-version-other','reminder-other',1,'draft','{}',NULL,'2026-08-01','2026-08-01')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO reminder_version_steps (
         id, reminder_version_id, stable_step_id, offset_minutes,
         message_type, message_content, template_id, created_at
       ) VALUES ('reminder-step-ok','reminder-version-ok','step-ok',0,'text','ok','reminder-template-ok','2026-08-01'),
                ('reminder-step-deleted','reminder-version-deleted','step-deleted',0,'text','deleted','reminder-template-deleted','2026-08-01'),
                ('reminder-step-other','reminder-version-ok','step-other',1,'text','other','reminder-template-other','2026-08-01'),
                ('reminder-step-account-b','reminder-version-other','step-b',0,'text','b','missing-template-b','2026-08-01')`,
    ).run();
    sqlite.prepare(
      `UPDATE reminder_versions SET status = 'published', published_at = '2026-08-01'`,
    ).run();
    // 公開時は同じ論理stepが互換表にも同期される。公開版があるreminderでは1件として数える。
    sqlite.prepare(
      `INSERT INTO reminder_steps (
         id, reminder_id, offset_minutes, message_type, message_content, template_id
       ) VALUES ('reminder-step-deleted-mirror','reminder-deleted',0,'text','deleted','reminder-template-deleted')`,
    ).run();

    sqlite.prepare(
      `INSERT INTO forms (id, name) VALUES
         ('form-ok','利用可'), ('form-deleted','削除前'),
         ('form-other','別店舗')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO forms (
         id, name, fields, on_submit_tag_id, on_submit_scenario_id
       ) VALUES (
         'form-hooks','後処理','[{"name":"birthday","friendFieldId":"field-deleted"}]',
         'tag-other','scenario-other'
       )`,
    ).run();
    sqlite.prepare(
      `INSERT INTO form_accounts (form_id, line_account_id)
       VALUES ('form-ok','account-a'), ('form-deleted','account-a'),
              ('form-other','account-b'), ('form-hooks','account-a')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO rich_menu_groups (id, account_id, name, chat_bar_text, size)
       VALUES ('menu-a','account-a','A','メニュー','large'),
              ('menu-b','account-b','B','メニュー','large')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO rich_menu_pages (id, group_id, order_index, name, alias_id)
       VALUES ('page-a','menu-a',0,'A','alias-a'),
              ('page-a-target','menu-a',1,'A2','alias-a2'),
              ('page-b','menu-b',0,'B','alias-b')`,
    ).run();
    const insertArea = sqlite.prepare(
      `INSERT INTO rich_menu_areas (
         id, page_id, bounds_x, bounds_y, bounds_width, bounds_height,
         action_type, action_data, tag_ids, form_id
       ) VALUES (?, ?, 0, 0, 100, 100, ?, ?, ?, ?)`,
    );
    insertArea.run('area-valid', 'page-a', 'message', '{}', '["tag-ok"]', 'form-ok');
    insertArea.run(
      'area-broken', 'page-a', 'message', '{"scenarioId":"scenario-other"}',
      '["tag-deleted","tag-other"]', 'form-deleted',
    );
    insertArea.run(
      'area-form-other', 'page-a', 'message', '{}', '[]', 'form-other',
    );
    insertArea.run(
      'area-switch-valid', 'page-a', 'richmenuswitch', '{"targetPageId":"page-a-target"}', '[]', null,
    );
    insertArea.run(
      'area-switch-other', 'page-a', 'richmenuswitch', '{"targetPageId":"page-b"}', '[]', null,
    );
    insertArea.run(
      'area-account-b', 'page-b', 'message', '{"scenarioId":"missing-scenario-b"}',
      '["missing-tag-b"]', 'missing-form-b',
    );

    sqlite.prepare(
      `INSERT INTO traffic_pools (id, slug, name, active_account_id, created_at, updated_at)
       VALUES ('pool-ok','pool-ok','利用可','account-a','2026-08-01','2026-08-01')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO entry_routes (id, ref_code, name, pool_id, line_account_id)
       VALUES ('route-pool-ok','pool-ok','利用可','pool-ok','account-a'),
              ('route-pool-missing','pool-missing','削除参照','missing-pool','account-a'),
              ('route-pool-other','pool-other','別店舗','missing-pool-b','account-b')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO rich_menu_assignments (
         id, friend_id, line_account_id, group_id, version_id, line_richmenu_id,
         reason_kind, assigned_at, updated_at
       ) VALUES ('assignment-legacy','friend-a','account-a','menu-a','legacy-reserved','line-menu','manual','2026-08-01','2026-08-01')`,
    ).run();

    sqlite.prepare(`DELETE FROM templates WHERE id = 'reminder-template-deleted'`).run();
    sqlite.prepare(`DELETE FROM friend_fields WHERE id = 'field-deleted'`).run();
    sqlite.prepare(`DELETE FROM tags WHERE id = 'tag-deleted'`).run();
    sqlite.prepare(`DELETE FROM forms WHERE id = 'form-deleted'`).run();

    const result = await getAnalyticsUsageOverview(db, CONTEXT);
    const referenceByKey = Object.fromEntries(
      result.data.categories.map((item) => [item.key, item.brokenReferences]),
    );
    expect(referenceByKey.templates).toMatchObject({ value: 2, state: 'available' });
    expect(referenceByKey.scenarios).toMatchObject({ value: 2, state: 'available' });
    expect(referenceByKey.forms).toMatchObject({ value: 2, state: 'partial' });
    expect(referenceByKey.rich_menus).toMatchObject({ value: 1, state: 'available' });
    expect(referenceByKey.friend_attributes).toMatchObject({ value: 5, state: 'partial' });
    expect(referenceByKey.inflow_conversion).toMatchObject({ value: 1, state: 'available' });
    // version_id は現行writerが常にNULLにし、解決先テーブルもない予約列なので数えない。
    expect(result.data.summary.brokenReferences.value).toBe(13);
  });

  it('公開版と互換表に同じ壊れたリマインダテンプレートがあっても1件と数える', async () => {
    sqlite.pragma('foreign_keys = OFF');
    sqlite.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
       VALUES ('reminder-template-mirrored','公開前','text','deleted','account-a')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO reminders (id, name, line_account_id, current_published_version_id)
       VALUES ('reminder-mirrored','公開済み','account-a','reminder-version-mirrored')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO reminder_versions (
         id, reminder_id, version_number, status, settings_snapshot,
         published_at, created_at, updated_at
       ) VALUES (
         'reminder-version-mirrored','reminder-mirrored',1,'draft','{}',
         NULL,'2026-08-01','2026-08-01'
       )`,
    ).run();
    sqlite.prepare(
      `INSERT INTO reminder_version_steps (
         id, reminder_version_id, stable_step_id, offset_minutes,
         message_type, message_content, template_id, created_at
       ) VALUES (
         'reminder-version-step-mirrored','reminder-version-mirrored','step-mirrored',0,
         'text','deleted','reminder-template-mirrored','2026-08-01'
       )`,
    ).run();
    sqlite.prepare(
      `UPDATE reminder_versions
       SET status = 'published', published_at = '2026-08-01'
       WHERE id = 'reminder-version-mirrored'`,
    ).run();
    sqlite.prepare(
      `INSERT INTO reminder_steps (
         id, reminder_id, offset_minutes, message_type, message_content, template_id
       ) VALUES (
         'reminder-step-mirrored','reminder-mirrored',0,
         'text','deleted','reminder-template-mirrored'
       )`,
    ).run();
    sqlite.prepare(`DELETE FROM templates WHERE id = 'reminder-template-mirrored'`).run();

    const result = await getAnalyticsUsageOverview(db, CONTEXT);
    expect(result.data.categories.find((item) => item.key === 'templates')?.brokenReferences)
      .toEqual({ value: 1, state: 'available', reason: null });
  });

  it('参照件数が増えても一覧取得やN+1をせず、固定1問で集計する', async () => {
    sqlite.pragma('foreign_keys = OFF');
    sqlite.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, line_account_id)
       VALUES ('template-ok','利用可','text','ok','account-a')`,
    ).run();
    const insert = sqlite.prepare(
      `INSERT INTO auto_replies (
         id, keyword, response_type, response_content, template_id, line_account_id
       ) VALUES (?, ?, 'text', 'ok', ?, 'account-a')`,
    );
    for (let index = 0; index < 250; index += 1) {
      insert.run(`reply-${index}`, `keyword-${index}`, index % 2 === 0 ? 'template-ok' : `missing-${index}`);
    }

    const preparedSql: string[] = [];
    const countedDb = {
      ...db,
      prepare(sql: string) {
        preparedSql.push(sql);
        return db.prepare(sql);
      },
    } as D1Database;
    const result = await getAnalyticsUsageOverview(countedDb, CONTEXT);
    const healthSql = preparedSql.filter((sql) => sql.includes('usage-reference-health'));

    expect(result.data.categories.find((item) => item.key === 'templates')?.brokenReferences.value)
      .toBe(125);
    expect(healthSql).toHaveLength(1);
    expect(healthSql[0]?.toUpperCase()).not.toContain('UNION');
    expect(healthSql[0]?.match(/\?/g)).toHaveLength(42);
    expect(healthSql[0]?.match(/\?/g)?.length).toBeLessThanOrEqual(100);
  });

  it('参照集計だけが失敗したとき0件にせずfailedで返す', async () => {
    const failedDb = {
      ...db,
      prepare(sql: string) {
        if (sql.includes('usage-reference-health')) {
          throw new Error('reference query failed');
        }
        return db.prepare(sql);
      },
    } as D1Database;

    const result = await getAnalyticsUsageOverview(failedDb, CONTEXT);
    expect(result.data.categories.find((item) => item.key === 'templates')?.brokenReferences)
      .toMatchObject({ value: null, state: 'failed' });
    expect(result.data.summary.brokenReferences)
      .toMatchObject({ value: null, state: 'failed' });
    expect(result.data.state).toBe('partial');
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
