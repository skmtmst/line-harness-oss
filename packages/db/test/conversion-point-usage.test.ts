import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  getConversionPointUsage,
  getConversionPoints,
  getConversionReport,
} from '../src/conversions.js';
import { asD1 } from './d1-test-helper.js';

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE conversion_points (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, event_type TEXT NOT NULL, value REAL,
      measure_method TEXT NOT NULL DEFAULT 'manual', target_url TEXT,
      count_repeat INTEGER NOT NULL DEFAULT 1, attribution_days INTEGER,
      line_account_id TEXT, status TEXT NOT NULL DEFAULT 'active', stopped_at TEXT,
      updated_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE conversion_events (
      id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL, friend_id TEXT NOT NULL,
      value_snapshot REAL, created_at TEXT NOT NULL
    );
    CREATE TABLE funnels (
      id TEXT PRIMARY KEY, line_account_id TEXT, name TEXT NOT NULL,
      segment_json TEXT, window_days INTEGER NOT NULL DEFAULT 30, created_at TEXT NOT NULL
    );
    CREATE TABLE funnel_steps (
      id TEXT PRIMARY KEY, funnel_id TEXT NOT NULL, step_order INTEGER NOT NULL,
      label TEXT NOT NULL, kind TEXT NOT NULL, match_json TEXT NOT NULL
    );
    CREATE TABLE analytics_funnel_versions (
      id TEXT PRIMARY KEY, funnel_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
      version_number INTEGER NOT NULL, window_days INTEGER NOT NULL,
      steps_json TEXT NOT NULL, segment_json TEXT, comparison_groups_json TEXT NOT NULL,
      created_by TEXT, created_at TEXT NOT NULL
    );

    INSERT INTO conversion_points
      (id, name, event_type, value, line_account_id, updated_at, created_at)
    VALUES
      ('point-a', 'Aの購入', 'purchase', 1000, 'account-a', '2026-08-01', '2026-08-01'),
      ('point-b', 'Bの購入', 'purchase', 2000, 'account-b', '2026-08-01', '2026-08-01');
    INSERT INTO conversion_events
      (id, conversion_point_id, friend_id, value_snapshot, created_at)
    VALUES
      ('event-a', 'point-a', 'friend-a', 1000, '2026-08-10'),
      ('event-b', 'point-b', 'friend-b', 2000, '2026-08-10');

    INSERT INTO funnels (id, line_account_id, name, created_at)
    VALUES
      ('funnel-a', 'account-a', '購入ファネル', '2026-08-01'),
      ('funnel-b', 'account-a', '再購入ファネル', '2026-08-01');
    INSERT INTO funnel_steps (id, funnel_id, step_order, label, kind, match_json)
    VALUES ('step-a', 'funnel-a', 1, '購入', 'conversion', '{"conversionPointId":"point-a"}');

    -- funnel-a は旧形式とV6版の両方に残るが、利用先は1件として返す。
    INSERT INTO analytics_funnel_versions
      (id, funnel_id, line_account_id, version_number, window_days, steps_json,
       segment_json, comparison_groups_json, created_at)
    VALUES
      ('version-a1', 'funnel-a', 'account-a', 1, 30,
       '[{"order":1,"label":"旧","kind":"conversion","match":{"conversionPointId":"point-b"}}]',
       '{}', '[]', '2026-08-01'),
      ('version-a2', 'funnel-a', 'account-a', 2, 30,
       '[{"order":1,"label":"購入","kind":"conversion","match":{"conversionPointId":"point-a"}}]',
       '{}', '[]', '2026-08-02'),
      ('version-b1', 'funnel-b', 'account-a', 1, 30,
       '[{"order":1,"label":"再購入","kind":"conversion","match":{"conversionPointId":"point-a"}}]',
       '{}', '[]', '2026-08-02');
  `);
  return sqlite;
}

describe('成果地点のアカウント境界と利用先', () => {
  it('選択中アカウントの成果地点と集計だけを返す', async () => {
    const db = asD1(setup());
    expect((await getConversionPoints(db, { lineAccountId: 'account-a' })).map((row) => row.id))
      .toEqual(['point-a']);
    expect(await getConversionReport(db, { lineAccountId: 'account-a' }))
      .toEqual([expect.objectContaining({ conversionPointId: 'point-a', totalCount: 1, totalValue: 1000 })]);
  });

  it('旧ファネルと最新V6版を構造的に読み、重複を返さない', async () => {
    const db = asD1(setup());
    const usage = await getConversionPointUsage(db);
    expect(usage.filter((row) => row.conversionPointId === 'point-a')).toEqual([
      expect.objectContaining({ consumerId: 'funnel-a', consumerName: '購入ファネル' }),
      expect.objectContaining({ consumerId: 'funnel-b', consumerName: '再購入ファネル' }),
    ]);
    expect(usage.some((row) => row.conversionPointId === 'point-b')).toBe(false);
    expect(await getConversionPointUsage(db, { lineAccountId: 'account-b' })).toEqual([]);
  });
});
