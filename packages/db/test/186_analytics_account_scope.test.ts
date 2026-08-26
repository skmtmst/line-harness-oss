import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(join(ROOT, 'migrations', '186_analytics_account_scope.sql'), 'utf8');

describe('186 V6分析のアカウント分離', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE funnels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
      INSERT INTO funnels (id, name, created_at) VALUES ('legacy', '旧ファネル', '2026-08-01');
    `);
    db.exec(MIGRATION);
  });

  it('所属を推測できない旧ファネルをNULLのまま残す', () => {
    expect(db.prepare(`SELECT line_account_id FROM funnels WHERE id = 'legacy'`).get())
      .toEqual({ line_account_id: null });
  });

  it('新しいファネルへLINE公式アカウントを保存できる', () => {
    db.prepare(`
      INSERT INTO funnels (id, name, created_at, line_account_id)
      VALUES ('new', '購入まで', '2026-08-26', 'account-a')
    `).run();
    expect(db.prepare(`SELECT line_account_id FROM funnels WHERE id = 'new'`).get())
      .toEqual({ line_account_id: 'account-a' });
  });
});
