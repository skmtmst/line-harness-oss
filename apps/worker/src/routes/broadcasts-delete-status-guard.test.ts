import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';
import { broadcasts } from './broadcasts.js';
import { deleteBroadcast } from '@line-crm/db';

/**
 * D026: 送信中・送信済みの配信を DELETE /api/broadcasts/:id で消せないこと。
 *
 * 実 route + 実 DB モジュール + メモリ SQLite。D1 本番は外部キー制約を
 * 強制するため、ここでも `foreign_keys = ON` にして CASCADE の巻き添え
 * （broadcast_send_claims の請求行が一緒に消える）を再現できるようにする。
 * 画面は draft/scheduled にしか削除を出さないが、API 直接の削除も
 * status で断つ。下書き・予約の削除は従来どおり 200。
 */

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (sql: string, params: unknown[]) => ({
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>() => ({ success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} }),
    run: async <T>() => {
      const info = sqlite.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: info.changes } } as T;
    },
    raw: async () => [],
  });
  return {
    prepare: (sql: string) => {
      const bound = (params: unknown[]): D1PreparedStatement => ({
        bind: (...next: unknown[]) => bound(next),
        ...wrap(sql, params),
      } as unknown as D1PreparedStatement);
      return bound([]);
    },
    async batch<T>(statements: D1PreparedStatement[]) {
      const results = [];
      sqlite.exec('BEGIN');
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return results as T;
    },
  } as unknown as D1Database;
}

const TENANT_ID = '00000000-0000-4000-8000-000000000001';

function seed(sqlite: Database.Database) {
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES ('acc-1', 'channel-acc-1', '本店', 'token', 'secret', ?)`,
  ).run(TENANT_ID);
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, line_account_id, is_following)
     VALUES ('f-1', 'U-f1', 'acc-1', 1)`,
  ).run();
  const insertBroadcast = (id: string, status: string, scheduledAt: string | null) => {
    sqlite.prepare(
      `INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id, track_links, scheduled_at)
       VALUES (?, 'テスト配信', 'text', 'こんにちは', 'all', ?, 'acc-1', 0, ?)`,
    ).run(id, status, scheduledAt);
  };
  insertBroadcast('bc-draft', 'draft', null);
  insertBroadcast('bc-scheduled', 'scheduled', '2026-12-31T10:00:00+09:00');
  insertBroadcast('bc-sending', 'sending', null);
  insertBroadcast('bc-sent', 'sent', null);
  // キュー処理が途中で残した請求行。ON DELETE CASCADE の巻き添え対象。
  sqlite.prepare(
    `INSERT INTO broadcast_send_claims (broadcast_id, friend_id, line_account_id, state)
     VALUES ('bc-sending', 'f-1', 'acc-1', 'claimed')`,
  ).run();
}

function makeApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    // id 'env-owner' はスタッフ行の読み直しを省く予約名（account-access 参照）。
    c.set('staff', { id: 'env-owner', name: 'env-owner', role: 'owner', readOnly: false, tenantId: TENANT_ID });
    return next();
  });
  app.route('/', broadcasts);
  const env = { DB: db, WORKER_URL: 'https://worker.example.com' } as unknown as Env['Bindings'];
  return { app, env };
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8'));
  // D1 本番は外部キーを強制する。CASCADE の巻き添えを再現するため合わせる。
  sqlite.pragma('foreign_keys = ON');
  seed(sqlite);
  db = asD1(sqlite);
});

const rowCount = (table: string, id: string) =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'broadcasts' ? 'id' : 'broadcast_id'} = ?`).get(id) as { n: number }).n;

describe('D026 DELETE /api/broadcasts/:id は下書き・予約だけ消す', () => {
  test('下書きは 200 で消える', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/broadcasts/bc-draft', { method: 'DELETE' }, env);
    expect(res.status).toBe(200);
    expect(rowCount('broadcasts', 'bc-draft')).toBe(0);
  });

  test('予約は 200 で消える', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/broadcasts/bc-scheduled', { method: 'DELETE' }, env);
    expect(res.status).toBe(200);
    expect(rowCount('broadcasts', 'bc-scheduled')).toBe(0);
  });

  test('送信中は 409 で、配信も請求行も残る（止めるには停止を使う）', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/broadcasts/bc-sending', { method: 'DELETE' }, env);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error ?? '').toContain('停止');
    expect(rowCount('broadcasts', 'bc-sending')).toBe(1);
    expect(rowCount('broadcast_send_claims', 'bc-sending')).toBe(1);
  });

  test('送信済みは 409 で、配信の記録が残る', async () => {
    const { app, env } = makeApp(db);
    const res = await app.request('/api/broadcasts/bc-sent', { method: 'DELETE' }, env);
    expect(res.status).toBe(409);
    expect(rowCount('broadcasts', 'bc-sent')).toBe(1);
  });

  test('DB 関数は送信中の行を条件付きで消さない（確認と削除の窓を作らない）', async () => {
    expect(await deleteBroadcast(db, 'bc-sending')).toBe(false);
    expect(rowCount('broadcasts', 'bc-sending')).toBe(1);
    expect(rowCount('broadcast_send_claims', 'bc-sending')).toBe(1);
    expect(await deleteBroadcast(db, 'bc-draft')).toBe(true);
    expect(rowCount('broadcasts', 'bc-draft')).toBe(0);
  });
});
