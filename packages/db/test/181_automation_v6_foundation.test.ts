import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(
  join(ROOT, 'migrations', '181_automation_v6_foundation.sql'),
  'utf8',
);

describe('181 V6オートメーション基盤', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      INSERT INTO line_accounts (id) VALUES ('account-1');
      INSERT INTO friends (id) VALUES ('friend-1');
    `);
    db.exec(MIGRATION);
  });

  it('旧テーブルを変えず、新形式の7つの受け皿を追加する', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => (row as { name: string }).name);

    expect(tables).toEqual(expect.arrayContaining([
      'automation_definitions',
      'automation_versions',
      'automation_runs',
      'automation_run_steps',
      'common_actions',
      'common_action_versions',
      'common_action_bindings',
    ]));
  });

  it('同じイベントの同じオートメーションを二重実行にしない', () => {
    insertPublishedAutomation(db);
    insertRun(db, 'run-1');
    expect(() => insertRun(db, 'run-2')).toThrow(/UNIQUE constraint failed/);
  });

  it('公開済み版の更新と削除をDBでも拒否する', () => {
    insertPublishedAutomation(db);
    expect(() => db.prepare(`
      UPDATE automation_versions SET action_config = '[]' WHERE id = 'version-1'
    `).run()).toThrow(/published automation version is immutable/);
    expect(() => db.prepare(`
      DELETE FROM automation_versions WHERE id = 'version-1'
    `).run()).toThrow(/published automation version cannot be deleted/);
  });

  it('実行履歴と処理結果の物理削除を拒否する', () => {
    insertPublishedAutomation(db);
    insertRun(db, 'run-1');
    db.prepare(`
      INSERT INTO automation_run_steps (
        id, automation_run_id, step_key, action_type, idempotency_key, status
      ) VALUES ('step-1', 'run-1', 'step-1', 'add_tag', 'step-key-1', 'success')
    `).run();

    expect(() => db.prepare(`DELETE FROM automation_run_steps WHERE id = 'step-1'`).run())
      .toThrow(/automation step history cannot be deleted/);
    expect(() => db.prepare(`DELETE FROM automation_runs WHERE id = 'run-1'`).run())
      .toThrow(/automation run history cannot be deleted/);
  });
});

function insertPublishedAutomation(db: Database.Database): void {
  db.prepare(`
    INSERT INTO automation_definitions (
      id, line_account_id, name, status
    ) VALUES ('automation-1', 'account-1', '来店後フォロー', 'active')
  `).run();
  db.prepare(`
    INSERT INTO automation_versions (
      id, automation_id, version_number, status, trigger_type, action_config, published_at
    ) VALUES (
      'version-1', 'automation-1', 1, 'published', 'friend_add',
      '[{"type":"add_tag","params":{"tagId":"tag-1"}}]', datetime('now')
    )
  `).run();
  db.prepare(`
    UPDATE automation_definitions
    SET current_published_version_id = 'version-1'
    WHERE id = 'automation-1'
  `).run();
}

function insertRun(db: Database.Database, id: string): void {
  db.prepare(`
    INSERT INTO automation_runs (
      id, line_account_id, automation_id, automation_version_id,
      friend_id, source_event_id, idempotency_key
    ) VALUES (?, 'account-1', 'automation-1', 'version-1', 'friend-1', 'event-1', 'event-1')
  `).bind(id).run();
}
