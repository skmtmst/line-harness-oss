import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('migration 188: V6時系列ファネル', () => {
  it('版・不変結果・対象者の表と制約を作る', () => {
    const db = new Database(':memory:');
    db.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'analytics_%'
       ORDER BY name`,
    ).all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      'analytics_funnel_versions',
      'analytics_funnel_runs',
      'analytics_funnel_run_members',
      'analytics_result_audiences',
      'analytics_result_audience_members',
    ]));
    const sql = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'analytics_funnel_runs'`,
    ).get() as { sql: string };
    expect(sql.sql).toContain("'pending'");
    expect(sql.sql).toContain("'partial'");
    db.close();
  });
});
