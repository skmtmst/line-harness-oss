import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  archiveFormAtRevision,
  deleteFormAtRevision,
  getFormById,
  getFormDeleteImpact,
  getFormsWithStats,
} from '../src/forms.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const prepared = () => sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const statement = prepared();
              if (statement.reader) {
                return { success: true, results: statement.all(...params), meta: {} };
              }
              const result = statement.run(...params);
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
    async batch(statements: D1PreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

function insertAccount(sqlite: Database.Database, id: string, liffId: string) {
  sqlite.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_secret, channel_access_token, liff_id, created_at, updated_at)
     VALUES (?, ?, ?, 'secret', 'token', ?, '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
  ).run(id, `channel-${id}`, `Account ${id}`, liffId);
}

function insertForm(sqlite: Database.Database, options: { active?: boolean } = {}) {
  sqlite.prepare(
    `INSERT INTO forms
       (id, name, fields, is_active, created_at, updated_at)
     VALUES ('form-1', '来店アンケート', '[]', ?,
             '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
  ).run(options.active === false ? 0 : 1);
  sqlite.prepare(
    `INSERT INTO form_accounts (form_id, line_account_id)
     VALUES ('form-1', 'account-1')`,
  ).run();
}

describe('回答フォームの削除影響と保管', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    insertAccount(sqlite, 'account-1', 'liff-account-1');
    insertAccount(sqlite, 'account-2', 'liff-account-2');
    db = asD1(sqlite);
  });

  test('非公開・回答0・利用先0のときだけ物理削除を案内する', async () => {
    insertForm(sqlite, { active: false });

    const impact = await getFormDeleteImpact(
      db, 'form-1', 'account-1', '2026-08-31T11:00:00.000',
    );

    expect(impact).toEqual({
      form: { id: 'form-1', name: '来店アンケート', isActive: false, status: 'active' },
      submissionCount: 0,
      openCount: 0,
      references: [],
      referenceCount: 0,
      answerUrl: 'https://liff.line.me/liff-account-1/?page=form&id=form-1',
      revision: 2,
      checkedAt: '2026-08-31T11:00:00.000',
      canDelete: true,
      canArchive: true,
      recommendedAction: 'delete',
      blockers: [],
    });
  });

  test('公開・回答・利用先を名前と導線付きで返し、保管を案内する', async () => {
    insertForm(sqlite);
    sqlite.prepare(
      `INSERT INTO form_submissions (id, form_id, data, created_at)
       VALUES ('submission-1', 'form-1', '{}', '2026-08-31T10:10:00.000')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO form_opens (id, form_id, friend_name, opened_at)
       VALUES ('open-1', 'form-1', '画面確認', '2026-08-31T10:05:00.000')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO webinars (id, account_id, title, slug, created_at, updated_at)
       VALUES ('webinar-1', 'account-1', '使い方講座', 'guide',
               '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO webinar_ctas
       (id, webinar_id, at_seconds, kind, title, button_label, form_id, created_at, updated_at)
       VALUES ('cta-1', 'webinar-1', 10, 'form', '回答', '答える', 'form-1',
               '2026-08-31T10:00:00.000', '2026-08-31T10:00:00.000')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO rich_menu_groups (id, account_id, name, chat_bar_text, size)
       VALUES ('menu-1', 'account-1', '通常メニュー', 'メニュー', 'large')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO rich_menu_pages (id, group_id, order_index, name, alias_id)
       VALUES ('page-1', 'menu-1', 0, '予約', 'alias-reserve')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO rich_menu_areas
       (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height, action_type, action_data, form_id)
       VALUES ('area-1', 'page-1', 0, 0, 100, 100, 'uri', '{}', 'form-1')`,
    ).run();

    const impact = await getFormDeleteImpact(db, 'form-1', 'account-1');

    expect(impact).toMatchObject({
      submissionCount: 1,
      openCount: 1,
      referenceCount: 2,
      canDelete: false,
      canArchive: true,
      recommendedAction: 'archive',
      blockers: ['published', 'has_submissions', 'has_opens', 'in_use'],
      references: [
        { kind: 'webinar', name: '使い方講座', href: '/webinars/edit?id=webinar-1', state: 'available' },
        { kind: 'rich_menu', name: '通常メニュー・予約', href: '/rich-menus/edit?id=menu-1', state: 'available' },
      ],
    });
    expect(impact?.references[0]).not.toHaveProperty('refId');
  });

  test('保管は公開を止め、回答と利用先を残し、通常一覧と公開取得から外す', async () => {
    insertForm(sqlite);
    sqlite.prepare(
      `INSERT INTO form_submissions (id, form_id, data)
       VALUES ('submission-1', 'form-1', '{"q":"はい"}')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO form_opens (id, form_id, friend_name)
       VALUES ('open-1', 'form-1', '画面確認')`,
    ).run();
    const impact = await getFormDeleteImpact(db, 'form-1', 'account-1');

    const archived = await archiveFormAtRevision(db, 'form-1', impact!.revision);

    expect(archived).toMatchObject({ status: 'archived', is_active: 0 });
    expect(archived?.archived_at).toBeTruthy();
    expect(await getFormById(db, 'form-1')).toBeNull();
    expect(await getFormById(db, 'form-1', { includeArchived: true })).toMatchObject({ status: 'archived' });
    expect(await getFormsWithStats(db, { lineAccountIds: ['account-1'] })).toEqual([]);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM form_submissions WHERE form_id = 'form-1'`).get())
      .toEqual({ n: 1 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM form_opens WHERE form_id = 'form-1'`).get())
      .toEqual({ n: 1 });
  });

  test('影響確認後に回答が増えたら版が進み、古い版では削除できない', async () => {
    insertForm(sqlite, { active: false });
    const impact = await getFormDeleteImpact(db, 'form-1', 'account-1');
    sqlite.prepare(
      `INSERT INTO form_submissions (id, form_id, data)
       VALUES ('submission-late', 'form-1', '{}')`,
    ).run();

    expect(await deleteFormAtRevision(db, 'form-1', impact!.revision)).toBe(false);
    const latest = await getFormDeleteImpact(db, 'form-1', 'account-1');
    expect(latest?.revision).toBeGreaterThan(impact!.revision);
    expect(latest?.recommendedAction).toBe('archive');
  });

  test('影響が0件の同じ版だけを物理削除する', async () => {
    insertForm(sqlite, { active: false });
    const impact = await getFormDeleteImpact(db, 'form-1', 'account-1');

    expect(await deleteFormAtRevision(db, 'form-1', impact!.revision)).toBe(true);
    expect(await getFormById(db, 'form-1', { includeArchived: true })).toBeNull();
  });

  test('別アカウントからは存在を返さない', async () => {
    insertForm(sqlite, { active: false });
    await expect(getFormDeleteImpact(db, 'form-1', 'account-2')).resolves.toBeNull();
  });
});
