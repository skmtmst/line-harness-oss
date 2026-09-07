import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addConversionDefinitionUsage,
  createConversionDefinition,
  deleteUnusedConversionDefinition,
  getConversionDefinitionDetail,
  getConversionDefinitionDeleteImpact,
  getConversionDefinitionReport,
  listConversionDefinitions,
  previewConversionDefinition,
  replaceConversionDefinitionUsages,
  stopConversionDefinition,
} from '../src/conversion-definitions.js';
import { asD1 } from './d1-test-helper.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '319_conversion_definition_read_contract.sql'),
  'utf8',
);
const writeMigration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '330_conversion_definition_write_contract.sql'),
  'utf8',
);

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE conversion_points (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, event_type TEXT NOT NULL, value REAL,
      measure_method TEXT NOT NULL DEFAULT 'manual', target_url TEXT,
      count_repeat INTEGER NOT NULL DEFAULT 1, attribution_days INTEGER,
      line_account_id TEXT REFERENCES line_accounts(id), status TEXT NOT NULL DEFAULT 'active',
      stopped_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE conversion_events (
      id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL REFERENCES conversion_points(id),
      friend_id TEXT NOT NULL, value_snapshot REAL, attributed_ref_code TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
    INSERT INTO conversion_points
      (id, name, event_type, value, line_account_id, status, stopped_at, created_at, updated_at)
    VALUES
      ('point-a', '購入完了', 'purchase', 5000, 'account-a', 'active', NULL, '2026-08-01', '2026-09-02'),
      ('point-stop', '資料請求', 'form', NULL, 'account-a', 'stopped', '2026-09-01', '2026-08-02', '2026-09-01'),
      ('point-b', '担当外', 'purchase', 3000, 'account-b', 'active', NULL, '2026-08-03', '2026-09-03');
    INSERT INTO conversion_events (id, conversion_point_id, friend_id, value_snapshot, attributed_ref_code, created_at)
    VALUES
      ('event-current-1', 'point-a', 'friend-1', 5000, 'route-a', '2026-09-02 10:00:00'),
      ('event-current-2', 'point-a', 'friend-1', 6000, NULL, '2026-09-03 10:00:00'),
      ('event-previous', 'point-a', 'friend-2', 4000, 'route-a', '2026-08-30 10:00:00'),
      ('event-hidden', 'point-b', 'friend-3', 3000, 'route-b', '2026-09-02 10:00:00');
  `);
  sqlite.exec(migration);
  sqlite.exec(writeMigration);
  return sqlite;
}

const scope = { allowedAccountIds: ['account-a'], includeUnassigned: false };
const range = { from: '2026-09-01 00:00:00', to: '2026-09-07 23:59:59', timeZone: 'Asia/Tokyo' as const };
const previousRange = { from: '2026-08-25 00:00:00', to: '2026-08-31 23:59:59', timeZone: 'Asia/Tokyo' as const };

describe('migration 319 conversion definition read contract', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setup();
    db = asD1(sqlite);
  });

  it('担当範囲・検索・状態・期間をSQLで絞り、空も成功結果にする', async () => {
    const result = await listConversionDefinitions(db, {
      scope, lineAccountId: 'account-a', query: '購入', status: 'active', range,
      cursor: 0, limit: 20, sort: 'count_desc',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'point-a', version: 1, usageCount: 0,
      metrics: { recordedCount: 2, netCount: 2, reversedCount: null, netValue: 11000 },
    });
    expect(result.stateCounts).toMatchObject({ active: 1, stopped: 0 });
    expect(result.pagination).toEqual({ total: 1, limit: 20, cursor: '0', nextCursor: null });

    const empty = await listConversionDefinitions(db, {
      scope, query: '該当なし', range, cursor: 0, limit: 20, sort: 'name_asc',
    });
    expect(empty.items).toEqual([]);
    expect(empty.pagination.total).toBe(0);

    const activeOnly = await listConversionDefinitions(db, {
      scope, status: 'active', range, cursor: 0, limit: 20, sort: 'count_desc',
    });
    expect(activeOnly.stateCounts).toMatchObject({ active: 1, stopped: 1 });
  });

  it('利用先を構造化して返し、同じ再送だけを200相当として扱う', async () => {
    const created = await addConversionDefinitionUsage(db, {
      conversionPointId: 'point-a', lineAccountId: 'account-a', expectedVersion: 1,
      refKind: 'scenario', refId: 'scenario-1', refVersionId: 'version-3', staffId: 'staff-1',
    });
    expect(created.created).toBe(true);
    expect(created.usage).toMatchObject({ refKind: 'scenario', refId: 'scenario-1', definitionVersion: 1 });

    const repeated = await addConversionDefinitionUsage(db, {
      conversionPointId: 'point-a', lineAccountId: 'account-a', expectedVersion: 1,
      refKind: 'scenario', refId: 'scenario-1', refVersionId: 'version-3', staffId: 'staff-1',
    });
    expect(repeated.created).toBe(false);
    expect(repeated.usage.id).toBe(created.usage.id);

    const detail = await getConversionDefinitionDetail(db, 'point-a', scope);
    expect(detail).toMatchObject({ currentVersion: { number: 1 }, usages: [{ refKind: 'scenario' }] });
    expect(await getConversionDefinitionDetail(db, 'point-b', scope)).toBeNull();
  });

  it('古い版・停止済み・別アカウントを区別して拒否する', async () => {
    await expect(addConversionDefinitionUsage(db, {
      conversionPointId: 'point-a', lineAccountId: 'account-a', expectedVersion: 2,
      refKind: 'analytics', refId: 'analysis-1', staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    await expect(addConversionDefinitionUsage(db, {
      conversionPointId: 'point-stop', lineAccountId: 'account-a', expectedVersion: 1,
      refKind: 'analytics', refId: 'analysis-1', staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'definition_stopped', status: 409 });
    await expect(addConversionDefinitionUsage(db, {
      conversionPointId: 'point-b', lineAccountId: 'account-a', expectedVersion: 1,
      refKind: 'analytics', refId: 'analysis-1', staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('現期間・前期間・日別・地点別・経路別を実イベントから集計する', async () => {
    const report = await getConversionDefinitionReport(db, {
      scope, lineAccountId: 'account-a', range, previousRange,
    });
    expect(report.kpis).toMatchObject({
      recordedCount: 2, reversedCount: null, netCount: 2, netValue: 11000,
      previousNetCount: 1, previousNetValue: 4000, countChangeRate: 100,
    });
    expect(report.daily).toHaveLength(2);
    expect(report.byDefinition.find((row) => row.conversionPointId === 'point-a')).toMatchObject({
      netCount: 2, previousNetCount: 1, countChange: 1,
    });
    expect(report.byRoute).toEqual(expect.arrayContaining([
      expect.objectContaining({ routeKey: 'route-a', netCount: 1, audience: null, conversionRate: null }),
      expect.objectContaining({ routeKey: 'unattributed', netCount: 1 }),
    ]));
    expect(report.byRoute.some((row) => row.routeKey === 'route-b')).toBe(false);
  });

  it('動画・30日1回・取消・利用先をひとつの定義として保存する', async () => {
    const created = await createConversionDefinition(db, {
      name: '動画を見終えた', sourceType: 'webinar_completed', sourceConfig: { webinarId: 'webinar-1' },
      measureMethod: 'webhook', deduplicationMode: 'window', deduplicationWindowDays: 30,
      valueMode: 'none', reversalPolicy: 'none', attributionDays: 30,
      lineAccountId: 'account-a', staffId: 'staff-1',
      usages: [{ refKind: 'analytics', refId: 'analysis-video' }],
    });
    expect(created).toMatchObject({
      name: '動画を見終えた', sourceType: 'webinar_completed', sourceConfig: { webinarId: 'webinar-1' },
      deduplicationMode: 'window', deduplicationWindowDays: 30, valueMode: 'none',
      reversalPolicy: 'none', usages: [{ refKind: 'analytics', refId: 'analysis-video' }],
    });
  });

  it('入力内容だけの保存前試算で重複を除き、定義を増やさない', async () => {
    const before = sqlite.prepare('SELECT COUNT(*) AS total FROM conversion_points').get() as { total: number };
    const preview = await previewConversionDefinition(db, {
      scope, lineAccountId: 'account-a', sourceType: 'purchase',
      deduplicationMode: 'once_per_friend', valueMode: 'fixed', fixedValue: 5000, range,
    });
    expect(preview).toMatchObject({ matchedCount: 2, estimatedCount: 1, estimatedValue: 5000, duplicateExcludedCount: 1 });
    const after = sqlite.prepare('SELECT COUNT(*) AS total FROM conversion_points').get() as { total: number };
    expect(after.total).toBe(before.total);
  });

  it('停止影響を返し、利用先を別地点へ差し替えて元地点を停止する', async () => {
    await addConversionDefinitionUsage(db, {
      conversionPointId: 'point-a', lineAccountId: 'account-a', expectedVersion: 1,
      refKind: 'scenario', refId: 'scenario-1', staffId: 'staff-1',
    });
    const impact = await getConversionDefinitionDeleteImpact(db, 'point-a', scope);
    expect(impact).toMatchObject({ eventCount: 3, canDelete: false, stopImpact: { affectedUsageCount: 1 } });
    const result = await replaceConversionDefinitionUsages(db, {
      id: 'point-a', replacementId: 'point-stop', scope, expectedVersion: 1,
      replacementExpectedVersion: 1, staffId: 'staff-1',
    }).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: 'definition_stopped' });

    sqlite.prepare("UPDATE conversion_points SET status = 'active', stopped_at = NULL WHERE id = 'point-stop'").run();
    const replaced = await replaceConversionDefinitionUsages(db, {
      id: 'point-a', replacementId: 'point-stop', scope, expectedVersion: 1,
      replacementExpectedVersion: 1, staffId: 'staff-1',
    });
    expect(replaced).toMatchObject({ replacementId: 'point-stop', replacedUsageCount: 1, status: 'stopped' });
    expect(sqlite.prepare("SELECT conversion_point_id FROM conversion_definition_usages WHERE ref_id = 'scenario-1'").get())
      .toMatchObject({ conversion_point_id: 'point-stop' });
  });

  it('未使用・成果0件だけを物理削除し、使用中は停止する', async () => {
    await expect(deleteUnusedConversionDefinition(db, {
      id: 'point-a', scope, expectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'definition_in_use' });
    const stopped = await stopConversionDefinition(db, {
      id: 'point-a', scope, expectedVersion: 1, reason: '計測終了', staffId: 'staff-1',
    });
    expect(stopped).toMatchObject({ status: 'stopped', version: 2 });

    sqlite.prepare(`INSERT INTO conversion_points
      (id, name, event_type, value, line_account_id, status, stopped_at, created_at, updated_at)
      VALUES ('point-empty', '未使用', 'custom', NULL, 'account-a', 'active', NULL, '2026-09-01', '2026-09-01')`).run();
    const deleted = await deleteUnusedConversionDefinition(db, {
      id: 'point-empty', scope, expectedVersion: 1, staffId: 'staff-1',
    });
    expect(deleted).toEqual({ id: 'point-empty', deleted: true });
    expect(sqlite.prepare("SELECT id FROM conversion_points WHERE id = 'point-empty'").get()).toBeUndefined();
  });
});
