import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COMMON_VARS_LIST_LIMIT,
  CommonVarFolderError,
  countCommonVars,
  createCommonVar,
  getCommonVarById,
  getCommonVars,
  updateCommonVar,
} from '../src/common-vars.js';
import { asD1 } from './d1-test-helper.js';

describe('#544 N6 フォルダの存在と種別の検証', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
      INSERT INTO folders (id, kind, name)
      VALUES ('folder-ok', 'common_var', '共通'),
             ('folder-other', 'template', '別画面');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('存在しないフォルダ・別種別のフォルダでは作れない', async () => {
    await expect(createCommonVar(db, {
      lineAccountId: 'account-1', name: '営業時間', varKey: 'shop_hours', folderId: 'missing',
    })).rejects.toBeInstanceOf(CommonVarFolderError);
    await expect(createCommonVar(db, {
      lineAccountId: 'account-1', name: '営業時間', varKey: 'shop_hours', folderId: 'folder-other',
    })).rejects.toBeInstanceOf(CommonVarFolderError);
  });

  it('共通情報のフォルダなら作れて、更新時のすり替えも止める', async () => {
    const created = await createCommonVar(db, {
      lineAccountId: 'account-1', name: '営業時間', varKey: 'shop_hours', folderId: 'folder-ok',
    });
    expect(created.folder_id).toBe('folder-ok');
    await expect(updateCommonVar(db, created.id, 'account-1', { folderId: 'folder-other' }))
      .rejects.toBeInstanceOf(CommonVarFolderError);
    const ungrouped = await updateCommonVar(db, created.id, 'account-1', { folderId: null });
    expect(ungrouped?.folder_id).toBeNull();
    expect((await getCommonVarById(db, created.id, 'account-1'))?.folder_id).toBeNull();
  });
});

describe('#544 N2 一覧の件数上限と総件数', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
    `);
    const insert = sqlite.prepare(`
      INSERT INTO common_vars (id, line_account_id, name, var_key, type, value, version)
      VALUES (?, 'account-1', ?, ?, 'text', '', 1)
    `);
    sqlite.transaction(() => {
      for (let index = 0; index < COMMON_VARS_LIST_LIMIT + 5; index += 1) {
        insert.run(`v-${index}`, `項目${String(index).padStart(3, '0')}`, `key_${index}`);
      }
    })();
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('上限を超えても総件数を返し、一覧は上限で切る', async () => {
    expect(await countCommonVars(db, { lineAccountId: 'account-1' })).toBe(COMMON_VARS_LIST_LIMIT + 5);
    const items = await getCommonVars(db, { lineAccountId: 'account-1' });
    expect(items).toHaveLength(COMMON_VARS_LIST_LIMIT);
    const few = await getCommonVars(db, { lineAccountId: 'account-1', limit: 3 });
    expect(few).toHaveLength(3);
  });
});
