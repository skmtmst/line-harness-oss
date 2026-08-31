import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '260_nen_photo_publication_placements.sql'),
  'utf8',
);

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE nen_photo_submissions (id TEXT PRIMARY KEY);
    INSERT INTO line_accounts VALUES ('account-a'), ('account-b');
    INSERT INTO nen_photo_submissions VALUES ('photo-a');
  `);
  sqlite.exec(migration);
  return sqlite;
}

function insertPublication(sqlite: Database.Database): void {
  sqlite.prepare(`INSERT INTO nen_photo_publications
    (id, photo_id, line_account_id, status, published_by, published_by_name,
     published_at, created_at, updated_at)
    VALUES ('publication-a', 'photo-a', 'account-a', 'published', 'staff-a', '担当者',
            '2026-08-31', '2026-08-31', '2026-08-31')`).run();
}

describe('migration 260 NEN photo publication placements', () => {
  it('does not auto-publish an adopted photo during migration', () => {
    const sqlite = setup();
    expect(sqlite.prepare('SELECT COUNT(*) count FROM nen_photo_publications').get()).toEqual({ count: 0 });
  });

  it('records a measured and an unavailable placement separately', () => {
    const sqlite = setup();
    insertPublication(sqlite);
    const insert = sqlite.prepare(`INSERT INTO nen_photo_publication_placements
      (id, publication_id, line_account_id, placement_type, placement_key, placement_name,
       status, display_count, display_count_source, placed_at, created_at, updated_at)
      VALUES (?, 'publication-a', 'account-a', ?, ?, ?, 'active', ?, ?,
              '2026-08-31', '2026-08-31', '2026-08-31')`);
    insert.run('placement-a', 'rich_menu', 'menu-a', '会員メニュー', 1240, 'rich_menu_impressions');
    insert.run('placement-b', 'website', 'site-a', '公式サイト', null, null);
    expect(sqlite.prepare(`SELECT placement_type, display_count FROM nen_photo_publication_placements
      ORDER BY placement_type`).all()).toEqual([
      { placement_type: 'rich_menu', display_count: 1240 },
      { placement_type: 'website', display_count: null },
    ]);
  });

  it('rejects duplicate destinations and negative display counts', () => {
    const sqlite = setup();
    insertPublication(sqlite);
    const insert = sqlite.prepare(`INSERT INTO nen_photo_publication_placements
      (id, publication_id, line_account_id, placement_type, placement_key, placement_name,
       status, display_count, placed_at, created_at, updated_at)
      VALUES (?, 'publication-a', 'account-a', 'form', 'form-a', '来店アンケート',
              'active', ?, '2026-08-31', '2026-08-31', '2026-08-31')`);
    insert.run('placement-a', 0);
    expect(() => insert.run('placement-b', 1)).toThrow();
    expect(() => sqlite.prepare(`UPDATE nen_photo_publication_placements
      SET display_count = -1 WHERE id = 'placement-a'`).run()).toThrow();
  });

  it('requires a withdrawal time when a publication is withdrawn', () => {
    const sqlite = setup();
    insertPublication(sqlite);
    expect(() => sqlite.prepare(`UPDATE nen_photo_publications
      SET status = 'withdrawn' WHERE id = 'publication-a'`).run()).toThrow();
  });

  it('only accepts a complete public derivative and keeps original storage out of the ledger', () => {
    const sqlite = setup();
    insertPublication(sqlite);
    expect(() => sqlite.prepare(`UPDATE nen_photo_publications
      SET public_asset_kind = 'public_derivative', public_asset_url = 'https://public.example/photo.jpg'
      WHERE id = 'publication-a'`).run()).toThrow();
    expect(() => sqlite.prepare(`UPDATE nen_photo_publications
      SET public_asset_kind = 'original', public_asset_url = 'https://private.example/original.jpg',
          public_asset_version = 'v1' WHERE id = 'publication-a'`).run()).toThrow();
    expect(sqlite.prepare(`UPDATE nen_photo_publications
      SET public_asset_kind = 'public_derivative', public_asset_url = 'https://public.example/photo.jpg',
          public_asset_version = 'safe-v1' WHERE id = 'publication-a'`).run().changes).toBe(1);
  });

  it('does not attach a placement from another LINE account', () => {
    const sqlite = setup();
    insertPublication(sqlite);
    expect(() => sqlite.prepare(`INSERT INTO nen_photo_publication_placements
      (id, publication_id, line_account_id, placement_type, placement_key, placement_name,
       status, placed_at, created_at, updated_at)
      VALUES ('placement-cross-account', 'publication-a', 'account-b', 'website', 'site-a',
              '公式サイト', 'active', '2026-08-31', '2026-08-31', '2026-08-31')`).run()).toThrow();
  });
});
