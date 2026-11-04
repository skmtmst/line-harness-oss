import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { collectFeatureUsage } from '../src/analytics-overviews-usage-measures.js';
import { asD1 } from './d1-test-helper.js';

it('開始時刻がない自動化も、UTC と JST の作成日時を実時刻で数え最新を返す', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
    sqlite.pragma('foreign_keys=OFF');
    sqlite.exec(`INSERT INTO automation_runs(id,line_account_id,automation_id,automation_version_id,source_event_id,idempotency_key,status,created_at) VALUES
      ('earlier','a','d','v','e1','k1','failed','2026-10-02T01:00:00'),
      ('later','a','d','v','e2','k2','failed','2026-10-01 17:00:00')`);
    const usage = (await collectFeatureUsage(asD1(sqlite), 'a', '2026-10-01T16:30:00Z')).get('automations');
    expect(usage).toMatchObject({ count: 1, lastUsedAt: '2026-10-01T17:00:00Z', failed: false });
  } finally {
    sqlite.close();
  }
});
