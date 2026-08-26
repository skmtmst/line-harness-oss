import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(join(ROOT, 'migrations', '187_analytics_read_model.sql'), 'utf8');

describe('187 V6分析の読取基盤', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
      INSERT INTO friends (id) VALUES ('friend-a');
    `);
    db.exec(MIGRATION);
  });

  it('既存業務データと分けた3つの受け皿を追加する', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'analytics_%'
      ORDER BY name
    `).all().map((row) => (row as { name: string }).name);
    expect(tables).toEqual([
      'analytics_daily_metrics',
      'analytics_events',
      'analytics_reconciliation_runs',
    ]);
  });

  it('同じアカウントの同じ発生元を二重記録しない', () => {
    const insert = db.prepare(`
      INSERT INTO analytics_events (
        id, line_account_id, friend_id, event_type, source_kind,
        source_id, occurred_at, idempotency_key
      ) VALUES (?, 'account-a', 'friend-a', 'friend_add', 'line_webhook',
                'source-1', '2026-08-26T00:00:00.000Z', 'source-1:friend_add')
    `);
    insert.run('event-1');
    expect(() => insert.run('event-2')).toThrow(/UNIQUE constraint failed/);
  });

  it('指標状態は定義済みの6状態以外を拒否する', () => {
    expect(() => db.prepare(`
      INSERT INTO analytics_daily_metrics (
        line_account_id, metric_date, metric_key, state, data_cutoff_at
      ) VALUES ('account-a', '2026-08-26', 'event_total', 'zero', '2026-08-26T00:00:00Z')
    `).run()).toThrow(/CHECK constraint failed/);
  });
});
