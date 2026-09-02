import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSavedAnalyticsFromResult,
  getSavedAnalytics,
  getSavedAnalyticsSnapshots,
} from '../src/analytics-saved.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('V6 保存した分析', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (
        id, channel_id, name, channel_access_token, channel_secret, timezone
      ) VALUES ('account-a','ca','A','ta','sa','Asia/Tokyo'),
               ('account-b','cb','B','tb','sb','Asia/Tokyo');
      INSERT INTO analytics_cross_runs (
        id, line_account_id, query_json, state, result_json, period_from, period_to,
        time_zone, data_cutoff_at, created_at, completed_at
      ) VALUES (
        'cross-a','account-a',
        '{"rowAxis":{"kind":"route"},"columnAxis":{"kind":"tag"},"measure":{"kind":"unique_friends"},"filters":[],"periodFrom":"2026-08-01T00:00:00.000Z","periodTo":"2026-08-07T23:59:59.999Z","timeZone":"Asia/Tokyo"}',
        'available','{"totalFriends":12,"totalValue":12}',
        '2026-08-01T00:00:00.000Z','2026-08-07T23:59:59.999Z','Asia/Tokyo',
        '2026-08-08T00:00:00.000Z','2026-08-08T00:00:00.000Z','2026-08-08T00:00:00.000Z'
      );
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('定義版と結果を分け、保存後に元結果が変わってもスナップショットを変えない', async () => {
    const created = await createSavedAnalyticsFromResult(db, {
      lineAccountId: 'account-a',
      name: '経路 × タグ',
      sourceKind: 'cross',
      sourceResultId: 'cross-a',
      createdBy: 'staff-a',
      createdByName: '担当A',
      createdAt: '2026-08-08T01:00:00.000Z',
    });
    expect(created.id).toBeTruthy();
    expect(await getSavedAnalytics(db, 'account-a')).toEqual([
      expect.objectContaining({
        name: '経路 × タグ', kind: 'cross', currentVersionNumber: 1,
        createdByName: '担当A', snapshotCount: 1,
        latestSnapshot: expect.objectContaining({ state: 'available' }),
      }),
    ]);
    expect(await getSavedAnalytics(db, 'account-b')).toEqual([]);

    const snapshots = await getSavedAnalyticsSnapshots(db, 'account-a', created.id);
    expect(snapshots).toEqual([
      expect.objectContaining({
        analysisVersionId: created.versionId,
        sourceResultId: 'cross-a',
        result: { totalFriends: 12, totalValue: 12 },
      }),
    ]);
    expect(await getSavedAnalyticsSnapshots(db, 'account-b', created.id)).toBeNull();
    expect(() => sqlite.prepare(
      `UPDATE analytics_saved_analysis_snapshots SET result_json = '{}' WHERE id = ?`,
    ).run(created.snapshotId)).toThrow('analytics_saved_snapshot_immutable');
    expect(() => sqlite.prepare(
      `UPDATE analytics_saved_analysis_versions SET definition_json = '{}' WHERE id = ?`,
    ).run(created.versionId)).toThrow('analytics_saved_version_immutable');
    expect(() => sqlite.prepare(
      `DELETE FROM analytics_saved_analysis_versions WHERE id = ?`,
    ).run(created.versionId)).toThrow('analytics_saved_version_immutable');
    expect(() => sqlite.prepare(
      `INSERT INTO analytics_saved_analysis_versions (
         id, saved_analysis_id, line_account_id, version_number,
         definition_json, created_at
       ) VALUES ('wrong-version', ?, 'account-b', 2, '{}', '2026-08-08')`,
    ).run(created.id)).toThrow('analytics_saved_parent_mismatch');
    expect(() => sqlite.prepare(
      `INSERT INTO analytics_saved_analysis_snapshots (
         id, saved_analysis_id, analysis_version_id, line_account_id,
         source_kind, source_result_id, period_from, period_to, time_zone,
         data_cutoff_at, state, result_json, created_at
       ) VALUES (
         'wrong-snapshot', ?, ?, 'account-b', 'cross', 'cross-a',
         '2026-08-01', '2026-08-07', 'Asia/Tokyo', '2026-08-08',
         'available', '{}', '2026-08-08'
       )`,
    ).run(created.id, created.versionId)).toThrow('analytics_saved_parent_mismatch');
  });

  it('別アカウントまたは未確定の結果を保存済みのように扱わない', async () => {
    await expect(createSavedAnalyticsFromResult(db, {
      lineAccountId: 'account-b', name: '見えない結果', sourceKind: 'cross',
      sourceResultId: 'cross-a', createdByName: '担当B', createdAt: '2026-08-08T01:00:00.000Z',
    })).rejects.toThrow('analytics_saved_source_not_found');
    sqlite.prepare(
      `INSERT INTO analytics_cross_runs (
         id, line_account_id, query_json, state, result_json, period_from, period_to,
         time_zone, data_cutoff_at, created_at
       ) VALUES ('cross-pending','account-a','{}','pending','{}',
                 '2026-08-01','2026-08-07','Asia/Tokyo','2026-08-08','2026-08-08')`,
    ).run();
    await expect(createSavedAnalyticsFromResult(db, {
      lineAccountId: 'account-a', name: '未確定', sourceKind: 'cross',
      sourceResultId: 'cross-pending', createdByName: '担当A', createdAt: '2026-08-08T01:00:00.000Z',
    })).rejects.toThrow('analytics_saved_source_not_found');
  });
});
