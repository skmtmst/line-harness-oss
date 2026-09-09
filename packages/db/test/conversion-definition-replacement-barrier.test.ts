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
import { updateConversionPoint } from '../src/conversions.js';
import { asD1 } from './d1-test-helper.js';

/**
 * 置換先の事前確認とbatch実行のあいだで、別接続の要求を必ず割り込ませる関門。
 * 2接続の到着順を固定するため、最初のbatchの直前で1度だけ待ち合わせる。
 */
function asBarrierD1(sqlite: DatabaseType.Database, onBeforeFirstBatch: () => Promise<void>): D1Database {
  const base = asD1(sqlite) as unknown as {
    prepare: (query: string) => D1PreparedStatement;
    batch: <T>(statements: D1PreparedStatement[]) => Promise<T>;
  };
  let released = false;
  return {
    prepare: base.prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      if (!released) {
        released = true;
        await onBeforeFirstBatch();
      }
      return base.batch<T>(statements);
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

async function createPoint(db: DatabaseType.Database, name: string): Promise<string> {
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

function addUsage(db: DatabaseType.Database, pointId: string, refId: string): void {
  db.prepare(
    `INSERT INTO conversion_definition_usages
       (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id, created_by, created_at, updated_at)
     VALUES (?, ?, 1, 'acc-1', 'scenario', ?, 'staff-1', '2026-09-01', '2026-09-01')`,
  ).run(`usage-${pointId}-${refId}`, pointId, refId);
}

function usageRows(db: DatabaseType.Database): Array<{ id: string; point: string; version: number }> {
  return db.prepare(
    `SELECT id, conversion_point_id AS point, definition_version AS version
       FROM conversion_definition_usages ORDER BY id`,
  ).all() as Array<{ id: string; point: string; version: number }>;
}

function replaceOperations(db: DatabaseType.Database): number {
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM conversion_definition_operations WHERE action = 'replace'`,
  ).get() as { n: number }).n;
}

function pointState(db: DatabaseType.Database, id: string): { status: string; version: number } | undefined {
  return db.prepare('SELECT status, version FROM conversion_points WHERE id = ?').get(id) as
    | { status: string; version: number }
    | undefined;
}

describe('replaceは置換先の同時変更を旧地点のCASで弾く', () => {
  it('事前確認のあとに置換先が停止されたら、利用先もログも動かさない', async () => {
    const db = setup();
    const source = await createPoint(db, '地点A');
    const replacement = await createPoint(db, '地点B');
    addUsage(db, source, 'scenario-1');
    const before = usageRows(db);

    const d1 = asBarrierD1(db, async () => {
      await stopConversionDefinition(asD1(db), {
        id: replacement, scope: SCOPE, expectedVersion: 1, staffId: 'staff-2',
      });
    });

    await expect(replaceConversionDefinitionUsages(d1, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'replacement_conflict', status: 409 });

    expect(pointState(db, source)).toEqual({ status: 'active', version: 1 });
    expect(pointState(db, replacement)).toEqual({ status: 'stopped', version: 2 });
    expect(usageRows(db)).toEqual(before);
    expect(replaceOperations(db)).toBe(0);
  });

  it('事前確認のあとに置換先の版が上がったら、利用先を旧版へ移さない', async () => {
    const db = setup();
    const source = await createPoint(db, '地点A');
    const replacement = await createPoint(db, '地点B');
    addUsage(db, source, 'scenario-1');
    const before = usageRows(db);

    const d1 = asBarrierD1(db, async () => {
      await updateConversionPoint(asD1(db), replacement, { name: '地点B（改称）' }, { expectedVersion: 1 });
    });

    await expect(replaceConversionDefinitionUsages(d1, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'replacement_conflict', status: 409 });

    expect(pointState(db, source)).toEqual({ status: 'active', version: 1 });
    expect(pointState(db, replacement)).toEqual({ status: 'active', version: 2 });
    expect(usageRows(db)).toEqual(before);
    expect(replaceOperations(db)).toBe(0);
  });

  it('事前確認のあとに置換先が削除されたら、利用先を消えた地点へ移さない', async () => {
    const db = setup();
    const source = await createPoint(db, '地点A');
    const replacement = await createPoint(db, '地点B');
    addUsage(db, source, 'scenario-1');
    const before = usageRows(db);

    const d1 = asBarrierD1(db, async () => {
      await deleteUnusedConversionDefinition(asD1(db), {
        id: replacement, scope: SCOPE, expectedVersion: 1, staffId: 'staff-2',
      });
    });

    await expect(replaceConversionDefinitionUsages(d1, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'replacement_not_found', status: 409 });

    expect(pointState(db, source)).toEqual({ status: 'active', version: 1 });
    expect(pointState(db, replacement)).toBeUndefined();
    expect(usageRows(db)).toEqual(before);
    expect(replaceOperations(db)).toBe(0);
  });

  it('事前確認のあとに置換先のアカウントが変わったら、境界を越えて移さない', async () => {
    const db = setup();
    db.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('acc-2', 'channel-acc-2', 'Other Account', 'token', 'secret')`,
    ).run();
    const source = await createPoint(db, '地点A');
    const replacement = await createPoint(db, '地点B');
    addUsage(db, source, 'scenario-1');
    const before = usageRows(db);

    const d1 = asBarrierD1(db, async () => {
      await updateConversionPoint(asD1(db), replacement, { lineAccountId: 'acc-2' }, { expectedVersion: 1 });
    });

    await expect(replaceConversionDefinitionUsages(d1, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ status: 409 });

    expect(pointState(db, source)).toEqual({ status: 'active', version: 1 });
    expect(usageRows(db)).toEqual(before);
    expect(replaceOperations(db)).toBe(0);
  });

  it('関門が空振りなら従来どおり成功する（試験の前提が動く証拠）', async () => {
    const db = setup();
    const source = await createPoint(db, '地点A');
    const replacement = await createPoint(db, '地点B');
    addUsage(db, source, 'scenario-1');

    const d1 = asBarrierD1(db, async () => {});
    const done = await replaceConversionDefinitionUsages(d1, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    });

    expect(done).toMatchObject({ status: 'stopped', version: 2, replacementId: replacement });
    expect(pointState(db, source)).toEqual({ status: 'stopped', version: 2 });
    expect(usageRows(db)).toEqual([
      { id: `usage-${source}-scenario-1`, point: replacement, version: 1 },
    ]);
    expect(replaceOperations(db)).toBe(1);
  });
});
