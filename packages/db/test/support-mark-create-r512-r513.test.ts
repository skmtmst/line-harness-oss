import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSupportMarkIdempotent,
  getSupportMarkById,
  updateSupportMark,
} from '../src/support-marks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_TENANT_ID = '00000000-0000-4000-8000-000000000001';

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      async batch<T>(batchStatements: D1PreparedStatement[]) {
        return batchStatements as unknown as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  const db = { prepare } as unknown as D1Database & {
    batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
  };
  // better-sqlite3 には batch が無いため、文を順に実行する。
  db.batch = async (statements: D1PreparedStatement[]) => {
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await (statement as unknown as { run(): Promise<unknown> }).run());
    }
    return results;
  };
  return db;
}

const scope = { tenantId: LEGACY_TENANT_ID, lineAccountId: 'account-1' };

function countMarks(sqlite: Database.Database, name: string): number {
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS c FROM support_marks sm
       JOIN support_mark_scopes sms ON sms.mark_id = sm.id
      WHERE sm.name = ? AND sm.archived_at IS NULL AND sms.line_account_id = ?`,
  ).get(name, 'account-1') as { c: number };
  return Number(row.c);
}

/*
 * R512: 応答だけ失った再試行で、同じ対応マークを二重に作らない。
 * 以前は要求キーが無く、同じ内容を2回送ると別IDの同名マークが2行残った。
 */
describe('R512 要求キー付きの対応マーク作成', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  const input = { name: '要確認', color: '#EF4B55', displayOrder: 4 };

  it('同じキー・同じ内容の再送は保存済みを返し、2行にならない', async () => {
    const first = await createSupportMarkIdempotent(db, scope, input, 'u-1', [], 'key-1');
    expect(first.replayed).toBe(false);
    // 応答だけ失った想定でもう一度同じキー・同じ内容で送る。
    const second = await createSupportMarkIdempotent(db, scope, input, 'u-1', [], 'key-1');
    expect(second.replayed).toBe(true);
    expect(second.mark.id).toBe(first.mark.id);
    expect(countMarks(sqlite, '要確認')).toBe(1);
  });

  it('同じキーに異なる内容は作らず止める', async () => {
    await createSupportMarkIdempotent(db, scope, input, 'u-1', [], 'key-2');
    await expect(createSupportMarkIdempotent(
      db, scope, { ...input, color: '#2563D4' }, 'u-1', [], 'key-2',
    )).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect(countMarks(sqlite, '要確認')).toBe(1);
  });

  it('キーが違えば同じ内容でも別々に作る', async () => {
    await createSupportMarkIdempotent(db, scope, input, 'u-1', [], 'key-3a');
    await createSupportMarkIdempotent(db, scope, input, 'u-1', [], 'key-3b');
    expect(countMarks(sqlite, '要確認')).toBe(2);
  });
});

/*
 * R513: 古い画面からの保存が、別の担当者の変更を無警告で上書きしない。
 * 以前は版の照合が無く、古い入力がそのまま版を上げて成功していた。
 */
describe('R513 版照合つきの対応マーク編集', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '本店', 'token', 'secret');
      INSERT INTO support_marks (id, name, color, is_default, display_order, version)
      VALUES ('mark-1', '要確認', '#EF4B55', 0, 4, 1);
      INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
      VALUES ('mark-1', '${LEGACY_TENANT_ID}', 'account-1', '2026-09-27T00:00:00+09:00');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('古い版の保存は止めて、相手の変更を残す', async () => {
    // B が名前を変えて保存する（版1→2）。
    const afterB = await updateSupportMark(db, 'mark-1', scope, { name: 'Bの名前' });
    expect(afterB !== null && afterB !== 'conflict' ? afterB.version : null).toBe(2);
    // A は古い画面（版1）のまま色だけ変えて保存する。
    const result = await updateSupportMark(db, 'mark-1', scope, { color: '#2563D4', expectedVersion: 1 });
    expect(result).toBe('conflict');
    const current = await getSupportMarkById(db, 'mark-1', scope);
    expect(current?.name).toBe('Bの名前');
    expect(current?.color).toBe('#EF4B55');
  });

  it('最新の版なら保存でき、版が上がる', async () => {
    await updateSupportMark(db, 'mark-1', scope, { name: 'Bの名前' });
    const result = await updateSupportMark(
      db, 'mark-1', scope, { name: 'Aの名前', color: '#2563D4', expectedVersion: 2 },
    );
    expect(result !== null && result !== 'conflict' ? result.version : null).toBe(3);
    expect(result !== null && result !== 'conflict' ? result.name : null).toBe('Aの名前');
  });

  it('版を送らない古い呼び出しは従来どおり保存する', async () => {
    const result = await updateSupportMark(db, 'mark-1', scope, { name: '旧来の保存' });
    expect(result !== null && result !== 'conflict' ? result.name : null).toBe('旧来の保存');
  });
});
