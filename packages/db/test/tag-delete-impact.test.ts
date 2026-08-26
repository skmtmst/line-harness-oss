import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTagDeleteImpact } from '../src/tags.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return { prepare } as unknown as D1Database;
}

describe('タグ削除前の影響確認', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
      INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
      VALUES ('default', 'default', '標準', datetime('now'), datetime('now'));

      INSERT INTO tags (id, name, line_account_id)
      VALUES ('tag-main', '申込済み', 'account-1'),
             ('tag-main-extra', '部分一致防止', 'account-1'),
             ('tag-unused', '未使用', 'account-1');

      INSERT INTO friends (id, line_user_id, line_account_id)
      VALUES ('friend-1', 'U1', 'account-1'), ('friend-2', 'U2', 'account-1');
      INSERT INTO friend_tags (friend_id, tag_id)
      VALUES ('friend-1', 'tag-main'), ('friend-2', 'tag-main');

      INSERT INTO broadcasts
        (id, title, message_type, message_content, target_tag_id, segment_conditions)
      VALUES ('broadcast-1', '案内', 'text', '本文', 'tag-main',
              '{"rules":[{"value":"tag-main"}]}'),
             ('broadcast-similar', '別案内', 'text', '本文', NULL,
              '{"rules":[{"value":"tag-main-extra"}]}'),
             ('broadcast-broken', '旧案内', 'text', '本文', NULL, '{broken');

      INSERT INTO forms (id, name, on_submit_tag_id, layout)
      VALUES ('form-1', '申込', 'tag-main',
              '{"afterActions":[{"tagIds":["tag-main"]}]}');

      INSERT INTO scenarios (id, name, trigger_type, trigger_tag_id, audience_condition_json)
      VALUES ('scenario-1', '案内', 'tag_added', 'tag-main',
              '{"rules":[{"value":"tag-main"}]}');
      INSERT INTO scenario_steps
        (id, scenario_id, step_order, message_type, message_content, on_reach_tag_id)
      VALUES ('step-1', 'scenario-1', 1, 'text', '本文', 'tag-main');
      INSERT INTO scenario_actions
        (id, scenario_id, hook, action_type, config_json, condition_json)
      VALUES ('scenario-action-1', 'scenario-1', 'scenario_completed', 'tag',
              '{"tagIds":["tag-main"]}', '{"value":"tag-main"}');

      INSERT INTO auto_replies
        (id, keyword, response_content, actions_json, friend_conditions_json)
      VALUES ('auto-reply-1', '申込', '受付しました',
              '[{"config":{"tagIds":["tag-main"]}}]',
              '{"rules":[{"value":"tag-main"}]}');

      INSERT INTO saved_searches (id, name, scope, conditions_json)
      VALUES ('search-1', '要対応', 'chats',
              '{"all":[{"kind":"tag","value":"tag-main"}]}');

      INSERT INTO automation_definitions (id, line_account_id, name, status)
      VALUES ('automation-1', 'account-1', '新自動化', 'active');
      INSERT INTO automation_versions
        (id, automation_id, version_number, status, trigger_type,
         trigger_config, condition_config, action_config)
      VALUES ('automation-version-1', 'automation-1', 1, 'draft', 'tag_change',
              '{"tagId":"tag-main"}', '{"tagId":"tag-main"}',
              '[{"type":"add_tag","params":{"tagId":"tag-main"}}]');
      INSERT INTO automations (id, name, event_type, conditions, actions)
      VALUES ('legacy-automation-1', '旧自動化', 'tag_change',
              '{"tagId":"tag-main"}',
              '[{"type":"add_tag","params":{"tagId":"tag-main"}}]');

      INSERT INTO common_actions (id, line_account_id, name)
      VALUES ('common-action-1', 'account-1', '共通処理');
      INSERT INTO common_action_versions
        (id, common_action_id, version_number, action_config)
      VALUES ('common-action-version-1', 'common-action-1', 1,
              '[{"type":"add_tag","params":{"tagId":"tag-main"}}]');

      INSERT INTO rich_menu_groups
        (id, account_id, name, chat_bar_text, size, targeting_condition)
      VALUES ('rich-menu-1', 'account-1', '会員メニュー', 'メニュー', 'large',
              '{"rules":[{"value":"tag-main"}]}');
      INSERT INTO rich_menu_pages (id, group_id, order_index, name, alias_id)
      VALUES ('rich-menu-page-1', 'rich-menu-1', 0, 'トップ', 'alias-1');
      INSERT INTO rich_menu_areas
        (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height,
         action_type, action_data, tag_ids)
      VALUES ('rich-menu-area-1', 'rich-menu-page-1', 0, 0, 100, 100,
              'message', '開く', '["tag-main"]');

      INSERT INTO templates
        (id, name, message_type, message_content, carousel_actions_json)
      VALUES ('template-1', '商品案内', 'carousel', '[]',
              '{"0":{"0":[{"config":{"tagIds":["tag-main"]}}]}}');
      INSERT INTO webinars
        (id, title, slug, tag_on_attend, tag_on_cta_click, created_at, updated_at)
      VALUES ('webinar-1', '説明会', 'seminar', 'tag-main', 'tag-main',
              datetime('now'), datetime('now'));
      INSERT INTO reminders (id, name, target_tag_id)
      VALUES ('reminder-1', '前日の案内', 'tag-main');
      INSERT INTO entry_routes (id, ref_code, name, tag_id)
      VALUES ('entry-route-1', 'campaign', '広告', 'tag-main');
      INSERT INTO tracked_links (id, name, original_url, tag_id)
      VALUES ('tracked-link-1', '商品ページ', 'https://example.com', 'tag-main');
      INSERT INTO menus
        (id, line_account_id, name, duration_minutes, base_price, auto_tag_id)
      VALUES ('menu-1', 'account-1', '相談', 30, 0, 'tag-main');
      INSERT INTO affiliate_offers (id, name, tag_id, created_at)
      VALUES ('offer-1', '紹介特典', 'tag-main', datetime('now'));
      INSERT INTO events (id, line_account_id, name, visible_tag_id)
      VALUES ('event-1', 'account-1', '相談会', 'tag-main');

      INSERT INTO funnels (id, name, line_account_id, segment_json)
      VALUES ('funnel-1', '申込まで', 'account-1',
              '{"kind":"tag","tagId":"tag-main"}');
      INSERT INTO funnel_steps (id, funnel_id, step_order, label, kind, match_json)
      VALUES ('funnel-step-1', 'funnel-1', 1, '対象', 'tag',
              '{"tagId":"tag-main"}');
      INSERT INTO analytics_funnel_versions
        (id, funnel_id, line_account_id, version_number, window_days,
         steps_json, segment_json, comparison_groups_json, created_at)
      VALUES ('funnel-version-1', 'funnel-1', 'account-1', 1, 30,
              '[{"match":{"tagId":"tag-main"}}]',
              '{"kind":"tag","tagId":"tag-main"}',
              '[{"filter":{"tagId":"tag-main"}}]', datetime('now'));

      INSERT INTO account_settings (id, line_account_id, key, value)
      VALUES ('setting-1', 'account-1', 'friend_add_routing',
              '{"firstTime":{"actions":[{"kind":"tag","tagId":"tag-main"}]}}');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('友だち人数と全運用設定を分け、同じ機能内の重複は1件にまとめる', async () => {
    const impact = await getTagDeleteImpact(db, 'tag-main');

    expect(impact).toEqual({
      tag: { id: 'tag-main', name: '申込済み' },
      friendCount: 2,
      references: {
        broadcasts: 1,
        forms: 1,
        scenarios: 1,
        autoReplies: 1,
        savedSearches: 1,
        automations: 2,
        commonActions: 1,
        richMenus: 1,
        templates: 1,
        webinars: 1,
        reminders: 1,
        entryRoutes: 1,
        trackedLinks: 1,
        bookingMenus: 1,
        affiliateOffers: 1,
        events: 1,
        analyticsFunnels: 1,
        friendAddSettings: 1,
      },
      blockingReferenceCount: 19,
      canDelete: false,
    });
  });

  it('未使用タグは安全に削除できると判定する', async () => {
    const impact = await getTagDeleteImpact(db, 'tag-unused');
    expect(impact).toMatchObject({
      friendCount: 0,
      blockingReferenceCount: 0,
      canDelete: true,
    });
    expect(Object.values(impact?.references ?? {})).toEqual(Array(18).fill(0));
  });

  it('存在しないタグはnullを返す', async () => {
    await expect(getTagDeleteImpact(db, 'missing')).resolves.toBeNull();
  });
});
