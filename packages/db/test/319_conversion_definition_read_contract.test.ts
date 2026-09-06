import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addConversionDefinitionUsage,
  getConversionDefinitionDetail,
  getConversionDefinitionReport,
  listConversionDefinitions,
} from '../src/conversion-definitions.js';
import { asD1 } from './d1-test-helper.js';

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '319_conversion_definition_read_contract.sql'),
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
      value_snapshot REAL, attributed_ref_code TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO line_accounts (id) VALUES ('account-a'), ('account-b');
    INSERT INTO conversion_points
      (id, name, event_type, value, line_account_id, status, stopped_at, created_at, updated_at)
    VALUES
      ('point-a', '購入完了', 'purchase', 5000, 'account-a', 'active', NULL, '2026-08-01', '2026-09-02'),
      ('point-stop', '資料請求', 'form', NULL, 'account-a', 'stopped', '2026-09-01', '2026-08-02', '2026-09-01'),
      ('point-b', '担当外', 'purchase', 3000, 'account-b', 'active', NULL, '2026-08-03', '2026-09-03');
    INSERT INTO conversion_events (id, conversion_point_id, value_snapshot, attributed_ref_code, created_at)
    VALUES
      ('event-current-1', 'point-a', 5000, 'route-a', '2026-09-02 10:00:00'),
      ('event-current-2', 'point-a', 6000, NULL, '2026-09-03 10:00:00'),
      ('event-previous', 'point-a', 4000, 'route-a', '2026-08-30 10:00:00'),
      ('event-hidden', 'point-b', 3000, 'route-b', '2026-09-02 10:00:00');
  `);
  sqlite.exec(migration);
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
});
