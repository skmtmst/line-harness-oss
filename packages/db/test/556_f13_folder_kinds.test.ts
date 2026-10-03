import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

/**
 * F-13: 置き場の種類に common_action・webhook・conversion を足す（556）。
 * CHECK は作り直しでしか変えられないので、表の再建が正しく当たることを見る。
 * 適用はしない（本番・D1 に触らない）。PR 本文に番号だけ書く。
 */
let migratedSnapshot: Buffer | null = null;

function setupDbWithMigrations(): Database.Database {
  if (migratedSnapshot) return new Database(migratedSnapshot);
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));

  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }

  migratedSnapshot = db.serialize();
  return db;
}

/**
 * #1269: D1 では外部キーが有効。folders を DROP すると暗黙の削除が走り、
 * 子の folder_id が ON DELETE SET NULL で全部 NULL になるおそれがある。
 * 子に中身を入れてから 556 を当て、ひも付けが残ることを見る。
 */
function setupDbWithout556(): Database.Database {
  const db = new Database(':memory:');
  // D1 と同じく外部キーを有効にする。OFF だと消えないので試験にならない。
  db.exec('PRAGMA foreign_keys = ON');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));

  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('556_'))
    .sort();

  for (const file of migrationFiles) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function apply556(db: Database.Database): void {
  const sql = readFileSync(join(MIGRATIONS_DIR, '556_f13_folder_kinds.sql'), 'utf8');
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    // ここでは黙殺しない。556 自体の文が落ちたらそのまま落とす。
    db.exec(stmt);
  }
}

describe('556_f13_folder_kinds', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDbWithMigrations();
  });

  test('新しい3種別で置き場を作れる', () => {
    const insert = db.prepare(
      `INSERT INTO folders (id, kind, name, display_order, created_at, updated_at)
       VALUES (?, ?, ?, 0, '2026-10-03T00:00:00', '2026-10-03T00:00:00')`,
    );
    for (const kind of ['common_action', 'webhook', 'conversion']) {
      insert.run(`fo-${kind}`, kind, `${kind}の置き場`);
    }
    const kinds = (
      db.prepare(`SELECT kind FROM folders WHERE id LIKE 'fo-%' ORDER BY kind`).all() as Array<{
        name: string;
        kind: string;
      }>
    ).map((r) => r.kind);
    expect(kinds).toEqual(['common_action', 'conversion', 'webhook']);
  });

  test('前からの種類も作れるし、知らない種類は弾く', () => {
    const insert = db.prepare(
      `INSERT INTO folders (id, kind, name, display_order, created_at, updated_at)
       VALUES (?, ?, ?, 0, '2026-10-03T00:00:00', '2026-10-03T00:00:00')`,
    );
    insert.run('fo-tag', 'tag', 'タグの置き場');
    insert.run('fo-automation', 'automation', '自動化の置き場');
    // friend_field は code に前からあるのに CHECK に無かった。556 で直る。
    insert.run('fo-friend-field', 'friend_field', '情報欄の置き場');
    expect(() =>
      insert.run('fo-planets', 'planets', '知らない置き場'),
    ).toThrow();
  });

  test('account_id と color が残っている', () => {
    const cols = (
      db.prepare(`PRAGMA table_info(folders)`).all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['account_id', 'color']));
  });
});

describe('556_f13_folder_kinds の子のひも付け(#1269)', () => {
  test('556 を当てても子の folder_id が残る', () => {
    const db = setupDbWithout556();
    const T = '2026-10-03T00:00:00';

    db.prepare(
      `INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token, created_at, updated_at)
       VALUES ('account-a', 'A店', 'c-a', 's-a', 't-a', '${T}', '${T}')`,
    ).run();

    const folders: Array<[string, string]> = [
      ['fo-tag', 'tag'],
      ['fo-template', 'template'],
      ['fo-scenario', 'scenario'],
      ['fo-ar', 'auto_reply'],
      ['fo-reminder', 'reminder'],
      ['fo-media', 'media'],
      ['fo-common-var', 'common_var'],
      ['fo-broadcast', 'broadcast'],
      ['fo-rich-menu', 'rich_menu'],
      ['fo-webinar', 'webinar'],
      ['fo-form', 'form'],
      // friend_field は556より前は CHECK に無く作れない。当てた後で作る。
    ];
    const insertFolder = db.prepare(
      `INSERT INTO folders (id, kind, name, display_order, created_at, updated_at)
       VALUES (?, ?, ?, 0, '${T}', '${T}')`,
    );
    for (const [id, kind] of folders) insertFolder.run(id, kind, `${kind}の置き場`);

    // 子を1行ずつ、置き場に入れて作る。
    db.prepare(`INSERT INTO tags (id, name, folder_id) VALUES ('tag1', '会員', 'fo-tag')`).run();
    db.prepare(
      `INSERT INTO templates (id, name, message_type, message_content, folder_id)
       VALUES ('tpl1', 'あいさつ', 'text', 'こんにちは', 'fo-template')`,
    ).run();
    db.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, folder_id)
       VALUES ('sce1', '来店', 'manual', 'fo-scenario')`,
    ).run();
    db.prepare(
      `INSERT INTO auto_replies (id, keyword, response_content, folder_id)
       VALUES ('ar1', '営業時間', '10時からです', 'fo-ar')`,
    ).run();
    db.prepare(
      `INSERT INTO reminders (id, name, trigger_type, folder_id)
       VALUES ('rem1', '誕生日', 'manual', 'fo-reminder')`,
    ).run();
    db.prepare(
      `INSERT INTO media (id, kind, filename, mime_type, size_bytes, r2_key, folder_id)
       VALUES ('med1', 'image', 'a.jpg', 'image/jpeg', 10, 'r2-a', 'fo-media')`,
    ).run();
    db.prepare(
      `INSERT INTO common_vars (id, name, var_key, folder_id)
       VALUES ('cv1', '営業時間', 'shop_hours', 'fo-common-var')`,
    ).run();
    db.prepare(
      `INSERT INTO broadcasts (id, title, message_type, message_content, folder_id)
       VALUES ('bc1', '新作', 'text', '出ました', 'fo-broadcast')`,
    ).run();
    db.prepare(
      `INSERT INTO rich_menu_groups (id, account_id, name, chat_bar_text, size, folder_id)
       VALUES ('rmg1', 'account-a', '通常', '開く', 'large', 'fo-rich-menu')`,
    ).run();
    db.prepare(
      `INSERT INTO webinars (id, account_id, title, slug, created_at, updated_at, folder_id)
       VALUES ('web1', 'account-a', '説明会', 'setsumei', '${T}', '${T}', 'fo-webinar')`,
    ).run();
    db.prepare(
      `INSERT INTO forms (id, name, folder_id) VALUES ('form1', '申込', 'fo-form')`,
    ).run();
    // friend_field は556の後で作る（前は CHECK に無い）。
    const insertFriendField = (): void => {
      insertFolder.run('fo-friend-field', 'friend_field', 'friend_fieldの置き場');
      db.prepare(
        `INSERT INTO friend_fields (id, name, field_key, type, folder_id)
         VALUES ('ff1', 'ペット名', 'pet_name', 'text', 'fo-friend-field')`,
      ).run();
    };
    db.prepare(
      `INSERT INTO media_upload_sessions (id, line_account_id, filename, kind, expected_mime, expected_size, r2_key, expires_at, folder_id)
       VALUES ('mus1', 'account-a', 'b.jpg', 'image', 'image/jpeg', 10, 'r2-b', '${T}', 'fo-media')`,
    ).run();

    apply556(db);

    // 556で直る種類も作れるようになる。
    insertFriendField();

    // 置き場は12個とも残る。
    const folderCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM folders`).get() as { n: number }
    ).n;
    expect(folderCount).toBe(12);

    // 子のひも付けは1つも切れていない。
    const checks: Array<[string, string, string]> = [
      ['tags', 'tag1', 'fo-tag'],
      ['templates', 'tpl1', 'fo-template'],
      ['scenarios', 'sce1', 'fo-scenario'],
      ['auto_replies', 'ar1', 'fo-ar'],
      ['reminders', 'rem1', 'fo-reminder'],
      ['media', 'med1', 'fo-media'],
      ['common_vars', 'cv1', 'fo-common-var'],
      ['broadcasts', 'bc1', 'fo-broadcast'],
      ['rich_menu_groups', 'rmg1', 'fo-rich-menu'],
      ['webinars', 'web1', 'fo-webinar'],
      ['forms', 'form1', 'fo-form'],
      ['friend_fields', 'ff1', 'fo-friend-field'],
      ['media_upload_sessions', 'mus1', 'fo-media'],
    ];
    for (const [table, id, folderId] of checks) {
      const row = db.prepare(`SELECT folder_id FROM ${table} WHERE id = ?`).get(id) as {
        folder_id: string | null;
      };
      expect({ [table]: row.folder_id }).toEqual({ [table]: folderId });
    }

    // 退避表は 556 では残す（点検が DROP を許さないため）。片付けは後の番号。
    const kept = db.prepare(
      `SELECT folder_id FROM _556_folders_backup_tags WHERE id = 'tag1'`,
    ).get() as { folder_id: string | null };
    expect(kept.folder_id).toBe('fo-tag');
  });
});
