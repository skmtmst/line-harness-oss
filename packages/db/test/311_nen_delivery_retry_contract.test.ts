import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '311_nen_delivery_retry_contract.sql'),
  'utf8',
);

describe('migration 311 NEN delivery retry contract', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE nen_delivery_jobs (
        id TEXT PRIMARY KEY,
        line_account_id TEXT,
        scheduled_at TEXT NOT NULL
      );
      INSERT INTO nen_delivery_jobs (id, line_account_id, scheduled_at)
      VALUES ('job-a', 'account-a', '2026-09-07 10:00:00');
    `);
    sqlite.exec(migration);
  });

  afterEach(() => sqlite.close());

  it('既存配信へ版と再送世代の安全な初期値を付ける', () => {
    expect(sqlite.prepare(
      `SELECT version, retry_generation, last_retry_reason,
              last_retry_requested_by, last_retry_requested_at
         FROM nen_delivery_jobs WHERE id = 'job-a'`,
    ).get()).toEqual({
      version: 1,
      retry_generation: 0,
      last_retry_reason: null,
      last_retry_requested_by: null,
      last_retry_requested_at: null,
    });
  });

  it('不正な版・再送世代・再送理由を保存しない', () => {
    expect(() => sqlite.prepare(
      `UPDATE nen_delivery_jobs SET version = 0 WHERE id = 'job-a'`,
    ).run()).toThrow(/CHECK/);
    expect(() => sqlite.prepare(
      `UPDATE nen_delivery_jobs SET retry_generation = -1 WHERE id = 'job-a'`,
    ).run()).toThrow(/CHECK/);
    expect(() => sqlite.prepare(
      `UPDATE nen_delivery_jobs SET last_retry_reason = '' WHERE id = 'job-a'`,
    ).run()).toThrow(/CHECK/);
  });

  it('アカウントと予定日時で配信履歴を探せる索引を作る', () => {
    const indexes = sqlite.prepare(`PRAGMA index_list('nen_delivery_jobs')`).all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toContain('idx_nen_delivery_jobs_account_schedule');
  });
});
