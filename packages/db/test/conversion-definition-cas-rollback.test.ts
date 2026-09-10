import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import { applyConversionTestSchema } from './conversion-test-schema.js';
import {
  createConversionDefinition,
  deleteUnusedConversionDefinition,
  replaceConversionDefinitionUsages,
  stopConversionDefinition,
} from '../src/conversion-definitions.js';
import { asD1 } from './d1-test-helper.js';

/** Cloudflare D1 batchの「1文失敗で全体rollback」を再現し、指定文を故障注入する。 */
function asAtomicD1(sqlite: DatabaseType.Database, failSql?: RegExp): D1Database {
  type TestStatement = D1PreparedStatement & { runSync: () => D1Result<unknown> };
  function prepare(query: string): TestStatement {
    let params: unknown[] = [];
    const statement = {
      bind(...next: unknown[]) {
        params = next;
        return statement;
      },
      runSync() {
        if (failSql?.test(query)) throw new Error(`injected statement failure: ${query.trim().slice(0, 40)}`);
        const info = sqlite.prepare(query).run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as unknown as D1Result<unknown>;
      },
      async run<T>() { return statement.runSync() as T; },
      async all<T>() {
        return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (sqlite.prepare(query).get(...params) as T | undefined) ?? null;
      },
      raw: async () => [],
    } as unknown as TestStatement;
    return statement;
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = sqlite.transaction(() =>
        statements.map((statement) => (statement as TestStatement).runSync()))();
      return results as T;
    },
  } as unknown as D1Database;
}

function setup(): DatabaseType.Database {
  const db = new Database(':memory:');
  applyConversionTestSchema(db);
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
  it('stopの競合は利用先もログも変えない', async () => {
    const db = setup();
    const d1 = asAtomicD1(db);
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
    const d1 = asAtomicD1(db);
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
    const d1 = asAtomicD1(db);
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
    const d1 = asAtomicD1(db);
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
    const d1 = asAtomicD1(db);
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
    const d1 = asAtomicD1(db);
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

describe('定義操作は後続文の失敗時にCASも含めてrollbackする', () => {
  it('stopのログ失敗で停止と版を戻す', async () => {
    const db = setup();
    const id = await createPoint(db, '地点A');
    await expect(stopConversionDefinition(asAtomicD1(db, /INSERT INTO conversion_definition_operations/), {
      id, scope: SCOPE, expectedVersion: 1, staffId: 'staff-1',
    })).rejects.toThrow('injected statement failure');
    expect(pointState(db, id)).toEqual({ status: 'active', version: 1 });
    expect(operationCount(db)).toBe(0);
  });

  it.each([
    ['重複利用先の整理', /DELETE FROM conversion_definition_usages/],
    ['利用先の移動', /UPDATE conversion_definition_usages/],
    ['操作ログ', /INSERT INTO conversion_definition_operations/],
  ])('replaceの%s失敗で停止・利用先・ログをすべて戻す', async (_label, failSql) => {
    const db = setup();
    const source = await createPoint(db, '地点A');
    const replacement = await createPoint(db, '地点B');
    addUsage(db, source, 'scenario-1');
    await expect(replaceConversionDefinitionUsages(asAtomicD1(db, failSql), {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toThrow('injected statement failure');
    expect(pointState(db, source)).toEqual({ status: 'active', version: 1 });
    expect(usagePointIds(db)).toEqual([source]);
    expect(operationCount(db)).toBe(0);
  });

  it('deleteのログ失敗で削除を戻す', async () => {
    const db = setup();
    const id = await createPoint(db, '地点A');
    await expect(deleteUnusedConversionDefinition(asAtomicD1(db, /INSERT INTO conversion_definition_operations/), {
      id, scope: SCOPE, expectedVersion: 1, staffId: 'staff-1',
    })).rejects.toThrow('injected statement failure');
    expect(pointState(db, id)).toEqual({ status: 'active', version: 1 });
    expect(operationCount(db)).toBe(0);
  });
});
