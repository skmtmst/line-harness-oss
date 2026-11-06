import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(join(ROOT, 'migrations', '184_line_account_timezone.sql'), 'utf8');

describe('184 LINEアカウントのタイムゾーン', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO line_accounts (id, name) VALUES ('account-1', '既存アカウント');
    `);
    db.exec(MIGRATION);
  });

  it('既存アカウントを日本時間のまま継続する', () => {
    expect(db.prepare(`SELECT timezone FROM line_accounts WHERE id = 'account-1'`).get())
      .toEqual({ timezone: 'Asia/Tokyo' });
  });

  it('新しいアカウントでもタイムゾーンを省略できない', () => {
    db.prepare(`INSERT INTO line_accounts (id, name) VALUES ('account-2', '新規')`).run();
    expect(db.prepare(`SELECT timezone FROM line_accounts WHERE id = 'account-2'`).get())
      .toEqual({ timezone: 'Asia/Tokyo' });
    expect(() => db.prepare(
      `UPDATE line_accounts SET timezone = NULL WHERE id = 'account-2'`,
    ).run()).toThrow(/NOT NULL/);
  });
});
