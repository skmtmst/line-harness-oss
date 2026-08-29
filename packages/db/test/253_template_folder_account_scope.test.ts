import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACCOUNT_SCOPE = readFileSync(
  join(ROOT, 'migrations', '253_template_folder_account_scope.sql'),
  'utf8',
);
const FAVORITES = readFileSync(
  join(ROOT, 'migrations', '254_template_favorites.sql'),
  'utf8',
);

describe('253-254 テンプレートのフォルダとよく使う', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
        display_order INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        line_account_id TEXT REFERENCES line_accounts(id) ON DELETE CASCADE,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
      INSERT INTO folders (
        id, kind, name, parent_id, display_order, color, created_at, updated_at
      ) VALUES (
        'legacy-greeting', 'template', '挨拶', NULL, 2, '#10B981', '2026-01-01', '2026-01-02'
      );
      INSERT INTO templates (
        id, name, category, folder_id, line_account_id, created_at, updated_at
      ) VALUES
        ('a-old', 'A旧', 'general', 'legacy-greeting', 'account-a', '2026-01-01', '2026-01-02'),
        ('b-old', 'B旧', 'general', 'legacy-greeting', 'account-b', '2026-01-01', '2026-01-02'),
        ('a-campaign', 'A施策', 'キャンペーン', NULL, 'account-a', '2026-01-01', '2026-01-02'),
        ('b-campaign', 'B施策', 'キャンペーン', NULL, 'account-b', '2026-01-01', '2026-01-02'),
        ('a-general', 'A未分類', 'general', NULL, 'account-a', '2026-01-01', '2026-01-02');
    `);
    db.exec(ACCOUNT_SCOPE);
    db.exec(FAVORITES);
  });

  it('同じ旧分類名でもLINEアカウントごとに別フォルダへ移す', () => {
    const rows = db.prepare(`
      SELECT t.id, t.folder_id, f.line_account_id, f.name
      FROM templates t
      LEFT JOIN folders f ON f.id = t.folder_id
      ORDER BY t.id
    `).all() as Array<{
      id: string;
      folder_id: string | null;
      line_account_id: string | null;
      name: string | null;
    }>;

    expect(rows.find((row) => row.id === 'a-old')).toMatchObject({
      line_account_id: 'account-a',
      name: '挨拶',
    });
    expect(rows.find((row) => row.id === 'b-old')).toMatchObject({
      line_account_id: 'account-b',
      name: '挨拶',
    });
    expect(rows.find((row) => row.id === 'a-old')?.folder_id)
      .not.toBe(rows.find((row) => row.id === 'b-old')?.folder_id);
    expect(rows.find((row) => row.id === 'a-campaign')).toMatchObject({
      line_account_id: 'account-a',
      name: 'キャンペーン',
    });
    expect(rows.find((row) => row.id === 'a-general')?.folder_id).toBeNull();
  });

  it('フォルダを消しても中身は消さず未分類へ戻す', () => {
    const folder = db.prepare(`SELECT folder_id FROM templates WHERE id = 'a-old'`).get() as {
      folder_id: string;
    };
    db.prepare(`DELETE FROM folders WHERE id = ?`).run(folder.folder_id);

    expect(db.prepare(`SELECT folder_id FROM templates WHERE id = 'a-old'`).get())
      .toEqual({ folder_id: null });
  });

  it('既存テンプレートはよく使うに勝手に入れない', () => {
    expect(db.prepare(`SELECT DISTINCT is_favorite FROM templates`).all())
      .toEqual([{ is_favorite: 0 }]);
    db.prepare(`UPDATE templates SET is_favorite = 1 WHERE id = 'a-old'`).run();
    expect(db.prepare(`SELECT is_favorite FROM templates WHERE id = 'a-old'`).get())
      .toEqual({ is_favorite: 1 });
  });
});
