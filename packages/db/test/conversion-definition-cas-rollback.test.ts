import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createConversionDefinition,
  deleteUnusedConversionDefinition,
  replaceConversionDefinitionUsages,
  stopConversionDefinition,
} from '../src/conversion-definitions.js';
import { asD1 } from './d1-test-helper.js';

/**
 * 実D1相当の適合器。D1 の batch は失敗時に巻き戻さないため、
 * 共通の試験helper(まとめて巻き戻す)ではなく1文ずつ実行する。
 * 版不一致で副作用が残る実装は、この適合器で必ず落ちる。
 */
function asNonAtomicD1(sqlite: DatabaseType.Database): D1Database {
  const d1 = asD1(sqlite);
  async function batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]> {
    const results: D1Result<unknown>[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
  return {
    prepare: (...args: Parameters<D1Database['prepare']>) => d1.prepare(...args),
    batch: batch as unknown as D1Database['batch'],
  } as unknown as D1Database;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

function setup(): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(join(PKG_ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    execSafe(db, readFileSync(join(PKG_ROOT, 'migrations', file), 'utf8'));
  }
  db.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('acc-1', 'channel-acc-1', 'Test Account', 'token', 'secret')`,
  ).run();
  return db;
}

const SCOPE = { allowedAccountIds: ['acc-1'], includeUnassigned: false };

async function createPoint(db: Database.Database, name: string): Promise<string> {
  const created = await createConversionDefinition(asD1(db), {
    name,
    sourceType: 'form_submitted',
    sourceConfig: {},
    measureMethod: 'webhook',
    deduplicationMode: 'every',
    valueMode: 'none',
    reversalPolicy: 'none',
    lineAccountId: 'acc-1',
    usages: [],
    staffId: 'staff-1',
  });
  return created!.id;
}

function addUsage(db: Database.Database, pointId: string, refId: string): void {
  db.prepare(
    `INSERT INTO conversion_definition_usages
       (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id, created_by, created_at, updated_at)
     VALUES (?, ?, 1, 'acc-1', 'scenario', ?, 'staff-1', '2026-09-01', '2026-09-01')`,
  ).run(`usage-${pointId}-${refId}`, pointId, refId);
}

function usagePointIds(db: Database.Database): string[] {
  return (db.prepare('SELECT conversion_point_id AS id FROM conversion_definition_usages').all() as Array<{ id: string }>)
    .map((r) => r.id);
}

function operationCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM conversion_definition_operations').get() as { n: number }).n;
}

function pointState(db: Database.Database, id: string): { status: string; version: number } {
  return db.prepare('SELECT status, version FROM conversion_points WHERE id = ?').get(id) as {
    status: string; version: number;
  };
}

describe('定義操作のCAS不一致は副作用なし', () => {
  it('試験台自体がbatchを巻き戻さないことの校正', async () => {
    const db = setup();
    const d1 = asNonAtomicD1(db);
    await expect(d1.batch([
      d1.prepare(`INSERT INTO conversion_definition_operations
        (id, conversion_point_id, action, affected_usages, performed_by, created_at)
        VALUES ('op-1', 'missing', 'stop', 0, 's', 't')`),
      d1.prepare(`INSERT INTO conversion_definition_operations (id) VALUES ('op-1')`),
    ])).rejects.toThrow();
    // 巻き戻らない適合器なら最初の1文が残る。旧実装(CAS後に副作用)の
    // 残存を検出できる試験台であることの証拠。
    expect(operationCount(db)).toBe(1);
  });

  it('stopの競合は利用先もログも変えない', async () => {
    const db = setup();
    const d1 = asNonAtomicD1(db);
    const id = await createPoint(db, '地点A');
    addUsage(db, id, 'scenario-1');
    await expect(stopConversionDefinition(d1, {
      id, scope: SCOPE, expectedVersion: 99, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'version_conflict' });
    expect(pointState(db, id)).toEqual({ status: 'active', version: 1 });
    expect(usagePointIds(db)).toEqual([id]);
    expect(operationCount(db)).toBe(0);
    // 正しい版なら止まり、ログが1件残る(試験の前提が動く証拠)。
    const stopped = await stopConversionDefinition(d1, {
      id, scope: SCOPE, expectedVersion: 1, staffId: 'staff-1',
    });
    expect(stopped).toMatchObject({ status: 'stopped', version: 2 });
    expect(operationCount(db)).toBe(1);
  });

  it('replaceの競合は利用先の移動もログもしない', async () => {
    const db = setup();
    const d1 = asNonAtomicD1(db);
    const source = await createPoint(db, '地点A');
    const replacement = await createPoint(db, '地点B');
    addUsage(db, source, 'scenario-1');
    await expect(replaceConversionDefinitionUsages(d1, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 99, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'version_conflict' });
    expect(pointState(db, source)).toEqual({ status: 'active', version: 1 });
    expect(usagePointIds(db)).toEqual([source]);
    expect(operationCount(db)).toBe(0);
    // 正しい版なら利用先が移り、旧版が止まる。
    const done = await replaceConversionDefinitionUsages(d1, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    });
    expect(done).toMatchObject({ status: 'stopped', version: 2 });
    expect(usagePointIds(db)).toEqual([replacement]);
    expect(operationCount(db)).toBe(1);
  });

  it('deleteの競合は削除もログもしない', async () => {
    const db = setup();
    const d1 = asNonAtomicD1(db);
    const id = await createPoint(db, '地点A');
    await expect(deleteUnusedConversionDefinition(d1, {
      id, scope: SCOPE, expectedVersion: 99, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'version_conflict' });
    expect(pointState(db, id)).toEqual({ status: 'active', version: 1 });
    expect(operationCount(db)).toBe(0);
    const done = await deleteUnusedConversionDefinition(d1, {
      id, scope: SCOPE, expectedVersion: 1, staffId: 'staff-1',
    });
    expect(done).toEqual({ id, deleted: true });
    expect(operationCount(db)).toBe(1);
  });
});

describe('定義操作の同時二重実行は勝者だけが副作用を残す', () => {
  it('stopの同時実行はログ1件だけ', async () => {
    const db = setup();
    const d1 = asNonAtomicD1(db);
    const id = await createPoint(db, '地点A');
    const settled = await Promise.allSettled([
      stopConversionDefinition(d1, { id, scope: SCOPE, expectedVersion: 1, staffId: 'staff-1' }),
      stopConversionDefinition(d1, { id, scope: SCOPE, expectedVersion: 1, staffId: 'staff-1' }),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(pointState(db, id)).toEqual({ status: 'stopped', version: 2 });
    expect(operationCount(db)).toBe(1);
  });

  it('replaceの同時実行は利用先1回移動・ログ1件だけ', async () => {
    const db = setup();
    const d1 = asNonAtomicD1(db);
    const source = await createPoint(db, '地点A');
    const replacement = await createPoint(db, '地点B');
    addUsage(db, source, 'scenario-1');
    const settled = await Promise.allSettled([
      replaceConversionDefinitionUsages(d1, {
        id: source, replacementId: replacement, scope: SCOPE,
        expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
      }),
      replaceConversionDefinitionUsages(d1, {
        id: source, replacementId: replacement, scope: SCOPE,
        expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
      }),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(pointState(db, source)).toEqual({ status: 'stopped', version: 2 });
    expect(usagePointIds(db)).toEqual([replacement]);
    expect(operationCount(db)).toBe(1);
  });

  it('deleteの同時実行はログ1件だけ', async () => {
    const db = setup();
    const d1 = asNonAtomicD1(db);
    const id = await createPoint(db, '地点A');
    const settled = await Promise.allSettled([
      deleteUnusedConversionDefinition(d1, { id, scope: SCOPE, expectedVersion: 1, staffId: 'staff-1' }),
      deleteUnusedConversionDefinition(d1, { id, scope: SCOPE, expectedVersion: 1, staffId: 'staff-1' }),
    ]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(operationCount(db)).toBe(1);
  });
});
