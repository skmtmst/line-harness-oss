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
