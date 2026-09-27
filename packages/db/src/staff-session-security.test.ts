import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminSessionFamiliarity,
  createAdminSession,
  getAdminSessionByTokenHash,
  markAdminSessionStepUp,
} from './staff.js';

const packageRoot = join(import.meta.dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, is_active) VALUES ('staff-1', 'One', 'admin', 'key-1', 1)`,
  ).run();
});

function seedSession(tokenHash: string, deviceHash: string | null, ipPrefix: string | null): void {
  sqlite.prepare(
    `INSERT INTO admin_sessions (token_hash, staff_id, expires_at, device_hash, ip_prefix)
     VALUES (?, 'staff-1', '2999-01-01T00:00:00.000Z', ?, ?)`,
  ).run(tokenHash, deviceHash, ipPrefix);
}

describe('adminSessionFamiliarity（V: いつもと違うログインの判定）', () => {
  it('初回ログインは比較対象が無いので unfamiliar にしない（hasBaseline が守る）', async () => {
    const result = await adminSessionFamiliarity(db, 'staff-1', { deviceHash: 'd1', ipPrefix: '203.0.113' });
    // 履歴が無いので場所の形跡も無いが、呼び出し側は hasBaseline=false で判定を止める。
    expect(result).toEqual({ hasBaseline: false, deviceKnown: true, ipKnown: false });
  });

  it('同じ端末・同じ場所の形跡があれば既知と返す', async () => {
    seedSession('h1', 'd1', '203.0.113');
    const result = await adminSessionFamiliarity(db, 'staff-1', { deviceHash: 'd1', ipPrefix: '203.0.113' });
    expect(result).toEqual({ hasBaseline: true, deviceKnown: true, ipKnown: true });
  });

  it('端末が違えば deviceKnown=false、場所が違えば ipKnown=false', async () => {
    seedSession('h1', 'd1', '203.0.113');
    const result = await adminSessionFamiliarity(db, 'staff-1', { deviceHash: 'd2', ipPrefix: '198.51.100' });
    expect(result.hasBaseline).toBe(true);
    expect(result.deviceKnown).toBe(false);
    expect(result.ipKnown).toBe(false);
  });

  it('導入前の行（device_hash 無し）だけの履歴では端末を断定しない', async () => {
    seedSession('h1', null, '203.0.113');
    const result = await adminSessionFamiliarity(db, 'staff-1', { deviceHash: 'd9', ipPrefix: '203.0.113' });
    expect(result).toEqual({ hasBaseline: true, deviceKnown: true, ipKnown: true });
  });

  it('他人のセッションは比較対象に入れない', async () => {
    sqlite.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, is_active) VALUES ('staff-2', 'Two', 'admin', 'key-2', 1)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO admin_sessions (token_hash, staff_id, expires_at, device_hash, ip_prefix)
       VALUES ('hx', 'staff-2', '2999-01-01T00:00:00.000Z', 'd1', '203.0.113')`,
    ).run();
    const result = await adminSessionFamiliarity(db, 'staff-1', { deviceHash: 'd1', ipPrefix: '203.0.113' });
    expect(result.hasBaseline).toBe(false);
  });
});

describe('markAdminSessionStepUp / getAdminSessionByTokenHash（V: 10分窓の刻印）', () => {
  it('再確認時刻を刻み、同じ行から読める', async () => {
    seedSession('h1', 'd1', '203.0.113');
    await markAdminSessionStepUp(db, 'h1', '2026-10-04T01:00:00.000Z');
    const session = await getAdminSessionByTokenHash(db, 'h1');
    expect(session?.step_up_at).toBe('2026-10-04T01:00:00.000Z');
    expect(session?.device_hash).toBe('d1');
    expect(session?.unfamiliar_at).toBeNull();
  });
});

describe('createAdminSession（V: 端末情報の保存）', () => {
  it('device_hash と unfamiliar_at を書ける', async () => {
    await createAdminSession(db, 'h1', 'staff-1', '2999-01-01T00:00:00.000Z', {
      userAgent: 'ua', ipPrefix: '203.0.113', deviceHash: 'd1', unfamiliarAt: '2026-10-04T00:00:00.000Z',
    });
    const session = await getAdminSessionByTokenHash(db, 'h1');
    expect(session?.device_hash).toBe('d1');
    expect(session?.unfamiliar_at).toBe('2026-10-04T00:00:00.000Z');
  });
});
