import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(join(ROOT, 'migrations', '189_analytics_cross.sql'), 'utf8');

describe('migration 189: V6クロス分析', () => {
  it('非同期結果・セル対象者と2種類の共通対象者を作る', () => {
    const db = new Database(':memory:');
    db.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'analytics_%'`,
    ).all().map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining([
      'analytics_cross_runs',
      'analytics_cross_run_members',
      'analytics_result_audiences',
      'analytics_result_audience_members',
    ]));
    const audienceSql = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'analytics_result_audiences'`,
    ).get() as { sql: string };
    expect(audienceSql.sql).toContain("'funnel','cross'");
    db.close();
  });

  it('既存のファネル対象者を保ったまま共通対象者へ広げる', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      CREATE TABLE funnels (id TEXT PRIMARY KEY);
      CREATE TABLE analytics_funnel_versions (id TEXT PRIMARY KEY);
      CREATE TABLE analytics_funnel_runs (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
        funnel_id TEXT NOT NULL REFERENCES funnels(id),
        funnel_version_id TEXT REFERENCES analytics_funnel_versions(id)
      );
      CREATE TABLE analytics_result_audiences (
        id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('funnel')),
        source_result_id TEXT NOT NULL REFERENCES analytics_funnel_runs(id) ON DELETE CASCADE,
        selection_key TEXT NOT NULL,
        member_count INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_analytics_result_audiences_expiry
        ON analytics_result_audiences(line_account_id, expires_at);
      CREATE TABLE analytics_result_audience_members (
        audience_id TEXT NOT NULL REFERENCES analytics_result_audiences(id) ON DELETE CASCADE,
        friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
        PRIMARY KEY (audience_id, friend_id)
      );
      INSERT INTO line_accounts VALUES ('account-a');
      INSERT INTO friends VALUES ('friend-a');
      INSERT INTO funnels VALUES ('funnel-a');
      INSERT INTO analytics_funnel_runs VALUES ('run-a','account-a','funnel-a',NULL);
      INSERT INTO analytics_result_audiences
        VALUES ('audience-a','account-a','funnel','run-a','all:1:reached',1,'2026-08-27',NULL,'2026-08-26');
      INSERT INTO analytics_result_audience_members VALUES ('audience-a','friend-a');
    `);
    db.exec(MIGRATION);
    expect(db.prepare(`SELECT source_kind, member_count FROM analytics_result_audiences`).all())
      .toEqual([{ source_kind: 'funnel', member_count: 1 }]);
    expect(db.prepare(`SELECT friend_id FROM analytics_result_audience_members`).all())
      .toEqual([{ friend_id: 'friend-a' }]);
    expect(() => db.prepare(
      `INSERT INTO analytics_result_audiences
       VALUES ('bad','account-a','cross','missing','x',0,'2026-08-27',NULL,'2026-08-26')`,
    ).run()).toThrow('analytics_result_source_not_found');
    db.close();
  });
});
