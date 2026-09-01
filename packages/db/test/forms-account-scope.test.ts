import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getFormsWithStats } from '../src/forms.js';
import { asD1 } from './d1-test-helper.js';

function setup(): D1Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE forms (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, fields TEXT NOT NULL,
      layout TEXT, on_submit_tag_id TEXT, on_submit_scenario_id TEXT,
      on_submit_message_type TEXT, on_submit_message_content TEXT,
      on_submit_webhook_url TEXT, on_submit_webhook_headers TEXT,
      on_submit_webhook_fail_message TEXT, save_to_metadata INTEGER NOT NULL,
      is_active INTEGER NOT NULL, submit_count INTEGER NOT NULL,
      og_title TEXT, og_description TEXT, og_image_url TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE line_accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT, display_order INTEGER NOT NULL
    );
    CREATE TABLE form_accounts (
      form_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
      PRIMARY KEY (form_id, line_account_id)
    );
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT);
    CREATE TABLE form_submissions (
      id TEXT PRIMARY KEY, form_id TEXT NOT NULL, friend_id TEXT, created_at TEXT NOT NULL
    );

    INSERT INTO line_accounts VALUES
      ('account-a', 'A店', 'JP', 1), ('account-b', 'B店', 'JP', 2);
    INSERT INTO forms VALUES
      ('form-a', 'A用', NULL, '[]', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, 1, NULL, NULL, NULL, '2026-08-01', '2026-08-01'),
      ('form-b', 'B用', NULL, '[]', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, 0, NULL, NULL, NULL, '2026-08-02', '2026-08-02'),
      ('legacy', '要確認', NULL, '[]', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, 0, NULL, NULL, NULL, '2026-08-03', '2026-08-03');
    INSERT INTO form_accounts VALUES ('form-a', 'account-a'), ('form-b', 'account-b');
    INSERT INTO friends VALUES ('friend-a', 'account-a');
    INSERT INTO form_submissions VALUES ('submission-a', 'form-a', 'friend-a', '2026-08-04');
  `);
  return asD1(sqlite);
}

describe('form account scope', () => {
  it('returns only the requested account and includes the explicit usage account', async () => {
    const rows = await getFormsWithStats(setup(), { lineAccountIds: ['account-a'] });
    expect(rows.map((row) => row.id)).toEqual(['form-a']);
    expect(rows[0]?.used_by_accounts).toEqual([
      { id: 'account-a', name: 'A店', country: 'JP', displayOrder: 1, count: 1 },
    ]);
    expect(rows[0]?.account_scope_review_required).toBe(false);
  });

  it('does not mix unassigned legacy forms into a selected account', async () => {
    expect(await getFormsWithStats(setup(), { lineAccountIds: [] })).toEqual([]);
    const pending = await getFormsWithStats(setup(), {
      lineAccountIds: [],
      includeUnassigned: true,
    });
    expect(pending.map((row) => row.id)).toEqual(['legacy']);
    expect(pending[0]?.account_scope_review_required).toBe(true);
  });
});
