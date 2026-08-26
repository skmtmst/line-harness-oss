import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(
  join(ROOT, 'migrations', '183_automation_action_account_scope.sql'),
  'utf8',
);

describe('183 V6アクション参照先のアカウント分離', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE tags (
        id TEXT PRIMARY KEY, display_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE templates (
        id TEXT PRIMARY KEY, display_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE outgoing_webhooks (
        id TEXT PRIMARY KEY, is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
      );
      INSERT INTO line_accounts (id) VALUES ('account-1');
      INSERT INTO tags (id) VALUES ('legacy-tag');
      INSERT INTO templates (id) VALUES ('legacy-template');
      INSERT INTO outgoing_webhooks (id, updated_at) VALUES ('legacy-webhook', '2026-01-01');
    `);
    db.exec(MIGRATION);
  });

  it('V6から参照する3種類にLINEアカウント所属を追加する', () => {
    for (const table of ['tags', 'templates', 'outgoing_webhooks']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain('line_account_id');
    }
  });

  it('既存行の所属を推測せずNULLのまま残す', () => {
    expect(db.prepare(`SELECT line_account_id FROM tags WHERE id = 'legacy-tag'`).get())
      .toEqual({ line_account_id: null });
    expect(db.prepare(`SELECT line_account_id FROM templates WHERE id = 'legacy-template'`).get())
      .toEqual({ line_account_id: null });
    expect(db.prepare(`SELECT line_account_id FROM outgoing_webhooks WHERE id = 'legacy-webhook'`).get())
      .toEqual({ line_account_id: null });
  });

  it('存在しないLINEアカウントは設定できない', () => {
    expect(() => db.prepare(
      `UPDATE tags SET line_account_id = 'missing' WHERE id = 'legacy-tag'`,
    ).run()).toThrow(/FOREIGN KEY constraint failed/);
  });
});
