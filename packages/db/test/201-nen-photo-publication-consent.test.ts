import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '201_nen_photo_publication_consent.sql'),
  'utf8',
);

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT REFERENCES line_accounts(id));
    CREATE TABLE nen_photo_submissions (
      id TEXT PRIMARY KEY, friend_id TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, reviewed_at TEXT
    );
    INSERT INTO line_accounts VALUES ('account-a');
    INSERT INTO friends VALUES ('friend-a', 'account-a');
    INSERT INTO nen_photo_submissions VALUES ('photo-a', 'friend-a', 'adopted', '2026-08-01', '2026-08-02');
  `);
  sqlite.exec(migration);
  return sqlite;
}

describe('migration 201 NEN photo publication consent', () => {
  it('backfills account ownership but keeps existing adopted photos private', () => {
    const sqlite = setup();
    expect(sqlite.prepare(`SELECT line_account_id, publication_consent_at,
      publication_withdrawn_at, public_pet_name FROM nen_photo_submissions`).get()).toEqual({
      line_account_id: 'account-a', publication_consent_at: null,
      publication_withdrawn_at: null, public_pet_name: 0,
    });
  });

  it('rejects invalid public pet-name values', () => {
    const sqlite = setup();
    expect(() => sqlite.prepare(
      "UPDATE nen_photo_submissions SET public_pet_name = 2 WHERE id = 'photo-a'",
    ).run()).toThrow();
  });
});
