import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '../migrations/334_mileage_rule_account_scope.sql'),
  'utf8',
);

describe('334 mileage rule account scope migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE mileage_rules (id TEXT PRIMARY KEY);
      CREATE TABLE mileage_earning_rule_drafts (
        rule_id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL REFERENCES line_accounts(id)
      );
      INSERT INTO line_accounts (id) VALUES ('account-1');
      INSERT INTO mileage_rules (id) VALUES ('assigned'), ('legacy');
      INSERT INTO mileage_earning_rule_drafts (rule_id, line_account_id)
      VALUES ('assigned', 'account-1');
    `);
  });

  afterEach(() => db.close());

  it('backfills assigned drafts and leaves unassigned legacy rules immutable-ready', () => {
    db.exec(migration);
    expect(db.prepare(
      `SELECT id, line_account_id FROM mileage_rules ORDER BY id`,
    ).all()).toEqual([
      { id: 'assigned', line_account_id: 'account-1' },
      { id: 'legacy', line_account_id: null },
    ]);
  });
});
