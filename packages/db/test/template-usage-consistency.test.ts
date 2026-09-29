import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTemplateUsage, getTemplatesWithUsageCount } from '../src/templates.js';

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

function usageTotal(usage: Awaited<ReturnType<typeof getTemplateUsage>>): number {
  return Object.values(usage).reduce((total, items) => total + items.length, 0);
}

describe('テンプレートの使用先数と詳細の一致 (#891)', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret'),
             ('account-2', 'channel-2', '支店', 'token', 'secret');

      INSERT INTO templates (id, name, message_type, message_content, line_account_id)
      VALUES ('tpl-unused', '未使用', 'text', '本文', 'account-1'),
             ('tpl-one', '一か所', 'text', '本文', 'account-1'),
             ('tpl-multi', 'たくさん', 'text', '本文', 'account-1'),
             ('tpl-cross', '別店から参照', 'text', '本文', 'account-1'),
             ('tpl-camel', 'キャメルキー参照', 'text', '本文', 'account-1'),
             ('tpl-other', '支店のテンプレ', 'text', '本文', 'account-2');

      -- tpl-one: 自動応答1件だけ。さらに別アカウントのオートメーションからも
      -- 参照されている（一覧・詳細のどちらにも出してはいけない）。
      INSERT INTO auto_replies
        (id, keyword, response_content, template_id, line_account_id)
      VALUES ('ar-1', '予約', '受付しました', 'tpl-one', 'account-1'),
             ('ar-2', '変更', '承りました', 'tpl-multi', 'account-1'),
             ('ar-x', '支店専用', '支店の返信', 'tpl-cross', 'account-2');

      -- tpl-multi: 1つのオートメーションが同じテンプレートを2アクションで
      -- 使う。使用先としてはオートメーション1件（詳細と同じ粒度）。
      -- au-2 は実行系が読むもう1つのキー templateId（キャメル）で
      -- tpl-camel を参照する。au-x は別アカウントのオートメーションで
      -- tpl-one を参照している。
      INSERT INTO automations (id, name, event_type, actions, line_account_id)
      VALUES ('au-1', '予約後フォロー', 'booking',
              '[{"type":"send","params":{"template_id":"tpl-multi"}},{"type":"send","params":{"template_id":"tpl-multi"}}]',
              'account-1'),
             ('au-2', 'キャメルキー', 'booking',
              '[{"type":"send_message","params":{"templateId":"tpl-camel"}}]',
              'account-1'),
             ('au-x', '支店の仕掛け', 'booking',
              '[{"type":"send","params":{"template_id":"tpl-one"}}]',
              'account-2');

      INSERT INTO scenarios (id, name, trigger_type, line_account_id)
      VALUES ('sc-1', '来店後', 'manual', 'account-1');
      INSERT INTO scenario_steps
        (id, scenario_id, step_order, message_type, message_content, template_id)
      VALUES ('ss-1', 'sc-1', 1, 'text', '本文', 'tpl-multi');

      INSERT INTO reminders (id, name, trigger_type, line_account_id)
      VALUES ('re-1', '前日案内', 'manual', 'account-1');
      INSERT INTO reminder_steps
        (id, reminder_id, offset_minutes, message_type, message_content, template_id)
      VALUES ('rs-1', 're-1', 1440, 'text', '本文', 'tpl-multi');

      INSERT INTO rich_menu_groups (id, account_id, name, chat_bar_text, size)
      VALUES ('rg-1', 'account-1', '基本', 'メニュー', 'large');
      INSERT INTO rich_menu_pages (id, group_id, order_index, name, alias_id)
      VALUES ('rp-1', 'rg-1', 0, '表', 'alias-1');
      INSERT INTO rich_menu_areas
        (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height, action_type, action_data, template_id)
      VALUES ('ra-1', 'rp-1', 0, 0, 100, 100, 'message', '予約', 'tpl-multi');

      INSERT INTO tracked_links (id, name, original_url, template_id, line_account_id)
      VALUES ('tl-1', '広告A', 'https://example.com', 'tpl-multi', 'account-1');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('使われていないテンプレートは一覧も詳細も0件', async () => {
    const list = await getTemplatesWithUsageCount(db);
    const usage = await getTemplateUsage(db, 'tpl-unused', 'account-1');

    expect(list.items.find((t) => t.id === 'tpl-unused')?.usage_count).toBe(0);
    expect(usageTotal(usage)).toBe(0);
  });

  it('1か所だけの使用は一覧・詳細ともに1件', async () => {
    const list = await getTemplatesWithUsageCount(db);
    const usage = await getTemplateUsage(db, 'tpl-one', 'account-1');

    expect(list.items.find((t) => t.id === 'tpl-one')?.usage_count).toBe(1);
    expect(usageTotal(usage)).toBe(1);
    expect(usage.autoReplies).toHaveLength(1);
  });

  it('複数の使用先は一覧の数と詳細の件数が一致する', async () => {
    const list = await getTemplatesWithUsageCount(db);
    const usage = await getTemplateUsage(db, 'tpl-multi', 'account-1');

    // 自動応答・オートメーション・シナリオ・リマインダ・リッチメニュー・流入リンクの6件
    expect(list.items.find((t) => t.id === 'tpl-multi')?.usage_count).toBe(6);
    expect(usageTotal(usage)).toBe(6);
    expect(usage.automations).toHaveLength(1);
  });

  it('1つのオートメーションが同じテンプレートを複数アクションで使っても1件', async () => {
    const usage = await getTemplateUsage(db, 'tpl-multi', 'account-1');
    expect(usage.automations.map((a) => a.id)).toEqual(['au-1']);
  });

  it('オートメーションは templateId（キャメル）のキーも参照として数える', async () => {
    const list = await getTemplatesWithUsageCount(db);
    const usage = await getTemplateUsage(db, 'tpl-camel', 'account-1');

    expect(list.items.find((t) => t.id === 'tpl-camel')?.usage_count).toBe(1);
    expect(usage.automations.map((a) => a.id)).toEqual(['au-2']);
    expect(usageTotal(usage)).toBe(1);
  });

  it('別アカウントの使用先は一覧の数にも詳細にも出ない', async () => {
    const list = await getTemplatesWithUsageCount(db);

    // account-1 のテンプレートを account-2 の設定が参照していても、
    // account-1 の運用者には見せない（名前・遷移先が解決できず削除だけが止まるため）。
    expect(list.items.find((t) => t.id === 'tpl-cross')?.usage_count).toBe(0);
    expect(list.items.find((t) => t.id === 'tpl-one')?.usage_count).toBe(1);

    const cross = await getTemplateUsage(db, 'tpl-cross', 'account-1');
    expect(usageTotal(cross)).toBe(0);

    const one = await getTemplateUsage(db, 'tpl-one', 'account-1');
    expect(one.automations).toHaveLength(0);
  });

  it('アカウント絞り込みの一覧に別アカウントのテンプレートは出ない', async () => {
    const scoped = await getTemplatesWithUsageCount(db, undefined, {
      accountIds: ['account-1'],
      includeUnassigned: false,
    });

    expect(scoped.items.map((t) => t.id)).not.toContain('tpl-other');
    expect(scoped.items.every((t) => t.line_account_id === 'account-1')).toBe(true);
  });
});
