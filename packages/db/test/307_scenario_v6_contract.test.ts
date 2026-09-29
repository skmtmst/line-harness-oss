import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '307_scenario_v6_contract.sql'),
  'utf8',
);

describe('migration 307 scenario V6 contract', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE scenarios (id TEXT PRIMARY KEY);
      INSERT INTO line_accounts (id) VALUES ('account-a');
      INSERT INTO scenarios (id) VALUES ('scenario-a');
    `);
    sqlite.exec(migration);
  });

  afterEach(() => sqlite.close());

  it('下書きの版と送信後アクションを保持する', () => {
    sqlite.prepare(`
      INSERT INTO scenario_drafts
        (scenario_id, line_account_id, version, after_actions_json,
         updated_by, created_at, updated_at)
      VALUES ('scenario-a', 'account-a', 1, '[{"id":"action-a"}]',
              'staff-a', '2026-09-07', '2026-09-07')
    `).run();
    expect(sqlite.prepare(
      'SELECT version, after_actions_json FROM scenario_drafts WHERE scenario_id = ?',
    ).get('scenario-a')).toEqual({ version: 1, after_actions_json: '[{"id":"action-a"}]' });
  });

  it('壊れたJSONと0以下の版を保存しない', () => {
    const insert = sqlite.prepare(`
      INSERT INTO scenario_drafts
        (scenario_id, line_account_id, version, after_actions_json,
         updated_by, created_at, updated_at)
      VALUES ('scenario-a', 'account-a', ?, ?, 'staff-a', '2026-09-07', '2026-09-07')
    `);
    expect(() => insert.run(0, '[]')).toThrow(/CHECK/);
    expect(() => insert.run(1, '{')).toThrow(/CHECK/);
  });

  it('シナリオ削除時に未公開下書きも削除する', () => {
    sqlite.prepare(`
      INSERT INTO scenario_drafts
        (scenario_id, line_account_id, version, after_actions_json,
         updated_by, created_at, updated_at)
      VALUES ('scenario-a', 'account-a', 1, '[]', 'staff-a', '2026-09-07', '2026-09-07')
    `).run();
    sqlite.prepare("DELETE FROM scenarios WHERE id = 'scenario-a'").run();
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM scenario_drafts').get()).toEqual({ total: 0 });
  });
});
