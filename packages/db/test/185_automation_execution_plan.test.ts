import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(join(ROOT, 'migrations', '185_automation_execution_plan.sql'), 'utf8');

describe('185 V6オートメーション実行計画', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        input_event_json TEXT NOT NULL DEFAULT '{}'
      );
      INSERT INTO automation_runs (id, status) VALUES ('existing-run', 'waiting');
    `);
    db.exec(MIGRATION);
  });

  it('既存の実行は内容を推測せず、そのまま残す', () => {
    expect(db.prepare(
      `SELECT id, status, execution_plan_json FROM automation_runs WHERE id = 'existing-run'`,
    ).get()).toEqual({ id: 'existing-run', status: 'waiting', execution_plan_json: null });
  });

  it('新しい実行だけ開始時点の計画を保存できる', () => {
    const plan = JSON.stringify([{ id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' } }]);
    db.prepare(
      `INSERT INTO automation_runs (id, status, execution_plan_json) VALUES ('new-run', 'queued', ?)`,
    ).run(plan);
    expect(db.prepare(
      `SELECT execution_plan_json FROM automation_runs WHERE id = 'new-run'`,
    ).get()).toEqual({ execution_plan_json: plan });
  });
});
