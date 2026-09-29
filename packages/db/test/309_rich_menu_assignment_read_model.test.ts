import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getRichMenuAudienceStats,
  recordRichMenuAssignment,
  recordRichMenuAssignmentsByLineUserIds,
} from '../src/rich-menus.js';

function asD1(sqlite: Database.Database): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} };
      },
      async first<T>() {
        return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = sqlite.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: result.changes } } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  };
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
}

describe('リッチメニュー割当の現在値と今月ユニーク人数', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
      INSERT INTO friends
        (id, line_user_id, display_name, line_account_id, is_following)
      VALUES ('friend-1', 'U001', '一郎', 'account-1', 1),
             ('friend-2', 'U002', '二郎', 'account-1', 1);
      INSERT INTO rich_menu_groups
        (id, account_id, name, chat_bar_text, size, is_default_for_all, status)
      VALUES ('group-targeted', 'account-1', '会員向け', 'メニュー', 'large', 0, 'published'),
             ('group-default', 'account-1', '通常', 'メニュー', 'large', 1, 'published');
      INSERT INTO rich_menu_pages
        (id, group_id, order_index, name, alias_id, line_richmenu_id)
      VALUES ('page-targeted', 'group-targeted', 0, 'ホーム', 'targeted-0', 'richmenu-targeted'),
             ('page-default', 'group-default', 0, 'ホーム', 'default-0', 'richmenu-default');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('同じ友だちへの再割当は今月の人数を重複させない', async () => {
    for (const idempotencyKey of ['event-1', 'event-2']) {
      await recordRichMenuAssignment(db, {
        friendId: 'friend-1',
        lineAccountId: 'account-1',
        lineRichMenuId: 'richmenu-targeted',
        reasonKind: 'targeting_rule',
        idempotencyKey,
        assignedAt: '2026-09-07T10:00:00.000',
      });
    }

    const stats = await getRichMenuAudienceStats(
      db,
      'account-1',
      '2026-09-01T00:00:00.000',
      '2026-10-01T00:00:00.000',
    );

    expect(stats).toEqual(expect.arrayContaining([
      { groupId: 'group-targeted', currentAudience: 1, monthlyUniqueAudience: 1 },
      { groupId: 'group-default', currentAudience: 1, monthlyUniqueAudience: 0 },
    ]));
  });

  it('個別割当を外すと現在値だけ既定メニューへ戻し、今月履歴は残す', async () => {
    await recordRichMenuAssignment(db, {
      friendId: 'friend-1', lineAccountId: 'account-1',
      lineRichMenuId: 'richmenu-targeted', reasonKind: 'manual_friend_link',
      idempotencyKey: 'link-1', assignedAt: '2026-09-07T10:00:00.000',
    });
    await recordRichMenuAssignment(db, {
      friendId: 'friend-1', lineAccountId: 'account-1',
      lineRichMenuId: null, reasonKind: 'manual_friend_unlink',
      idempotencyKey: 'unlink-1', assignedAt: '2026-09-07T11:00:00.000',
    });

    const stats = await getRichMenuAudienceStats(
      db, 'account-1', '2026-09-01T00:00:00.000', '2026-10-01T00:00:00.000',
    );

    expect(stats).toEqual(expect.arrayContaining([
      { groupId: 'group-targeted', currentAudience: 0, monthlyUniqueAudience: 1 },
      { groupId: 'group-default', currentAudience: 2, monthlyUniqueAudience: 0 },
    ]));
  });

  it('bulk link の成功チャンクをLINE user idから全員分記録する', async () => {
    await recordRichMenuAssignmentsByLineUserIds(db, {
      lineAccountId: 'account-1', groupId: 'group-targeted',
      lineRichMenuId: 'richmenu-targeted', lineUserIds: ['U001', 'U002'],
      reasonKind: 'all_followers_bulk_apply', idempotencyPrefix: 'bulk-1',
      assignedAt: '2026-09-07T12:00:00.000',
    });

    const current = sqlite.prepare(
      `SELECT COUNT(*) AS count FROM rich_menu_assignments WHERE group_id = 'group-targeted'`,
    ).get() as { count: number };
    const runs = sqlite.prepare(
      `SELECT COUNT(*) AS count FROM rich_menu_assignment_runs WHERE group_id = 'group-targeted'`,
    ).get() as { count: number };

    expect(current.count).toBe(2);
    expect(runs.count).toBe(2);
  });
});
