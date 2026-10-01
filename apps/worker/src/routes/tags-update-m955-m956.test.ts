import { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { tags } from './tags.js';

/*
 * M955・M956（/tags/edit の保存と遡及適用）。
 *
 * - M955: 「既存友だちに適用」付き保存で遡及キュー投入だけ落ちると、
 *   500を返すのにタグ保存は確定・遡及は消失し再試行口もない。
 *   正しくは保存ごと巻き戻り、同版での再送でやり直せること。
 * - M956: 応答消失後の同版再送が「別の人が先にタグを更新しました」と
 *   嘘の競合を返す。要求キー付きの再送は保存済みの結果を返すこと。
 *
 * 実DB・実routeで見る（試験用D1の batch は本番と同じく原子）。
 */
let testDb: SqliteD1;

function app(staff: { id: string; role: 'owner' | 'staff' } = { id: 'env-owner', role: 'owner' }) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: testDb.db } as Env['Bindings'];
    c.set('staff', { id: staff.id, name: '試験担当', role: staff.role, readOnly: staff.role !== 'owner' });
    await next();
  });
  instance.route('/', tags);
  return instance;
}

function patch(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app().request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function previewToken(mileage: { self: number; referrer: number }) {
  const res = await app().request('/api/tags/t1/retroactive-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccountId: 'a1', mileage }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { previewToken: string } };
  return body.data.previewToken;
}

const versionOf = (id: string) =>
  (testDb.raw.prepare('SELECT version FROM tags WHERE id = ?').get(id) as { version: number }).version;
const queueCount = () =>
  (testDb.raw.prepare('SELECT COUNT(*) AS n FROM mileage_event_queue').get() as { n: number }).n;

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.exec(`
    INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret)
    VALUES ('a1', 'A店', 'ch-a', 't', 's'), ('a2', 'B店', 'ch-b', 't', 's');
    INSERT INTO tags (id, name, line_account_id, status, version)
    VALUES ('t1', '通常タグ', 'a1', 'active', 1);
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('f1', 'u1', '友だち1', 'a1');
    INSERT INTO friend_tags (friend_id, tag_id, assigned_at)
    VALUES ('f1', 't1', '2026-01-01T00:00:00.000');
  `);
});

describe('M955 遡及キュー投入の失敗は保存ごと巻き戻る', () => {
  test('キュー投入だけ落ちたら500・版は進まない・キューは空', async () => {
    const token = await previewToken({ self: 100, referrer: 0 });
    // 遡及キューの入口を壊す（投入の INSERT が必ず落ちる）。
    testDb.raw.exec('DROP TABLE engagement_events');
    const res = await patch('/api/tags/t1', {
      lineAccountId: 'a1',
      expectedVersion: 1,
      name: '保存された名',
      mileage: { self: 100, referrer: 0, multiplier: null, priority: 0 },
      applyToExisting: true,
      previewToken: token,
    });
    expect(res.status).toBe(500);
    // 保存だけ確定して遡及だけ消える状態は無い。版も進まない。
    expect(versionOf('t1')).toBe(1);
    expect(queueCount()).toBe(0);
  });

  test('遡及付き保存は1回の取引で確定する（200・版+1・キューに積まれる）', async () => {
    const token = await previewToken({ self: 100, referrer: 0 });
    const res = await patch('/api/tags/t1', {
      lineAccountId: 'a1',
      expectedVersion: 1,
      name: '保存された名',
      mileage: { self: 100, referrer: 0, multiplier: null, priority: 0 },
      applyToExisting: true,
      previewToken: token,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { version: number; queued: number } };
    expect(body.data.version).toBe(2);
    expect(body.data.queued).toBeGreaterThan(0);
    expect(versionOf('t1')).toBe(2);
    expect(queueCount()).toBeGreaterThan(0);
  });
});

describe('M956 応答消失後の同版再送は保存済みを返す', () => {
  const KEY = 'm956-retry-key';

  test('同じ要求キー・同じ内容の再送は200で保存済み（409にしない）', async () => {
    const first = await patch(
      '/api/tags/t1',
      { lineAccountId: 'a1', expectedVersion: 1, name: '保存A' },
      { 'Idempotency-Key': KEY },
    );
    expect(first.status).toBe(200);
    // 応答だけ失った想定でもう一度同じ版・同じ内容・同じ要求キーで送る。
    const resend = await patch(
      '/api/tags/t1',
      { lineAccountId: 'a1', expectedVersion: 1, name: '保存A' },
      { 'Idempotency-Key': KEY },
    );
    expect(resend.status).toBe(200);
    const body = (await resend.json()) as {
      success: boolean;
      data: { version: number; replayed: boolean };
    };
    expect(body.data.version).toBe(2);
    expect(body.data.replayed).toBe(true);
    expect(versionOf('t1')).toBe(2);
  });

  test('同じ要求キーに違う内容は正直な409（別の人のせいにしない）', async () => {
    await patch(
      '/api/tags/t1',
      { lineAccountId: 'a1', expectedVersion: 1, name: '保存A' },
      { 'Idempotency-Key': KEY },
    );
    const res = await patch(
      '/api/tags/t1',
      { lineAccountId: 'a1', expectedVersion: 1, name: '別の内容' },
      { 'Idempotency-Key': KEY },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('idempotency_conflict');
    expect(body.error).not.toContain('別の人');
  });

  test('要求キー無しの古い版は従来どおり409（区別できないものは変えない）', async () => {
    await patch('/api/tags/t1', { lineAccountId: 'a1', expectedVersion: 1, name: '保存A' });
    const res = await patch('/api/tags/t1', { lineAccountId: 'a1', expectedVersion: 1, name: '保存A' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('version_conflict');
  });

  test('本当の競合の後は新版で保存できる', async () => {
    await patch('/api/tags/t1', { lineAccountId: 'a1', expectedVersion: 1, name: '保存A' });
    const res = await patch('/api/tags/t1', { lineAccountId: 'a1', expectedVersion: 2, name: '保存B' });
    expect(res.status).toBe(200);
    expect(versionOf('t1')).toBe(3);
  });
});

describe('M955・M956 権限と範囲の守り（回帰）', () => {
  test('staff の保存は403', async () => {
    const instance = new Hono<Env>();
    instance.use('*', async (c, next) => {
      c.env = { DB: testDb.db } as Env['Bindings'];
      c.set('staff', { id: 'env-staff', name: '閲覧者', role: 'staff', readOnly: true });
      await next();
    });
    instance.route('/', tags);
    const res = await instance.request('/api/tags/t1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'a1', expectedVersion: 1, name: 'x' }),
    });
    expect(res.status).toBe(403);
    expect(versionOf('t1')).toBe(1);
  });

  test('所属外アカウントの指定は404で書かない', async () => {
    const res = await patch('/api/tags/t1', { lineAccountId: 'nope', expectedVersion: 1, name: 'x' });
    expect(res.status).toBe(404);
    expect(versionOf('t1')).toBe(1);
  });
});
