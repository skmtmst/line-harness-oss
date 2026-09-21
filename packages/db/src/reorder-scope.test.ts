import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { reorderFriendFields } from './friend-fields.js';
import { reorderSupportMarks } from './support-marks.js';
import { reorderSavedSearches } from './saved-searches.js';

const packageRoot = join(import.meta.dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

const TENANT = 'tenant-1';
const ACCOUNT = 'account-a';

function seedBase(sqlite: Database.Database): void {
  sqlite.prepare(`INSERT INTO tenants (id, name) VALUES (?, ?)`).run(TENANT, 'テスト');
  for (const id of [ACCOUNT, 'account-b']) {
    sqlite.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret)
       VALUES (?, ?, ?, 'token', 'secret')`,
    ).run(id, `channel-${id}`, id);
  }
}

function seedField(
  sqlite: Database.Database,
  id: string,
  displayOrder: number,
  lineAccountId: string | null,
): void {
  sqlite.prepare(
    `INSERT INTO friend_fields (id, name, field_key, type, display_order)
     VALUES (?, ?, ?, 'text', ?)`,
  ).run(id, id, `key_${id.replace(/-/g, '_')}`, displayOrder);
  sqlite.prepare(
    `INSERT INTO friend_field_scopes (field_id, tenant_id, line_account_id, created_at)
     VALUES (?, ?, ?, '2026-09-01')`,
  ).run(id, TENANT, lineAccountId);
}

function seedMark(
  sqlite: Database.Database,
  id: string,
  displayOrder: number,
  lineAccountId: string | null,
): void {
  sqlite.prepare(
    `INSERT INTO support_marks (id, name, display_order) VALUES (?, ?, ?)`,
  ).run(id, id, displayOrder);
  sqlite.prepare(
    `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
     VALUES (?, ?, ?, '2026-09-01')`,
  ).run(id, TENANT, lineAccountId);
}

function seedSearch(
  sqlite: Database.Database,
  id: string,
  displayOrder: number,
  createdBy: string,
  isShared: number,
  lineAccountId: string | null = ACCOUNT,
): void {
  sqlite.prepare(
    `INSERT INTO saved_searches
       (id, name, scope, conditions_json, created_by, is_shared, display_order, line_account_id)
     VALUES (?, ?, 'friends', '{"all":[{"kind":"tag","op":"has","value":"t1"}]}', ?, ?, ?, ?)`,
  ).run(id, id, createdBy, isShared, displayOrder, lineAccountId);
}

function orders(sqlite: Database.Database, table: string, ids: string[]): number[] {
  return ids.map((id) =>
    Number((sqlite.prepare(`SELECT display_order AS n FROM ${table} WHERE id = ?`).get(id) as { n: number }).n));
}

describe('並び替えのまとめ保存（#1014 ATTR-02/03/04）', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    seedBase(sqlite);
    db = asD1(sqlite);
  });

  it('項目: 届いた並びだけ入れ替え、届いていない行は元の位置に残す', async () => {
    seedField(sqlite, 'ff-1', 0, ACCOUNT);
    seedField(sqlite, 'ff-2', 1, ACCOUNT);
    seedField(sqlite, 'ff-3', 2, ACCOUNT);

    await reorderFriendFields(db, { tenantId: TENANT, lineAccountId: ACCOUNT }, ['ff-3', 'ff-1']);

    // 依頼した行が占めていた位置（0と2）を、依頼された順（ff-3, ff-1）で埋め直す。
    // 依頼に無い ff-2 の位置1はそのまま。
    expect(orders(sqlite, 'friend_fields', ['ff-1', 'ff-2', 'ff-3'])).toEqual([2, 1, 0]);
  });

  it('項目: 共通項目（is_inherited）は指定されても動かさない', async () => {
    seedField(sqlite, 'ff-1', 0, ACCOUNT);
    seedField(sqlite, 'ff-common', 7, null);
    seedField(sqlite, 'ff-2', 1, ACCOUNT);

    await reorderFriendFields(db, { tenantId: TENANT, lineAccountId: ACCOUNT }, ['ff-common', 'ff-2', 'ff-1']);

    // 共通項目は movable ではないので依頼から落ち、ff-2/ff-1 だけが入れ替わる。
    expect(orders(sqlite, 'friend_fields', ['ff-1', 'ff-2', 'ff-common'])).toEqual([1, 0, 7]);
  });

  it('項目: 別アカウントのIDを混ぜても無視される', async () => {
    seedField(sqlite, 'ff-1', 0, ACCOUNT);
    seedField(sqlite, 'ff-2', 1, ACCOUNT);
    seedField(sqlite, 'ff-b', 0, 'account-b');

    await reorderFriendFields(db, { tenantId: TENANT, lineAccountId: ACCOUNT }, ['ff-b', 'ff-2', 'ff-1']);

    expect(orders(sqlite, 'friend_fields', ['ff-1', 'ff-2', 'ff-b'])).toEqual([1, 0, 0]);
  });

  it('対応マーク: 共有マークの位置を保ったまま専用マークだけ入れ替わる', async () => {
    seedMark(sqlite, 'm-1', 0, ACCOUNT);
    seedMark(sqlite, 'm-2', 1, ACCOUNT);
    seedMark(sqlite, 'm-common', 9, null);

    await reorderSupportMarks(db, { tenantId: TENANT, lineAccountId: ACCOUNT }, ['m-2', 'm-1']);

    expect(orders(sqlite, 'support_marks', ['m-1', 'm-2', 'm-common'])).toEqual([1, 0, 9]);
  });

  it('保存した検索: 他人が作った検索の位置を保ったまま自分の検索だけ入れ替わる', async () => {
    seedSearch(sqlite, 's-1', 0, 'u-1', 0);
    seedSearch(sqlite, 's-2', 1, 'u-2', 1);
    seedSearch(sqlite, 's-3', 2, 'u-1', 0);

    // staff（canManageAll=false）は自分が作った s-1/s-3 だけ動かせる。
    await reorderSavedSearches(
      db,
      { lineAccountId: ACCOUNT, staffId: 'u-1', canManageAll: false },
      ['s-3', 's-2', 's-1'],
    );

    // s-2 は movable ではないので位置1に残り、s-3/s-1 が残る位置を埋め直す。
    expect(orders(sqlite, 'saved_searches', ['s-1', 's-2', 's-3'])).toEqual([2, 1, 0]);
  });

  it('保存した検索: owner/admin は共有されている他人の検索も動かせる', async () => {
    seedSearch(sqlite, 's-1', 0, 'u-1', 0);
    seedSearch(sqlite, 's-2', 1, 'u-2', 1);
    seedSearch(sqlite, 's-3', 2, 'u-1', 0);

    await reorderSavedSearches(
      db,
      { lineAccountId: ACCOUNT, staffId: 'admin-1', canManageAll: true },
      ['s-2', 's-3', 's-1'],
    );

    expect(orders(sqlite, 'saved_searches', ['s-1', 's-2', 's-3'])).toEqual([2, 0, 1]);
  });

  it('動かせる行が2件未満なら何も書かない', async () => {
    seedSearch(sqlite, 's-1', 0, 'u-1', 0);
    seedSearch(sqlite, 's-2', 1, 'u-2', 1);

    await reorderSavedSearches(
      db,
      { lineAccountId: ACCOUNT, staffId: 'u-1', canManageAll: false },
      ['s-2'],
    );

    expect(orders(sqlite, 'saved_searches', ['s-1', 's-2'])).toEqual([0, 1]);
  });
});
