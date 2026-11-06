import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '198_form_account_scope.sql'),
  'utf8',
);

describe('migration 198 form account scope', () => {
  it('uses proven references and leaves an unknown legacy form unassigned', () => {
    const db = new Database(':memory:');
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE forms (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT REFERENCES line_accounts(id));
      CREATE TABLE form_submissions (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL REFERENCES forms(id),
        friend_id TEXT REFERENCES friends(id)
      );
      CREATE TABLE rich_menu_groups (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES line_accounts(id)
      );
      CREATE TABLE rich_menu_pages (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES rich_menu_groups(id)
      );
      CREATE TABLE rich_menu_areas (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES rich_menu_pages(id),
        form_id TEXT REFERENCES forms(id)
      );
      CREATE TABLE webinars (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES line_accounts(id)
      );
      CREATE TABLE webinar_ctas (
        id TEXT PRIMARY KEY,
        webinar_id TEXT NOT NULL REFERENCES webinars(id),
        form_id TEXT REFERENCES forms(id)
      );

      INSERT INTO line_accounts VALUES ('account-a'), ('account-b'), ('account-c');
      INSERT INTO forms VALUES ('answered'), ('menu'), ('webinar'), ('unknown');
      INSERT INTO friends VALUES ('friend-a', 'account-a');
      INSERT INTO form_submissions VALUES ('submission-a', 'answered', 'friend-a');
      INSERT INTO rich_menu_groups VALUES ('group-b', 'account-b');
      INSERT INTO rich_menu_pages VALUES ('page-b', 'group-b');
      INSERT INTO rich_menu_areas VALUES ('area-b', 'page-b', 'menu');
      INSERT INTO webinars VALUES ('webinar-c', 'account-c');
      INSERT INTO webinar_ctas VALUES ('cta-c', 'webinar-c', 'webinar');
    `);

    db.exec(migration);

    expect(db.prepare(`
      SELECT form_id, line_account_id FROM form_accounts ORDER BY form_id
    `).all()).toEqual([
      { form_id: 'answered', line_account_id: 'account-a' },
      { form_id: 'menu', line_account_id: 'account-b' },
      { form_id: 'webinar', line_account_id: 'account-c' },
    ]);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM form_accounts WHERE form_id = 'unknown'`).get())
      .toEqual({ count: 0 });
  });
});
