import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyConversionTestSchema } from './conversion-test-schema.js';
import {
  createConversionDefinition,
  deleteUnusedConversionDefinition,
  replaceConversionDefinitionUsages,
  stopConversionDefinition,
} from '../src/conversion-definitions.js';
import { updateConversionPoint } from '../src/conversions.js';

/*
 * 置換処理の事前読込と書込みのあいだに、別接続が置換先をstop/update/deleteして
 * commitする競合を固定する。
 *
 * 単一接続のcallback順序検査では、同じ接続が同じ状態を見ているだけで、
 * D1の「読みは接続Aのsnapshot、書きは別transaction」という境界を越えていない。
 * ここではWALのfile-backed DBを実ファイルへ置き、接続A（置換を実行する側）と
 * 接続B（割り込む側）を別々に開く。BのcommitはOSのWALを通してAへ届くため、
 * Aのbatchがそれを読み直して落ちることを、接続をまたいで証明できる。
 */

type Connections = {
  dir: string;
  path: string;
  a: DatabaseType.Database;
  b: DatabaseType.Database;
};

const open: Connections[] = [];

afterEach(() => {
  for (const conn of open.splice(0)) {
    conn.a.close();
    conn.b.close();
    rmSync(conn.dir, { recursive: true, force: true });
  }
});

function connect(path: string): DatabaseType.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  // 相手のcommit待ちでSQLITE_BUSYを即時に返さない。実D1と同じく待ってから読む。
  db.pragma('busy_timeout = 5000');
  return db;
}

function setup(): Connections {
  const dir = mkdtempSync(join(tmpdir(), 'conv-2conn-'));
  const path = join(dir, 'conversions.sqlite');
  const a = connect(path);
  applyConversionTestSchema(a);
  a.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('acc-1', 'channel-acc-1', 'Test Account', 'token', 'secret')`,
  ).run();
  const b = connect(path);
  const conn: Connections = { dir, path, a, b };
  open.push(conn);
  return conn;
}

/**
 * D1のbatchは書込みtransaction。BEGIN IMMEDIATEで書込みlockを取り、
 * その時点でcommit済みの内容を読んだうえで1文目のCASを評価する。
 */
function asWriteD1(sqlite: DatabaseType.Database, seen?: Array<Record<string, unknown>>): D1Database {
  type TestStatement = D1PreparedStatement & { runSync: () => D1Result<unknown> };
  function prepare(query: string): TestStatement {
    let params: unknown[] = [];
    const statement = {
      bind(...next: unknown[]) {
        params = next;
        return statement;
      },
      runSync() {
        const info = sqlite.prepare(query).run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as unknown as D1Result<unknown>;
      },
      async run<T>() { return statement.runSync() as T; },
      async all<T>() {
        return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        const row = (sqlite.prepare(query).get(...params) as T | undefined) ?? null;
        // 事前読込がBのcommitより前だったことを後から突き合わせるため記録する。
        if (seen && row && typeof row === 'object') seen.push(row as Record<string, unknown>);
        return row;
      },
      raw: async () => [],
    } as unknown as TestStatement;
    return statement;
  }
  return {
    prepare,
    batch<T>(statements: D1PreparedStatement[]) {
      const run = sqlite.transaction(() => statements.map((s) => (s as TestStatement).runSync()));
      return Promise.resolve(run.immediate() as T);
    },
  } as unknown as D1Database;
}

/** 接続Aの事前読込が終わり、batchへ入る直前で1度だけ接続Bへ処理を渡す。 */
function withInterleave(
  sqlite: DatabaseType.Database,
  seen: Array<Record<string, unknown>>,
  onBeforeCommit: () => Promise<void>,
): D1Database {
  const base = asWriteD1(sqlite, seen) as unknown as {
    prepare: (query: string) => D1PreparedStatement;
    batch: <T>(statements: D1PreparedStatement[]) => Promise<T>;
  };
  let released = false;
  return {
    prepare: base.prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      if (!released) {
        released = true;
        await onBeforeCommit();
      }
      return base.batch<T>(statements);
    },
  } as unknown as D1Database;
}

const SCOPE = { allowedAccountIds: ['acc-1'], includeUnassigned: false };

async function createPoint(sqlite: DatabaseType.Database, name: string): Promise<string> {
  const created = await createConversionDefinition(asWriteD1(sqlite), {
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

function addUsage(sqlite: DatabaseType.Database, pointId: string, refId: string): void {
  sqlite.prepare(
    `INSERT INTO conversion_definition_usages
       (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id, created_by, created_at, updated_at)
     VALUES (?, ?, 1, 'acc-1', 'scenario', ?, 'staff-1', '2026-09-01', '2026-09-01')`,
  ).run(`usage-${pointId}-${refId}`, pointId, refId);
}

function usageRows(sqlite: DatabaseType.Database): Array<{ id: string; point: string; version: number }> {
  return sqlite.prepare(
    `SELECT id, conversion_point_id AS point, definition_version AS version
       FROM conversion_definition_usages ORDER BY id`,
  ).all() as Array<{ id: string; point: string; version: number }>;
}

function replaceOperations(sqlite: DatabaseType.Database): number {
  return (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM conversion_definition_operations WHERE action = 'replace'`,
  ).get() as { n: number }).n;
}

function pointState(sqlite: DatabaseType.Database, id: string): { status: string; version: number } | undefined {
  return sqlite.prepare('SELECT status, version FROM conversion_points WHERE id = ?').get(id) as
    | { status: string; version: number }
    | undefined;
}

/** 接続Aが事前読込で「稼働中・版1」の置換先を見ていたことを確かめる。 */
function sawActiveReplacement(seen: Array<Record<string, unknown>>, replacementId: string): boolean {
  return seen.some((row) => row.id === replacementId && row.status === 'active' && Number(row.version) === 1);
}

describe('置換先の同時変更は独立2接続のcommit競合で弾かれる', () => {
  it('2つの接続は同じWALファイルを共有し、互いのcommitが見える', () => {
    const { a, b, path } = setup();
    expect(a.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(b.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(a.name).toBe(path);
    expect(b.name).toBe(path);
    expect(a).not.toBe(b);
    // Aのcommitが接続Bから見えることを確かめる（試験の前提）。
    a.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('acc-probe', 'channel-probe', 'Probe', 'token', 'secret')`,
    ).run();
    expect(b.prepare('SELECT id FROM line_accounts WHERE id = ?').get('acc-probe')).toEqual({ id: 'acc-probe' });
  });

  it('事前読込のあと接続Bが置換先を停止commitすると、Aは利用先もログも残さない', async () => {
    const { a, b } = setup();
    const source = await createPoint(a, '地点A');
    const replacement = await createPoint(a, '地点B');
    addUsage(a, source, 'scenario-1');
    const before = usageRows(b);
    const seen: Array<Record<string, unknown>> = [];

    const connectionA = withInterleave(a, seen, async () => {
      await stopConversionDefinition(asWriteD1(b), {
        id: replacement, scope: SCOPE, expectedVersion: 1, staffId: 'staff-2',
      });
      // 割り込みが確かにcommitされ、接続Aからも見えることを競合の前に固定する。
      expect(pointState(b, replacement)).toEqual({ status: 'stopped', version: 2 });
      expect(pointState(a, replacement)).toEqual({ status: 'stopped', version: 2 });
    });

    await expect(replaceConversionDefinitionUsages(connectionA, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'replacement_conflict', status: 409 });

    expect(sawActiveReplacement(seen, replacement)).toBe(true);
    // 副作用ゼロは、書いた本人ではなく接続Bから読んで確かめる。
    expect(pointState(b, source)).toEqual({ status: 'active', version: 1 });
    expect(pointState(b, replacement)).toEqual({ status: 'stopped', version: 2 });
    expect(usageRows(b)).toEqual(before);
    expect(replaceOperations(b)).toBe(0);
  });

  it('事前読込のあと接続Bが置換先の版を上げcommitすると、Aは旧版へ移さない', async () => {
    const { a, b } = setup();
    const source = await createPoint(a, '地点A');
    const replacement = await createPoint(a, '地点B');
    addUsage(a, source, 'scenario-1');
    const before = usageRows(b);
    const seen: Array<Record<string, unknown>> = [];

    const connectionA = withInterleave(a, seen, async () => {
      await updateConversionPoint(asWriteD1(b), replacement, { name: '地点B（改称）' }, { expectedVersion: 1 });
      expect(pointState(a, replacement)).toEqual({ status: 'active', version: 2 });
    });

    await expect(replaceConversionDefinitionUsages(connectionA, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'replacement_conflict', status: 409 });

    expect(sawActiveReplacement(seen, replacement)).toBe(true);
    expect(pointState(b, source)).toEqual({ status: 'active', version: 1 });
    expect(pointState(b, replacement)).toEqual({ status: 'active', version: 2 });
    expect(usageRows(b)).toEqual(before);
    expect(replaceOperations(b)).toBe(0);
  });

  it('事前読込のあと接続Bが置換先を削除commitすると、Aは消えた地点へ移さない', async () => {
    const { a, b } = setup();
    const source = await createPoint(a, '地点A');
    const replacement = await createPoint(a, '地点B');
    addUsage(a, source, 'scenario-1');
    const before = usageRows(b);
    const seen: Array<Record<string, unknown>> = [];

    const connectionA = withInterleave(a, seen, async () => {
      await deleteUnusedConversionDefinition(asWriteD1(b), {
        id: replacement, scope: SCOPE, expectedVersion: 1, staffId: 'staff-2',
      });
      expect(pointState(a, replacement)).toBeUndefined();
    });

    await expect(replaceConversionDefinitionUsages(connectionA, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ code: 'replacement_not_found', status: 409 });

    expect(sawActiveReplacement(seen, replacement)).toBe(true);
    expect(pointState(b, source)).toEqual({ status: 'active', version: 1 });
    expect(pointState(b, replacement)).toBeUndefined();
    expect(usageRows(b)).toEqual(before);
    expect(replaceOperations(b)).toBe(0);
  });

  it('事前読込のあと接続Bが置換先のアカウントを移しcommitすると、境界を越えない', async () => {
    const { a, b } = setup();
    a.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('acc-2', 'channel-acc-2', 'Other Account', 'token', 'secret')`,
    ).run();
    const source = await createPoint(a, '地点A');
    const replacement = await createPoint(a, '地点B');
    addUsage(a, source, 'scenario-1');
    const before = usageRows(b);
    const seen: Array<Record<string, unknown>> = [];

    const connectionA = withInterleave(a, seen, async () => {
      await updateConversionPoint(asWriteD1(b), replacement, { lineAccountId: 'acc-2' }, { expectedVersion: 1 });
    });

    await expect(replaceConversionDefinitionUsages(connectionA, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    })).rejects.toMatchObject({ status: 409 });

    expect(sawActiveReplacement(seen, replacement)).toBe(true);
    expect(pointState(b, source)).toEqual({ status: 'active', version: 1 });
    expect(usageRows(b)).toEqual(before);
    expect(replaceOperations(b)).toBe(0);
  });

  it('接続Aが先にcommitしたら、あとから来た接続Bの置換先削除が利用ありで止まる', async () => {
    const { a, b } = setup();
    const source = await createPoint(a, '地点A');
    const replacement = await createPoint(a, '地点B');
    addUsage(a, source, 'scenario-1');

    const done = await replaceConversionDefinitionUsages(asWriteD1(a), {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    });
    expect(done).toMatchObject({ status: 'stopped', version: 2, replacementId: replacement });

    // 逆順。Aのcommitは接続Bから見えるので、置換先はもう未使用ではない。
    await expect(deleteUnusedConversionDefinition(asWriteD1(b), {
      id: replacement, scope: SCOPE, expectedVersion: 1, staffId: 'staff-2',
    })).rejects.toMatchObject({ code: 'definition_in_use', status: 409 });

    expect(pointState(b, replacement)).toEqual({ status: 'active', version: 1 });
    expect(usageRows(b)).toEqual([
      { id: `usage-${source}-scenario-1`, point: replacement, version: 1 },
    ]);
    expect(replaceOperations(b)).toBe(1);
  });

  it('割り込みが無ければ従来どおり成功する（試験の前提が動く証拠）', async () => {
    const { a, b } = setup();
    const source = await createPoint(a, '地点A');
    const replacement = await createPoint(a, '地点B');
    addUsage(a, source, 'scenario-1');
    const seen: Array<Record<string, unknown>> = [];

    const connectionA = withInterleave(a, seen, async () => {});
    const done = await replaceConversionDefinitionUsages(connectionA, {
      id: source, replacementId: replacement, scope: SCOPE,
      expectedVersion: 1, replacementExpectedVersion: 1, staffId: 'staff-1',
    });

    expect(done).toMatchObject({ status: 'stopped', version: 2, replacementId: replacement });
    expect(pointState(b, source)).toEqual({ status: 'stopped', version: 2 });
    expect(usageRows(b)).toEqual([
      { id: `usage-${source}-scenario-1`, point: replacement, version: 1 },
    ]);
    expect(replaceOperations(b)).toBe(1);
  });
});
