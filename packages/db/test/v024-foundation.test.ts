import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFolder, getFolders, deleteFolder } from '../src/folders.js';
import {
  createFriendField,
  setFriendFieldValue,
  getFriendFieldMap,
  getFriendFieldsWithValues,
  countFriendFieldValues,
  validateFieldKey,
} from '../src/friend-fields.js';
import {
  createSupportMark,
  getDefaultSupportMark,
  getSupportMarks,
  setFriendSupportMarkBulk,
  applyInboundSupportMark,
} from '../src/support-marks.js';
import {
  validateSearchConditions,
  createSavedSearch,
  getSavedSearches,
  updateSavedSearch,
  deleteSavedSearch,
} from '../src/saved-searches.js';
import { sanitizePath, sanitizeReferrer, linkVisitorToFriend, recordSiteEvent } from '../src/site-tracking.js';
import {
  createCommonVar,
  createCommonVarSchedule,
  applyDueCommonVarSchedules,
  getCommonVarById,
} from '../src/common-vars.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  // bootstrap.sql は schema.sql + 全マイグレーション適用済みの現行スキーマ。
  db.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              const info = stmt.run(...params);
              return { results: [], success: true, meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
        async run() {
          const info = sqlite.prepare(query).run();
          return { results: [], success: true, meta: { changes: info.changes } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get() as T) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(query).all() as T[], success: true, meta: {} };
        },
      };
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

function insertFriend(id: string): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'テスト', '2026-08-16', '2026-08-16')`,
    )
    .run(id, `U${id.padEnd(32, '0').slice(0, 32)}`);
}

beforeEach(() => {
  sqlite = setupDb();
  sqlite.exec(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret)
    VALUES
      ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1'),
      ('account-2', 'channel-2', '店舗2', 'token-2', 'secret-2');
  `);
  db = asD1(sqlite);
});

describe('tag_groups から folders への移送', () => {
  test('移送後、既存の分類が folders に入っている', () => {
    // マイグレーション 099 の INSERT ... SELECT は bootstrap.sql に含まれるが、
    // 空のDBでは tag_groups に行が無いので何も写らない。ここでは移送の SQL
    // そのものを、行がある状態で当てて確かめる。
    sqlite
      .prepare(
        `INSERT INTO tag_groups (id, name, sort_order, created_at, updated_at)
         VALUES ('g-1', 'お悩み', 0, '2026-08-15', '2026-08-15')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO tags (id, name, color, group_id, created_at)
         VALUES ('t-1', '腰痛', '#3B82F6', 'g-1', '2026-08-15')`,
      )
      .run();

    sqlite.exec(`
      INSERT OR IGNORE INTO folders (id, kind, name, display_order, created_at, updated_at)
        SELECT id, 'tag', name, sort_order, created_at, updated_at FROM tag_groups;
      UPDATE tags SET folder_id = group_id WHERE group_id IS NOT NULL AND folder_id IS NULL;
    `);

    const folder = sqlite.prepare(`SELECT * FROM folders WHERE id = 'g-1'`).get() as Record<
      string,
      unknown
    >;
    expect(folder).toMatchObject({ kind: 'tag', name: 'お悩み' });
    const tag = sqlite.prepare(`SELECT folder_id, group_id FROM tags WHERE id = 't-1'`).get() as {
      folder_id: string;
      group_id: string;
    };
    // 元の列は残す。追加のみポリシーで落とせないし、切り戻しの手がかりにもなる。
    expect(tag.folder_id).toBe('g-1');
    expect(tag.group_id).toBe('g-1');
  });
});

describe('フォルダ', () => {
  test('種類ごとに分かれて出る', async () => {
    await createFolder(db, { kind: 'template', name: 'よく使う' });
    await createFolder(db, { kind: 'media', name: '商品写真' });
    expect(await getFolders(db, 'template')).toHaveLength(1);
    expect(await getFolders(db, 'media')).toHaveLength(1);
    expect(await getFolders(db)).toHaveLength(2);
  });

  test('フォルダを消しても中身は消えず、未分類に戻る', async () => {
    const folder = await createFolder(db, { kind: 'template', name: 'よく使う' });
    sqlite
      .prepare(
        `INSERT INTO templates (id, name, message_type, message_content, folder_id, created_at, updated_at)
         VALUES ('tpl-1', 'あいさつ', 'text', 'こんにちは', ?, '2026-08-16', '2026-08-16')`,
      )
      .run(folder.id);
    await deleteFolder(db, folder.id);
    const tpl = sqlite.prepare(`SELECT folder_id FROM templates WHERE id = 'tpl-1'`).get() as {
      folder_id: string | null;
    };
    expect(tpl.folder_id).toBeNull();
  });

  test('子フォルダは親と一緒に消える', async () => {
    const parent = await createFolder(db, { kind: 'template', name: '親' });
    await createFolder(db, { kind: 'template', name: '子', parentId: parent.id });
    await deleteFolder(db, parent.id);
    expect(await getFolders(db, 'template')).toHaveLength(0);
  });
});

describe('差し込み名の検証', () => {
  test('使える形', () => {
    expect(validateFieldKey('pet_name').ok).toBe(true);
    expect(validateFieldKey('a').ok).toBe(true);
  });

  test('使えない形', () => {
    // テンプレートで {key} として置換するので、置換が壊れる形は通さない。
    expect(validateFieldKey('Pet').ok).toBe(false); // 大文字
    expect(validateFieldKey('1st').ok).toBe(false); // 数字始まり
    expect(validateFieldKey('ペット').ok).toBe(false); // 日本語
    expect(validateFieldKey('pet-name').ok).toBe(false); // ハイフン
    expect(validateFieldKey('a'.repeat(33)).ok).toBe(false); // 長すぎ
    expect(validateFieldKey('').ok).toBe(false);
  });

  test('既に別の意味で使っている名前は通さない', () => {
    // 「{name} を入れたのに友だちの表示名が出る」を防ぐ。
    expect(validateFieldKey('name').ok).toBe(false);
    expect(validateFieldKey('tag').ok).toBe(false);
  });
});

describe('友だち情報欄', () => {
  beforeEach(() => insertFriend('f-1'));

  test('値が無い項目も一覧に出る', async () => {
    await createFriendField(db, { name: 'ペットの名前', fieldKey: 'pet_name', type: 'text' });
    const rows = await getFriendFieldsWithValues(db, 'f-1');
    // 空欄も出せてはじめて入力欄として使える。
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBeNull();
  });

  test('書いて読める', async () => {
    const field = await createFriendField(db, {
      name: 'ペットの名前',
      fieldKey: 'pet_name',
      type: 'text',
    });
    await setFriendFieldValue(db, {
      friendId: 'f-1',
      fieldId: field.id,
      value: 'ポチ',
      updatedBy: 'staff-1',
    });
    expect(await getFriendFieldMap(db, 'f-1')).toEqual({ pet_name: 'ポチ' });
  });

  test('同じ項目に二度書いても行は増えない', async () => {
    const field = await createFriendField(db, { name: 'x', fieldKey: 'x', type: 'text' });
    await setFriendFieldValue(db, { friendId: 'f-1', fieldId: field.id, value: 'A', updatedBy: 's' });
    await setFriendFieldValue(db, { friendId: 'f-1', fieldId: field.id, value: 'B', updatedBy: 's' });
    const { c } = sqlite.prepare(`SELECT COUNT(*) AS c FROM friend_field_values`).get() as {
      c: number;
    };
    expect(c).toBe(1);
    expect(await getFriendFieldMap(db, 'f-1')).toEqual({ x: 'B' });
  });

  test('空文字にすると行を消す', async () => {
    const field = await createFriendField(db, { name: 'x', fieldKey: 'x', type: 'text' });
    await setFriendFieldValue(db, { friendId: 'f-1', fieldId: field.id, value: 'A', updatedBy: 's' });
    await setFriendFieldValue(db, { friendId: 'f-1', fieldId: field.id, value: '', updatedBy: 's' });
    expect(await countFriendFieldValues(db, field.id)).toBe(0);
  });

  test('既定値は値が無いときだけ使う', async () => {
    const field = await createFriendField(db, {
      name: '種類',
      fieldKey: 'pet_kind',
      type: 'text',
      defaultValue: '未確認',
    });
    expect(await getFriendFieldMap(db, 'f-1')).toEqual({ pet_kind: '未確認' });
    await setFriendFieldValue(db, { friendId: 'f-1', fieldId: field.id, value: '犬', updatedBy: 's' });
    expect(await getFriendFieldMap(db, 'f-1')).toEqual({ pet_kind: '犬' });
  });

  test('差し込み名は重複できない', async () => {
    await createFriendField(db, { name: 'A', fieldKey: 'dup', type: 'text' });
    await expect(
      createFriendField(db, { name: 'B', fieldKey: 'dup', type: 'text' }),
    ).rejects.toThrow();
  });

  test('友だちを消すと値も消える', async () => {
    const field = await createFriendField(db, { name: 'x', fieldKey: 'x', type: 'text' });
    await setFriendFieldValue(db, { friendId: 'f-1', fieldId: field.id, value: 'A', updatedBy: 's' });
    sqlite.prepare(`PRAGMA foreign_keys = ON`).run();
    sqlite.prepare(`DELETE FROM friends WHERE id = 'f-1'`).run();
    expect(await countFriendFieldValues(db, field.id)).toBe(0);
  });
});

describe('対応マーク', () => {
  test('新しい環境でも初期の3マークが用意される', async () => {
    // bootstrap.sql は DDL だけなので、マイグレーションに書いた行は
    // 新規インストールに届かない。ヘルパ側で補っている。
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM support_marks`).get()).toEqual({ c: 0 });
    const marks = await getSupportMarks(db);
    expect(marks.map((m) => m.name)).toEqual(['未対応', '対応中', '解決済']);
  });

  test('既定は1つだけ', async () => {
    expect((await getDefaultSupportMark(db))?.name).toBe('未対応');
    await createSupportMark(db, { name: '保留', isDefault: true });
    // 新しく既定にしたら、前の既定は降りる。
    expect((await getDefaultSupportMark(db))?.name).toBe('保留');
    const defaults = (await getSupportMarks(db)).filter((m) => m.is_default === 1);
    expect(defaults).toHaveLength(1);
  });

  test('まとめて付けられる', async () => {
    await getSupportMarks(db); // 初期マークを用意させる
    insertFriend('f-1');
    insertFriend('f-2');
    const n = await setFriendSupportMarkBulk(db, ['f-1', 'f-2'], 'mark_working');
    expect(n).toBe(2);
  });

  test('空の配列ではクエリを投げない', async () => {
    expect(await setFriendSupportMarkBulk(db, [], 'mark_working')).toBe(0);
  });

  test('受信で自動的に付くマークが無ければ何もしない', async () => {
    await getSupportMarks(db);
    insertFriend('f-1');
    sqlite.prepare(`UPDATE support_marks SET auto_on_inbound = 0`).run();
    expect(await applyInboundSupportMark(db, 'f-1')).toBe(false);
  });

  test('設定があれば受信でそのマークになる', async () => {
    insertFriend('f-1');
    expect(await applyInboundSupportMark(db, 'f-1')).toBe(true);
    const row = sqlite.prepare(`SELECT support_mark_id FROM friends WHERE id = 'f-1'`).get() as {
      support_mark_id: string;
    };
    expect(row.support_mark_id).toBe('mark_untouched');
  });
});

describe('保存した検索の条件', () => {
  test('AND群かOR群のどちらかは要る', () => {
    expect(validateSearchConditions({}).ok).toBe(false);
    expect(validateSearchConditions({ all: [] }).ok).toBe(false);
  });

  test('知らない条件の種類は通さない', () => {
    const r = validateSearchConditions({ all: [{ kind: 'horoscope', op: 'eq' }] });
    expect(r.ok).toBe(false);
  });

  test('op が無い条件は通さない', () => {
    expect(validateSearchConditions({ all: [{ kind: 'tag' }] }).ok).toBe(false);
  });

  test('正しい条件は通る', () => {
    const r = validateSearchConditions({
      all: [{ kind: 'tag', op: 'has', value: 'tag_1' }],
      any: [{ kind: 'field', key: 'pet_kind', op: 'eq', value: '犬' }],
      visibility: 'visible_only',
    });
    expect(r.ok).toBe(true);
  });

  test('保存できる', async () => {
    const saved = await createSavedSearch(db, {
      name: '犬の飼い主',
      lineAccountId: 'account-1',
      conditions: { all: [{ kind: 'tag', op: 'has', value: 't1' }] },
    });
    expect(saved.scope).toBe('friends');
    expect(JSON.parse(saved.conditions_json)).toHaveProperty('all');
  });

  test('個人検索とLINEアカウントの境界をDB条件で守る', async () => {
    await createSavedSearch(db, {
      name: '本人だけ',
      lineAccountId: 'account-1',
      createdBy: 'staff-1',
      isShared: false,
      conditions: { all: [{ kind: 'tag', op: 'has', value: 't1' }] },
    });
    const otherPrivate = await createSavedSearch(db, {
      name: '他人だけ',
      lineAccountId: 'account-1',
      createdBy: 'staff-2',
      isShared: false,
      conditions: { all: [{ kind: 'tag', op: 'has', value: 't2' }] },
    });
    await createSavedSearch(db, {
      name: '別アカウント共有',
      lineAccountId: 'account-2',
      createdBy: 'staff-2',
      isShared: true,
      conditions: { all: [{ kind: 'tag', op: 'has', value: 't3' }] },
    });
    sqlite.prepare(
      `INSERT INTO saved_searches
         (id, name, scope, conditions_json, created_by, line_account_id, is_shared, display_order, created_at)
       VALUES ('legacy-own', '旧検索', 'friends', '{}', 'staff-1', NULL, 0, 0, '2026-08-16')`,
    ).run();

    const access = { lineAccountId: 'account-1', staffId: 'staff-1', canManageAll: false };
    const visible = await getSavedSearches(db, 'friends', access);
    expect(visible.map((item) => item.name).sort()).toEqual(['本人だけ', '旧検索'].sort());
    expect(await updateSavedSearch(db, otherPrivate.id, access, { name: '変更' })).toBeNull();
    expect(await deleteSavedSearch(db, otherPrivate.id, access)).toBe(false);
  });
});

describe('サイトの記録', () => {
  test('URLのクエリ文字列を落とす', () => {
    // ?email=... や ?token=... が入る事故は必ず起きるので、通す判断はしない。
    expect(sanitizePath('/thanks?email=a@example.com')).toBe('/thanks');
    expect(sanitizePath('/thanks#section')).toBe('/thanks');
    expect(sanitizePath('https://example.com/thanks?x=1')).toBe('/thanks');
    expect(sanitizePath('https://example.com')).toBe('/');
    expect(sanitizePath('')).toBeNull();
    expect(sanitizePath(undefined)).toBeNull();
  });

  test('リファラも同じ扱い', () => {
    expect(sanitizeReferrer('https://google.com/search?q=secret')).toBe(
      'https://google.com/search',
    );
  });

  test('友だちと結びつくと、それまでの行動も紐づく', async () => {
    insertFriend('f-1');
    await recordSiteEvent(db, { visitorId: 'v-1', eventType: 'page_view', path: '/a' });
    await recordSiteEvent(db, { visitorId: 'v-1', eventType: 'page_view', path: '/b' });
    expect(await linkVisitorToFriend(db, 'v-1', 'f-1', 'liff')).toBe(true);
    const { c } = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM site_events WHERE friend_id = 'f-1'`)
      .get() as { c: number };
    expect(c).toBe(2);
  });

  test('一度結びついたら上書きしない', async () => {
    insertFriend('f-1');
    insertFriend('f-2');
    await recordSiteEvent(db, { visitorId: 'v-1', eventType: 'page_view', path: '/a' });
    await linkVisitorToFriend(db, 'v-1', 'f-1', 'liff');
    // 同じ端末を家族で使う場合など、後から別の人に付け替わると
    // 過去の行動まで別人のものになる。
    expect(await linkVisitorToFriend(db, 'v-1', 'f-2', 'form')).toBe(false);
  });
});

describe('共通情報の日付切り替え', () => {
  test('時刻を過ぎた予約だけ反映する', async () => {
    const v = await createCommonVar(db, { name: '営業時間', varKey: 'shop_hours', value: '10-19' });
    await createCommonVarSchedule(db, {
      varId: v.id,
      effectiveFrom: '2026-08-01T00:00:00.000',
      value: '11-20',
    });
    await createCommonVarSchedule(db, {
      varId: v.id,
      effectiveFrom: '2099-01-01T00:00:00.000',
      value: '未来',
    });
    const applied = await applyDueCommonVarSchedules(db, '2026-08-16T00:00:00.000');
    expect(applied).toBe(1);
    expect((await getCommonVarById(db, v.id))?.value).toBe('11-20');
  });

  test('二度反映されない', async () => {
    const v = await createCommonVar(db, { name: 'x', varKey: 'x', value: 'A' });
    await createCommonVarSchedule(db, {
      varId: v.id,
      effectiveFrom: '2026-08-01T00:00:00.000',
      value: 'B',
    });
    expect(await applyDueCommonVarSchedules(db, '2026-08-16T00:00:00.000')).toBe(1);
    expect(await applyDueCommonVarSchedules(db, '2026-08-16T00:00:00.000')).toBe(0);
  });

  test('溜まった予約は古い順に当て、最後のものが残る', async () => {
    const v = await createCommonVar(db, { name: 'x', varKey: 'x', value: 'A' });
    await createCommonVarSchedule(db, {
      varId: v.id,
      effectiveFrom: '2026-08-10T00:00:00.000',
      value: 'B',
    });
    await createCommonVarSchedule(db, {
      varId: v.id,
      effectiveFrom: '2026-08-12T00:00:00.000',
      value: 'C',
    });
    expect(await applyDueCommonVarSchedules(db, '2026-08-16T00:00:00.000')).toBe(2);
    expect((await getCommonVarById(db, v.id))?.value).toBe('C');
  });
});

describe('タグの分類は folders を見る', () => {
  test('分類を作ると folders(kind=tag) に入る', async () => {
    const { createTagGroup, getTagGroups } = await import('../src/tags.js');
    const group = await createTagGroup(db, { name: 'お悩み', sortOrder: 1 });
    // 形は変えていない。中で見るテーブルだけ差し替えた。
    expect(group).toMatchObject({ name: 'お悩み', sort_order: 1 });
    const row = sqlite.prepare(`SELECT kind FROM folders WHERE id = ?`).get(group.id) as {
      kind: string;
    };
    expect(row.kind).toBe('tag');
    // 移送後は tag_groups へ書かない。
    const { c } = sqlite.prepare(`SELECT COUNT(*) AS c FROM tag_groups`).get() as { c: number };
    expect(c).toBe(0);
    expect(await getTagGroups(db)).toHaveLength(1);
  });

  test('タグの所属は folder_id に入る', async () => {
    const { createTagGroup, createTag, assignTagToGroup } = await import('../src/tags.js');
    const group = await createTagGroup(db, { name: 'お悩み' });
    const tag = await createTag(db, { name: '腰痛', groupId: group.id });
    expect(tag.folder_id).toBe(group.id);
    expect(tag.group_id).toBeNull();

    const moved = await assignTagToGroup(db, tag.id, null);
    expect(moved?.folder_id).toBeNull();
  });

  test('分類を消してもタグは残り、未分類に戻る', async () => {
    const { createTagGroup, createTag, deleteTagGroup } = await import('../src/tags.js');
    const group = await createTagGroup(db, { name: 'お悩み' });
    const tag = await createTag(db, { name: '腰痛', groupId: group.id });
    await deleteTagGroup(db, group.id);
    const row = sqlite.prepare(`SELECT folder_id FROM tags WHERE id = ?`).get(tag.id) as {
      folder_id: string | null;
    };
    expect(row.folder_id).toBeNull();
  });

  test('別の種類のフォルダは分類として出てこない', async () => {
    const { getTagGroups } = await import('../src/tags.js');
    await createFolder(db, { kind: 'template', name: 'よく使う' });
    expect(await getTagGroups(db)).toHaveLength(0);
  });
});
