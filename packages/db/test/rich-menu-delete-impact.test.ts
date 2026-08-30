import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getRichMenuDeleteImpact } from '../src/rich-menus.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const prepared = () => sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const result = prepared().run(...params);
              return { success: true, results: [], meta: { changes: result.changes } };
            },
            async first<T>() {
              return (prepared().get(...params) as T) ?? null;
            },
            async all<T>() {
              return { success: true, results: prepared().all(...params) as T[], meta: {} };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function insertAccount(sqlite: Database.Database, id = 'account-1') {
  sqlite.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_secret, channel_access_token, created_at, updated_at)
     VALUES (?, ?, ?, 'secret', 'token', '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
  ).run(id, `channel-${id}`, `Account ${id}`);
}

function insertGroup(
  sqlite: Database.Database,
  input: {
    id: string;
    name?: string;
    status?: 'draft' | 'published';
    priority?: number;
    targeting?: boolean;
    isDefault?: boolean;
    publishingAt?: string | null;
    createdAt?: string;
  },
) {
  sqlite.prepare(
    `INSERT INTO rich_menu_groups
       (id, account_id, name, chat_bar_text, size, is_default_for_all, status,
        publishing_at, targeting_condition, targeting_priority, targeting_enabled,
        created_at, updated_at)
     VALUES (?, 'account-1', ?, 'メニュー', 'large', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name ?? input.id,
    input.isDefault ? 1 : 0,
    input.status ?? 'draft',
    input.publishingAt ?? null,
    input.targeting ? '{"kind":"all"}' : null,
    input.priority ?? 0,
    input.targeting ? 1 : 0,
    input.createdAt ?? '2026-08-31T10:00:00.000',
    input.createdAt ?? '2026-08-31T10:00:00.000',
  );
}

function insertPage(
  sqlite: Database.Database,
  groupId: string,
  id: string,
  lineRichMenuId: string | null = null,
  orderIndex = 0,
) {
  sqlite.prepare(
    `INSERT INTO rich_menu_pages
       (id, group_id, order_index, name, alias_id, line_richmenu_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
  ).run(id, groupId, orderIndex, `Page ${id}`, `alias-${id}`, lineRichMenuId);
}

describe('getRichMenuDeleteImpact', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    insertAccount(sqlite);
  });

  test('下書きでLINE実体も参照も無いときだけ削除できる', async () => {
    insertGroup(sqlite, { id: 'target', name: '下書きメニュー' });
    insertPage(sqlite, 'target', 'target-page');
    db = asD1(sqlite);

    const impact = await getRichMenuDeleteImpact(db, 'target');

    expect(impact).toMatchObject({
      group: { id: 'target', name: '下書きメニュー', status: 'draft' },
      currentAudience: { value: null, reason: 'assignment_ledger_unavailable' },
      nextDisplay: { guaranteedGroupId: null, reason: 'friend_specific_rules' },
      incomingSwitches: [],
      operationalReferences: [],
      lineResources: {
        pageCount: 1,
        pagesWithLineRichMenuId: 0,
        isDefaultForAll: false,
        publishing: false,
      },
      blockers: [],
      canDelete: true,
      recommendedAction: 'delete',
    });
  });

  test('公開中・デフォルト・LINE実体を別々の停止理由にする', async () => {
    insertGroup(sqlite, {
      id: 'target',
      status: 'published',
      isDefault: true,
      publishingAt: '2026-08-31T10:01:00.000',
    });
    insertPage(sqlite, 'target', 'target-page', 'line-target');
    db = asD1(sqlite);

    const impact = await getRichMenuDeleteImpact(db, 'target');

    expect(impact?.blockers).toEqual([
      'published',
      'publishing',
      'default_for_all',
      'line_resources',
    ]);
    expect(impact?.canDelete).toBe(false);
    expect(impact?.recommendedAction).toBe('unpublish');
  });

  test('次に表示されうる候補を実際の優先順で返し、1件に断定しない', async () => {
    insertGroup(sqlite, { id: 'target' });
    insertPage(sqlite, 'target', 'target-page');
    insertGroup(sqlite, {
      id: 'later', name: 'あとで見る', status: 'published', priority: 20, targeting: true,
      createdAt: '2026-08-31T10:02:00.000',
    });
    insertPage(sqlite, 'later', 'later-page', 'line-later');
    insertGroup(sqlite, {
      id: 'first', name: '先に見る', status: 'published', priority: 10, targeting: true,
      createdAt: '2026-08-31T10:03:00.000',
    });
    insertPage(sqlite, 'first', 'first-page', 'line-first');
    insertGroup(sqlite, {
      id: 'default', name: '全員の既定', status: 'published', priority: 0, isDefault: true,
      createdAt: '2026-08-31T10:04:00.000',
    });
    insertPage(sqlite, 'default', 'default-page', 'line-default');
    db = asD1(sqlite);

    const impact = await getRichMenuDeleteImpact(db, 'target');

    expect(impact?.nextDisplay).toEqual({
      guaranteedGroupId: null,
      reason: 'friend_specific_rules',
      candidates: [
        {
          groupId: 'first', name: '先に見る', targetingPriority: 10,
          isTargetingEnabled: true, isDefaultForAll: false,
        },
        {
          groupId: 'later', name: 'あとで見る', targetingPriority: 20,
          isTargetingEnabled: true, isDefaultForAll: false,
        },
        {
          groupId: 'default', name: '全員の既定', targetingPriority: 0,
          isTargetingEnabled: false, isDefaultForAll: true,
        },
      ],
    });
  });

  test('別メニューの切替と現在版の自動処理参照を見つけて削除を止める', async () => {
    insertGroup(sqlite, { id: 'target', name: '消したいメニュー' });
    insertPage(sqlite, 'target', 'target-page');
    insertGroup(sqlite, { id: 'source', name: '入口メニュー' });
    insertPage(sqlite, 'source', 'source-page');
    sqlite.prepare(
      `INSERT INTO rich_menu_areas
         (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height,
          action_type, action_data, intent, label, created_at, updated_at)
       VALUES ('area-1', 'source-page', 0, 0, 100, 100, 'richmenuswitch', ?, 'switch',
               '詳しいメニューへ', '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
    ).run(JSON.stringify({ targetPageId: 'target-page' }));

    sqlite.prepare(
      `INSERT INTO common_actions
         (id, line_account_id, name, status, created_at, updated_at)
       VALUES ('common-1', 'account-1', '問い合わせ後の処理', 'published',
               '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO common_action_versions
         (id, common_action_id, version_number, status, action_config, created_at)
       VALUES ('common-version-1', 'common-1', 1, 'published', ?, '2026-08-31T10:00:00.000')`,
    ).run(JSON.stringify([{ type: 'switch_rich_menu', params: { richMenuPageId: 'target-page' } }]));
    sqlite.prepare(
      `UPDATE common_actions SET current_published_version_id = 'common-version-1'
        WHERE id = 'common-1'`,
    ).run();

    sqlite.prepare(
      `INSERT INTO automation_definitions
         (id, line_account_id, name, status, created_at, updated_at)
       VALUES ('automation-1', 'account-1', '来店後の自動処理', 'active',
               '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO automation_versions
         (id, automation_id, version_number, status, trigger_type, action_config, created_at)
       VALUES ('automation-version-1', 'automation-1', 1, 'published', 'friend_added', ?,
               '2026-08-31T10:00:00.000')`,
    ).run(JSON.stringify([{ type: 'switch_rich_menu', params: { richMenuPageId: 'target-page' } }]));
    sqlite.prepare(
      `UPDATE automation_definitions
          SET current_published_version_id = 'automation-version-1'
        WHERE id = 'automation-1'`,
    ).run();
    db = asD1(sqlite);

    const impact = await getRichMenuDeleteImpact(db, 'target');

    expect(impact?.incomingSwitches).toEqual([
      expect.objectContaining({
        sourceGroupName: '入口メニュー',
        sourcePageName: 'Page source-page',
        areaLabel: '詳しいメニューへ',
        targetPageName: 'Page target-page',
      }),
    ]);
    expect(impact?.operationalReferences).toEqual([
      { kind: 'automation', ownerId: 'automation-1', ownerName: '来店後の自動処理' },
      { kind: 'common_action', ownerId: 'common-1', ownerName: '問い合わせ後の処理' },
    ]);
    expect(impact?.blockers).toEqual(['incoming_switches', 'operational_references']);
    expect(impact?.canDelete).toBe(false);
    expect(impact?.recommendedAction).toBe('review_references');
  });
});
