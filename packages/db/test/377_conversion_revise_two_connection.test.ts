import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyConversionTestSchema } from './conversion-test-schema.js';
import {
  createConversionDefinition,
  reviseConversionDefinition,
  stopConversionDefinition,
} from '../src/conversion-definitions.js';

/*
 * 編集（新版化）の事前読込と書込みのあいだに、別接続が停止・編集を commit する
 * 競合を固定する（N-252）。
 *
 * 同じ接続で Promise.all を並べるだけでは、どちらが先に batch へ入るかが
 * await の数で決まってしまい、勝者が入れ替わる。ここは
 * `conversion-definition-replacement-two-connection.test.ts` と同じ作りにして、
 * WAL の実ファイルを2接続で共有し、**Aの batch 直前に B を必ず commit させる。**
 *
 * 見るのは「409 が返ったか」ではなく、**負けた側がDBに何も残していないか**。
 * 停止は版を上げるが利用先は動かさないので、負けた編集の利用先UPDATEは
 * 「利用先がまだ旧版にある」状態で走る。ここを止め損ねると、409 を返しながら
 * 利用先の版だけが進む。
 */

type Connections = { dir: string; path: string; a: DatabaseType.Database; b: DatabaseType.Database };
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
  db.pragma('busy_timeout = 5000');
  return db;
}

function setup(): Connections {
  const dir = mkdtempSync(join(tmpdir(), 'conv-revise-2conn-'));
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

function asWriteD1(sqlite: DatabaseType.Database): D1Database {
  type TestStatement = D1PreparedStatement & { runSync: () => D1Result<unknown> };
  function prepare(query: string): TestStatement {
    let params: unknown[] = [];
    const statement = {
      bind(...next: unknown[]) { params = next; return statement; },
      runSync() {
        const info = sqlite.prepare(query).run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as unknown as D1Result<unknown>;
      },
      async run<T>() { return statement.runSync() as T; },
      async all<T>() {
        return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() { return (sqlite.prepare(query).get(...params) as T | undefined) ?? null; },
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

/** 接続Aの事前読込が終わり、batch へ入る直前で1度だけ接続Bへ処理を渡す。 */
function withInterleave(sqlite: DatabaseType.Database, onBeforeCommit: () => Promise<void>): D1Database {
  const base = asWriteD1(sqlite) as unknown as {
    prepare: (query: string) => D1PreparedStatement;
    batch: <T>(statements: D1PreparedStatement[]) => Promise<T>;
  };
  let released = false;
  return {
    prepare: base.prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      if (!released) { released = true; await onBeforeCommit(); }
      return base.batch<T>(statements);
    },
  } as unknown as D1Database;
}

const SCOPE = { allowedAccountIds: ['acc-1'], includeUnassigned: false };

async function createPoint(sqlite: DatabaseType.Database, name: string): Promise<string> {
  const created = await createConversionDefinition(asWriteD1(sqlite), {
    name, sourceType: 'form_submitted', sourceConfig: {}, measureMethod: 'webhook',
    deduplicationMode: 'every', valueMode: 'fixed', fixedValue: 100, reversalPolicy: 'none',
    lineAccountId: 'acc-1', usages: [], staffId: 'staff-1',
  });
  return created!.id;
}

function addUsage(sqlite: DatabaseType.Database, pointId: string): string {
  const id = `usage-${pointId}`;
  sqlite.prepare(
    `INSERT INTO conversion_definition_usages
       (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id, created_by, created_at, updated_at)
     VALUES (?, ?, 1, 'acc-1', 'scenario', 'scenario-1', 'staff-1', '2026-09-01', '2026-09-01')`,
  ).run(id, pointId);
  return id;
}

function usageVersion(sqlite: DatabaseType.Database, pointId: string): number {
  return (sqlite.prepare('SELECT definition_version AS v FROM conversion_definition_usages WHERE conversion_point_id = ?')
    .get(pointId) as { v: number }).v;
}

function revisionCount(sqlite: DatabaseType.Database, pointId: string): number {
  return (sqlite.prepare('SELECT COUNT(*) AS n FROM conversion_definition_revisions WHERE conversion_point_id = ?')
    .get(pointId) as { n: number }).n;
}

function pointState(sqlite: DatabaseType.Database, id: string): { status: string; version: number; name: string } {
  return sqlite.prepare('SELECT status, version, name FROM conversion_points WHERE id = ?').get(id) as
    { status: string; version: number; name: string };
}

function revision(pointId: string, expectedVersion: number, name: string, staffId = 'staff-a') {
  return {
    id: pointId, scope: SCOPE, expectedVersion, staffId, name,
    sourceType: 'form_submitted', sourceConfig: {}, measureMethod: 'webhook' as const,
    deduplicationMode: 'every' as const, valueMode: 'fixed' as const, fixedValue: 500,
    reversalPolicy: 'none' as const,
  };
}

describe('編集の同時変更は独立2接続のcommit競合で弾かれる（N-252）', () => {
  it('事前読込のあと接続Bが停止をcommitすると、Aは利用先も監査も残さない', async () => {
    const { a, b } = setup();
    const point = await createPoint(a, '地点A');
    addUsage(a, point);

    const dbA = withInterleave(a, async () => {
      await stopConversionDefinition(asWriteD1(b), {
        id: point, scope: SCOPE, expectedVersion: 1, staffId: 'staff-b',
      });
    });

    await expect(reviseConversionDefinition(dbA, revision(point, 1, 'Aが付けた名前')))
      .rejects.toMatchObject({ code: 'version_conflict', status: 409 });

    const state = pointState(a, point);
    expect(state.status).toBe('stopped');
    expect(state.version).toBe(2);
    // Aの編集は通っていない。名前も設定も動かない。
    expect(state.name).toBe('地点A');
    // 負けた編集は監査を残さない。
    expect(revisionCount(a, point)).toBe(0);
    // **利用先の版だけが進む、をここで捕まえる。**
    expect(usageVersion(a, point)).toBe(1);
  });

  it('事前読込のあと接続Bが別の編集をcommitすると、Aは二重に版を進めない', async () => {
    const { a, b } = setup();
    const point = await createPoint(a, '地点A');
    addUsage(a, point);

    const dbA = withInterleave(a, async () => {
      await reviseConversionDefinition(asWriteD1(b), revision(point, 1, 'Bが付けた名前', 'staff-b'));
    });

    await expect(reviseConversionDefinition(dbA, revision(point, 1, 'Aが付けた名前')))
      .rejects.toMatchObject({ code: 'version_conflict', status: 409 });

    const state = pointState(a, point);
    // 版は1つしか進まない。後勝ちで上書きしない。
    expect(state.version).toBe(2);
    expect(state.name).toBe('Bが付けた名前');
    // 監査はBの1件だけ。
    expect(revisionCount(a, point)).toBe(1);
    const rev = a.prepare('SELECT performed_by, to_version FROM conversion_definition_revisions WHERE conversion_point_id = ?')
      .get(point) as { performed_by: string; to_version: number };
    // 残っている監査はBのもの。Aの監査（staff-a）は1件も無い。
    expect(rev.performed_by).toBe('staff-b');
    expect(rev.to_version).toBe(2);
    // 利用先はBの版に付いており、二重に進んでいない。
    expect(usageVersion(a, point)).toBe(2);
  });
});
