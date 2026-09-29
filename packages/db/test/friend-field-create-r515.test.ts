import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createFriendFieldIdempotent,
  getFriendFieldByIdForScope,
  updateFriendField,
} from '../src/friend-fields.js';

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

function countFields(sqlite: Database.Database, fieldKey: string): number {
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS c FROM friend_fields ff
       JOIN friend_field_scopes ffs ON ffs.field_id = ff.id
      WHERE ff.field_key = ? AND ffs.line_account_id = ?`,
  ).get(fieldKey, 'account-1') as { c: number };
  return Number(row.c);
}

/*
 * R515: 応答だけ失った再試行で、同じ友だち情報欄を二重に作らない。
 * 以前は要求キーが無く、同じ差し込み名の再送は409
 * 「その差し込み名は既に使われています」で止まり、作成済みへ戻れなかった。
 */
describe('R515 要求キー付きの友だち情報欄作成', () => {
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

  const input = { name: 'ペットの名前', fieldKey: 'pet_name', type: 'text' as const };

  it('同じキー・同じ内容の再送は保存済みを返し、2行にならない', async () => {
    const first = await createFriendFieldIdempotent(db, scope, input, 'key-1');
    expect(first.replayed).toBe(false);
    // 応答だけ失った想定でもう一度同じキー・同じ内容で送る。
    const second = await createFriendFieldIdempotent(db, scope, input, 'key-1');
    expect(second.replayed).toBe(true);
    expect(second.field.id).toBe(first.field.id);
    expect(countFields(sqlite, 'pet_name')).toBe(1);
  });

  it('同じキーに異なる内容は作らず止める', async () => {
    await createFriendFieldIdempotent(db, scope, input, 'key-2');
    await expect(createFriendFieldIdempotent(
      db, scope, { ...input, name: '別の名前' }, 'key-2',
    )).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect(countFields(sqlite, 'pet_name')).toBe(1);
  });

  it('R517の前提：版の違う更新は当てず、最新の版なら当たる', async () => {
    const created = await createFriendFieldIdempotent(db, scope, input, 'key-3');
    const stale = await updateFriendField(db, created.field.id, { name: '古い保存', expectedVersion: 999 });
    expect(stale).toBeNull();
    const current = await getFriendFieldByIdForScope(db, created.field.id, scope);
    expect(current?.name).toBe('ペットの名前');
    const fresh = await updateFriendField(db, created.field.id, { name: '新しい保存', expectedVersion: 1 });
    expect(fresh?.name).toBe('新しい保存');
  });
});
