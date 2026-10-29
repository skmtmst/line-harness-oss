import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { getListStats } from '../src/dashboard.js';
import { asD1 } from './d1-test-helper.js';

it('シナリオの合計人数は選択アカウントの全シナリオを数える', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
        VALUES ('a', 'ca', 'A', 'ta', 'sa'), ('b', 'cb', 'B', 'tb', 'sb');
      INSERT INTO scenarios (id, name, trigger_type, line_account_id)
        VALUES ('sa', 'A向け', 'manual', 'a'), ('sb', 'B向け', 'manual', 'b'), ('sg', '共通', 'manual', NULL);
      INSERT INTO friends (id, line_user_id, line_account_id)
        VALUES ('fa', 'Ua', 'a'), ('fb', 'Ub', 'b');
      INSERT INTO friend_scenarios (id, friend_id, scenario_id, status)
        VALUES ('aa', 'fa', 'sa', 'completed'), ('ag', 'fa', 'sg', 'completed'),
               ('bb', 'fb', 'sb', 'completed');
    `);
    const stats = await getListStats(asD1(sqlite), { allowedAccountIds: ['a'], includeUnassigned: true });
    expect(stats.scenarios.total).toBe(2);
    expect(stats.scenarios.completed).toBe(2);
    expect(stats.scenarios.subscribers).toBe(0);
  } finally {
    sqlite.close();
  }
});
