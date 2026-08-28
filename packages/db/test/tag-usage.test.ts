import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_TAG_USAGE_COMPOUND_SELECT_TERMS,
  TAG_USAGE_BLOCKING_REFERENCE_SELECTS,
  buildTagUsageBlockingReferenceQueries,
  collectTagUsageBlockingTagIds,
  getTagsWithUsage,
} from '../src/tags.js';

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

describe('タグの使用先集計', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');

      INSERT INTO tags (id, name, line_account_id, display_order)
      VALUES ('tag-main', '申込済み', 'account-1', 0),
             ('tag-main-extra', '部分一致防止', 'account-1', 1),
             ('tag-unused', '未使用', 'account-1', 2),
             ('nen-tag-member-line-linked', 'LINEログイン連携済み', 'account-1', 3),
             ('nen-tag-member-ec-linked', 'EC顧客連携済み', 'account-1', 4),
             ('nen-tag-purchase-first', '初回購入', 'account-1', 5),
             ('nen-tag-pet-birthday-this-month', '誕生日が今月', 'account-1', 6),
             ('tag-reminder-only', 'リマインダ専用', 'account-1', 7),
             ('tag-duplicate-wide', 'ＶＩＰ　顧客', 'account-1', 8),
             ('tag-duplicate-lower', 'vip 顧客', 'account-1', 9);

      INSERT INTO friends (id, line_user_id, line_account_id)
      VALUES ('friend-1', 'U1', 'account-1'), ('friend-2', 'U2', 'account-1');
      INSERT INTO friend_tags (friend_id, tag_id)
      VALUES ('friend-1', 'tag-main'), ('friend-2', 'tag-main');

      INSERT INTO broadcasts
        (id, title, message_type, message_content, target_tag_id, segment_conditions)
      VALUES ('broadcast-1', '直接指定', 'text', '本文', 'tag-main', NULL),
             ('broadcast-2', '条件指定', 'text', '本文', NULL,
              '{"operator":"AND","rules":[{"type":"tag_exists","value":"tag-main"}]}'),
             ('broadcast-3', '似たID', 'text', '本文', NULL,
              '{"operator":"AND","rules":[{"type":"tag_exists","value":"tag-main-extra"}]}');

      INSERT INTO forms (id, name, on_submit_tag_id, layout)
      VALUES ('form-1', '申込', 'tag-main', NULL),
             ('form-2', 'アンケート', NULL,
              '{"sections":[{"blocks":[{"choices":[{"tagId":"tag-main"}]}]}]}');

      INSERT INTO scenarios (id, name, trigger_type, trigger_tag_id, audience_condition_json)
      VALUES ('scenario-1', '案内', 'tag_added', 'tag-main',
              '{"rules":[{"type":"tag_exists","value":"tag-main"}]}'),
             ('scenario-2', '継続', 'manual', NULL, NULL);
      INSERT INTO scenario_steps
        (id, scenario_id, step_order, message_type, message_content, on_reach_tag_id)
      VALUES ('step-1', 'scenario-2', 1, 'text', '本文', 'tag-main');
      INSERT INTO scenario_actions
        (id, scenario_id, hook, action_type, config_json)
      VALUES ('scenario-action-1', 'scenario-1', 'scenario_completed', 'tag',
              '{"op":"add","tagIds":["tag-main"]}');

      INSERT INTO auto_replies
        (id, keyword, response_content, actions_json, friend_conditions_json)
      VALUES ('auto-reply-1', '申込', '受付しました',
              '[{"actionType":"tag","config":{"tagIds":["tag-main"]}}]',
              '{"rules":[{"type":"tag_exists","value":"tag-main"}]}');

      INSERT INTO saved_searches (id, name, scope, conditions_json)
      VALUES ('search-1', '申込済み', 'friends',
              '{"all":[{"type":"tag_exists","value":"tag-main"}]}'),
             ('search-2', '受信箱用', 'chats',
              '{"all":[{"type":"tag_exists","value":"tag-main"}]}');

      INSERT INTO menus
        (id, line_account_id, name, duration_minutes, base_price, auto_tag_id)
      VALUES ('menu-1', 'account-1', '相談', 30, 0, 'tag-main');
      INSERT INTO tracked_links
        (id, name, original_url, tag_id, created_at, updated_at)
      VALUES ('link-1', '申込リンク', 'https://example.com', 'tag-main',
              datetime('now'), datetime('now'));
      INSERT INTO reminders (id, name, target_tag_id)
      VALUES ('reminder-only', '前日の案内', 'tag-reminder-only');

      INSERT INTO automation_definitions
        (id, line_account_id, name, status)
      VALUES ('automation-1', 'account-1', 'タグ後の案内', 'active');
      INSERT INTO automation_versions
        (id, automation_id, version_number, status, trigger_type,
         trigger_config, action_config, published_at)
      VALUES ('automation-version-1', 'automation-1', 1, 'published', 'tag_change',
              '{"tagId":"tag-main","action":"add"}',
              '[{"type":"send_message"},{"type":"start_scenario"}]', datetime('now'));
      UPDATE automation_definitions
         SET current_published_version_id = 'automation-version-1'
       WHERE id = 'automation-1';

      INSERT INTO automations
        (id, name, event_type, conditions, actions)
      VALUES ('legacy-automation-1', '旧案内', 'tag_change',
              '{"tagId":"tag-main"}', '[{"type":"send_message"}]');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('同じ機能内の重複をまとめ、IDの部分一致を数えない', async () => {
    const rows = await getTagsWithUsage(db);
    const tag = rows.find((row) => row.id === 'tag-main');

    expect(tag).toMatchObject({
      friend_count: 2,
      assign_source: 'form',
      used_in_broadcasts: 2,
      used_in_forms: 2,
      used_in_scenarios: 2,
      used_in_auto_replies: 1,
      used_in_saved_searches: 1,
      // タグ起点のシナリオ1・V6自動化2アクション・旧自動化1アクション。
      // フォームや予約の「タグを付ける設定」は逆向きなので数えない。
      other_action_count: 4,
    });
    expect(rows.find((row) => row.id === 'tag-main-extra')).toMatchObject({
      used_in_broadcasts: 1,
      used_in_forms: 0,
      cleanup_reasons: [],
    });
  });

  it('使われていない一般タグの付与元を手動と推測しない', async () => {
    const rows = await getTagsWithUsage(db);
    expect(rows.find((row) => row.id === 'tag-unused')).toMatchObject({
      assign_source: null,
      used_in_broadcasts: 0,
      used_in_forms: 0,
      used_in_scenarios: 0,
      used_in_auto_replies: 0,
      used_in_saved_searches: 0,
      other_action_count: 0,
      cleanup_reasons: ['unused'],
    });
  });

  it('友だち0人でも運用設定に使うタグは未使用にしない', async () => {
    const rows = await getTagsWithUsage(db);
    expect(rows.find((row) => row.id === 'tag-reminder-only')).toMatchObject({
      friend_count: 0,
      cleanup_reasons: [],
    });
  });

  it('削除済みリマインダのタグ参照は使用中として数えない', async () => {
    sqlite.prepare(`UPDATE reminders SET deleted_at = datetime('now') WHERE id = 'reminder-only'`).run();

    const rows = await getTagsWithUsage(db);
    expect(rows.find((row) => row.id === 'tag-reminder-only')).toMatchObject({
      friend_count: 0,
      cleanup_reasons: ['unused'],
    });
  });

  it('運用参照の複合SELECTを安全な項数以下へ分割する', () => {
    const queries = buildTagUsageBlockingReferenceQueries();
    expect(queries.length).toBeGreaterThan(1);
    for (const query of queries) {
      expect(query.split(/\nUNION\n/u).length)
        .toBeLessThanOrEqual(MAX_TAG_USAGE_COMPOUND_SELECT_TERMS);
    }
  });

  it('参照元を1種類増やしても分割し、参照タグを集合へ合流する', async () => {
    const addedReference = "SELECT id AS tag_id FROM tags WHERE id = 'tag-unused'";
    const selects = [...TAG_USAGE_BLOCKING_REFERENCE_SELECTS, addedReference];
    const queries = buildTagUsageBlockingReferenceQueries(selects);

    expect(queries.every((query) => query.split(/\nUNION\n/u).length
      <= MAX_TAG_USAGE_COMPOUND_SELECT_TERMS)).toBe(true);
    await expect(collectTagUsageBlockingTagIds(db, selects))
      .resolves.toContain('tag-unused');
  });

  it('フォーム内のタグIDではない文字列を参照タグとして返さない', async () => {
    sqlite.exec(`
      UPDATE forms
         SET on_submit_tag_id = NULL,
             layout = '{"fields":[{"type":"text","label":"お名前","choices":["月","火"]}]}'
    `);
    const formLayoutSelect = TAG_USAGE_BLOCKING_REFERENCE_SELECTS[3];

    await expect(collectTagUsageBlockingTagIds(db, [formLayoutSelect]))
      .resolves.toEqual(new Set());
  });

  it('フォーム内の文字列から実在するタグIDだけを返す', async () => {
    sqlite.exec(`
      UPDATE forms
         SET on_submit_tag_id = NULL,
             layout = '{"fields":[{"type":"text","label":"お名前","choices":["月","tag-main"]}]}'
    `);
    const formLayoutSelect = TAG_USAGE_BLOCKING_REFERENCE_SELECTS[3];

    await expect(collectTagUsageBlockingTagIds(db, [formLayoutSelect]))
      .resolves.toEqual(new Set(['tag-main']));
  });

  it('全角・空白・大文字小文字だけ違う名前を重複候補にする', async () => {
    const rows = await getTagsWithUsage(db);
    expect(rows.find((row) => row.id === 'tag-duplicate-wide')?.cleanup_reasons)
      .toEqual(['unused', 'duplicate_name']);
    expect(rows.find((row) => row.id === 'tag-duplicate-lower')?.cleanup_reasons)
      .toEqual(['unused', 'duplicate_name']);
  });

  it('システム管理タグだけは実装上の付与元を返す', async () => {
    const rows = await getTagsWithUsage(db);
    expect(rows.find((row) => row.id === 'nen-tag-member-line-linked')?.assign_source)
      .toBe('line_login');
    expect(rows.find((row) => row.id === 'nen-tag-member-ec-linked')?.assign_source)
      .toBe('ec');
    expect(rows.find((row) => row.id === 'nen-tag-purchase-first')?.assign_source)
      .toBe('ec_purchase');
    expect(rows.find((row) => row.id === 'nen-tag-pet-birthday-this-month')?.assign_source)
      .toBe('birthday');
  });
});
