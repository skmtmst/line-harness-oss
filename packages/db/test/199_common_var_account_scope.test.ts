import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function legacyDb(accounts: string[]): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE common_vars (id TEXT PRIMARY KEY, name TEXT NOT NULL, var_key TEXT NOT NULL UNIQUE);
    CREATE TABLE templates (line_account_id TEXT, message_content TEXT);
    CREATE TABLE broadcasts (line_account_id TEXT, message_content TEXT);
    CREATE TABLE scenarios (id TEXT PRIMARY KEY, line_account_id TEXT);
    CREATE TABLE scenario_steps (scenario_id TEXT, message_content TEXT, message_bubbles_json TEXT);
    CREATE TABLE reminders (id TEXT PRIMARY KEY, line_account_id TEXT);
    CREATE TABLE reminder_steps (reminder_id TEXT, message_content TEXT);
    CREATE TABLE auto_replies (line_account_id TEXT, response_content TEXT, actions_json TEXT);
    CREATE TABLE automations (line_account_id TEXT, conditions TEXT, actions TEXT);
  `);
  const insert = db.prepare(`INSERT INTO line_accounts (id) VALUES (?)`);
  for (const account of accounts) insert.run(account);
  return db;
}

function applyMigration(db: Database.Database): void {
  db.exec(readFileSync(join(process.cwd(), 'migrations/199_common_var_account_scope.sql'), 'utf8'));
}

describe('199 common variable account scope', () => {
  it('counts distinct accounts across every usage source and across insert batches', () => {
    const db = legacyDb(['a1', 'a2']);
    try {
      db.exec(`
        INSERT INTO common_vars (id, name, var_key) VALUES
          ('single', 'Single', 'single'), ('shared', 'Shared', 'shared'),
          ('unknown', 'Unknown', 'unknown');
        INSERT INTO templates VALUES ('a1', '{{var.single}} {{var.shared}}'),
          ('a1', '{{var.single}}'), (NULL, '{{var.unknown}}');
        INSERT INTO broadcasts VALUES ('a1', '{{var.single}}');
        INSERT INTO scenarios VALUES ('s1', 'a1');
        INSERT INTO scenario_steps VALUES ('s1', NULL, '{{var.single}}');
        INSERT INTO reminders VALUES ('r1', 'a1');
        INSERT INTO reminder_steps VALUES ('r1', '{{var.single}}');
        INSERT INTO auto_replies VALUES ('a1', NULL, '{{var.single}}');
        INSERT INTO automations VALUES ('a1', '{{var.single}}', NULL),
          ('a2', NULL, '{{var.shared}}'), (NULL, '{{var.unknown}}', NULL);
      `);
      applyMigration(db);
      expect(db.prepare('SELECT id, line_account_id FROM common_vars ORDER BY id').all()).toEqual([
        { id: 'shared', line_account_id: null },
        { id: 'single', line_account_id: 'a1' },
        { id: 'unknown', line_account_id: null },
      ]);
    } finally {
      db.close();
    }
  });

  it('assigns only an unambiguous referenced account and leaves multi-account values for review', () => {
    const db = legacyDb(['a1', 'a2']);
    db.exec(`
      INSERT INTO common_vars (id, name, var_key) VALUES
        ('single', '営業時間', 'hours'), ('shared', '電話', 'phone'), ('unknown', '住所', 'address');
      INSERT INTO templates (line_account_id, message_content)
        VALUES ('a1', '{{var.hours}} / {{var.phone}}');
      INSERT INTO broadcasts (line_account_id, message_content)
        VALUES ('a2', '{{var.phone}}');
    `);

    applyMigration(db);
    const rows = db.prepare(`SELECT id, line_account_id FROM common_vars ORDER BY id`).all();
    expect(rows).toEqual([
      { id: 'shared', line_account_id: null },
      { id: 'single', line_account_id: 'a1' },
      { id: 'unknown', line_account_id: null },
    ]);
    db.close();
  });

  it('preserves all legacy values when the installation has exactly one account', () => {
    const db = legacyDb(['a1']);
    db.exec(`INSERT INTO common_vars (id, name, var_key) VALUES ('unknown', '住所', 'address')`);
    applyMigration(db);
    expect(db.prepare(`SELECT line_account_id FROM common_vars WHERE id = 'unknown'`).get())
      .toEqual({ line_account_id: 'a1' });
    db.close();
  });
});
