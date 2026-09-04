import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function legacyDb(accounts: string[]): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE media (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE media_usages (media_id TEXT, ref_kind TEXT, ref_id TEXT);
    CREATE TABLE templates (id TEXT PRIMARY KEY, line_account_id TEXT);
    CREATE TABLE broadcasts (id TEXT PRIMARY KEY, line_account_id TEXT, account_ids TEXT);
    CREATE TABLE scenarios (id TEXT PRIMARY KEY, line_account_id TEXT);
    CREATE TABLE scenario_steps (id TEXT PRIMARY KEY, scenario_id TEXT);
    CREATE TABLE nen_columns (id TEXT PRIMARY KEY, line_account_id TEXT);
    CREATE TABLE events (id TEXT PRIMARY KEY, line_account_id TEXT, account_ids TEXT);
    CREATE TABLE webinars (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE rich_menu_groups (id TEXT PRIMARY KEY, account_id TEXT);
    CREATE TABLE rich_menu_pages (id TEXT PRIMARY KEY, group_id TEXT);
  `);
  const insert = db.prepare(`INSERT INTO line_accounts (id) VALUES (?)`);
  for (const account of accounts) insert.run(account);
  return db;
}

function applyMigration(db: Database.Database): void {
  db.exec(readFileSync(join(process.cwd(), 'migrations/261_media_account_scope.sql'), 'utf8'));
}

describe('261 media account scope', () => {
  it('counts distinct accounts across all batches, including duplicate and null JSON entries', () => {
    const db = legacyDb(['a1', 'a2']);
    try {
      db.exec(`
        INSERT INTO media (id, created_at) VALUES
          ('single', '2026-01-01'), ('shared', '2026-01-01'),
          ('json-shared', '2026-01-01'), ('unknown', '2026-01-01');
        INSERT INTO templates VALUES ('t1', 'a1');
        INSERT INTO broadcasts VALUES ('b1', 'a1', '["a1","a1",null]'),
          ('b-null', NULL, '[null,null]');
        INSERT INTO rich_menu_groups VALUES ('g1', 'a1');
        INSERT INTO rich_menu_pages VALUES ('p1', 'g1');
        INSERT INTO scenarios VALUES ('s1', 'a1');
        INSERT INTO scenario_steps VALUES ('ss1', 's1');
        INSERT INTO nen_columns VALUES ('n1', 'a1');
        INSERT INTO events VALUES ('e1', 'a1', '["a1","a1",null]'),
          ('e2', NULL, '["a2",null]');
        INSERT INTO webinars VALUES ('w1', 'a1'), ('w2', 'a2');
        INSERT INTO media_usages VALUES
          ('single', 'template', 't1'), ('single', 'template', 't1'),
          ('single', 'broadcast', 'b1'), ('single', 'rich_menu', 'p1'),
          ('single', 'scenario_step', 'ss1'), ('single', 'nen_column', 'n1'),
          ('single', 'event', 'e1'), ('single', 'webinar', 'w1'),
          ('shared', 'template', 't1'), ('shared', 'webinar', 'w2'),
          ('json-shared', 'broadcast', 'b1'), ('json-shared', 'event', 'e2'),
          ('unknown', 'broadcast', 'b-null');
      `);
      applyMigration(db);
      expect(db.prepare('SELECT id, line_account_id FROM media ORDER BY id').all()).toEqual([
        { id: 'json-shared', line_account_id: null },
        { id: 'shared', line_account_id: null },
        { id: 'single', line_account_id: 'a1' },
        { id: 'unknown', line_account_id: null },
      ]);
    } finally {
      db.close();
    }
  });

  it('assigns only a single proven usage account', () => {
    const db = legacyDb(['a1', 'a2']);
    db.exec(`
      INSERT INTO media (id, created_at) VALUES
        ('single','2026-01-01'), ('shared','2026-01-01'),
        ('multicast','2026-01-01'), ('rich','2026-01-01'), ('unknown','2026-01-01');
      INSERT INTO templates (id, line_account_id) VALUES ('t1','a1');
      INSERT INTO broadcasts (id, line_account_id, account_ids) VALUES
        ('b1','a1',NULL), ('b2','a2',NULL), ('bm',NULL,'["a1","a2"]');
      INSERT INTO rich_menu_groups (id, account_id) VALUES ('rg1','a2');
      INSERT INTO rich_menu_pages (id, group_id) VALUES ('rp1','rg1');
      INSERT INTO media_usages (media_id, ref_kind, ref_id) VALUES
        ('single','template','t1'),
        ('shared','broadcast','b1'),
        ('shared','broadcast','b2'),
        ('multicast','broadcast','bm'),
        ('rich','rich_menu','rp1');
    `);
    applyMigration(db);
    expect(db.prepare(`SELECT id, line_account_id FROM media ORDER BY id`).all()).toEqual([
      { id: 'multicast', line_account_id: null },
      { id: 'rich', line_account_id: 'a2' },
      { id: 'shared', line_account_id: null },
      { id: 'single', line_account_id: 'a1' },
      { id: 'unknown', line_account_id: null },
    ]);
    db.close();
  });

  it('preserves legacy media in a single-account installation', () => {
    const db = legacyDb(['a1']);
    db.exec(`INSERT INTO media (id, created_at) VALUES ('unknown','2026-01-01')`);
    applyMigration(db);
    expect(db.prepare(`SELECT line_account_id FROM media WHERE id = 'unknown'`).get())
      .toEqual({ line_account_id: 'a1' });
    db.close();
  });
});
