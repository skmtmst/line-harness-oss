/*
 * R423/R426: 公開受信口は受信口IDから所属を確定する。
 *
 * 落ち方（直前）:
 *   R423 … 画面のコピーURL（queryなし）は feature middleware で
 *     400 LINE_ACCOUNT_REQUIRED になり、正しい署名でも受け付けない。
 *   R426 … query/本文の account を変えるだけで所有先の機能停止を
 *     すり抜けられる（B指定・不存在指定でも200）。
 * 通り方（直後）:
 *   受信口IDの所有先で機能判定する。外部指定の account は使わない。
 *   所有先の停止中は指定の有無・内容にかかわらず止まる。
 *   有効な所有先の受信を無関係な指定で拒否しない。
 *   未知の受信口は従来どおり（route が 404 を返す）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { featureEnforcementMiddleware } from './feature-enforcement.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

function routeApp() {
  const instance = new Hono<Env>();
  instance.use('/api/*', featureEnforcementMiddleware);
  instance.post('/api/webhooks/incoming/:id/receive', (c) => c.json({ success: true, data: { received: true } }));
  return instance;
}

function setFeature(testDb: SqliteD1, accountId: string, enabled: boolean): void {
  testDb.raw.prepare(`
    INSERT INTO account_settings (id, line_account_id, key, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value
  `).run(`setting-external-${accountId}`, accountId, 'feature.external_integrations', JSON.stringify({ enabled }));
}

function seed(testDb: SqliteD1): void {
  testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-r423', '統括1')`).run();
  for (const id of ['account-a', 'account-b']) {
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES (?, ?, ?, 'fixture', 'fixture', ?)
    `).run(id, `channel-${id}`, `店舗${id}`, 'tenant-r423');
  }
  testDb.raw.prepare(`
    INSERT INTO incoming_webhooks (id, name, source_type, line_account_id, is_active)
    VALUES ('wh-a', 'Aの受信口', 'custom', 'account-a', 1)
  `).run();
}

describe('R423/R426 公開受信は所有先で判定する', () => {
  let db: SqliteD1;
  let env: never;

  beforeEach(() => {
    db = createTestD1();
    seed(db);
    env = { DB: db.db } as never;
  });

  const post = (path: string, body?: unknown) => routeApp().request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? JSON.stringify({ ping: true }) : JSON.stringify(body),
    },
    env,
  );

  it('R423: コピーURL（accountなし）でも所有先の停止で403になる（400 REQUIREDではない）', async () => {
    setFeature(db, 'account-a', false);
    const res = await post('/api/webhooks/incoming/wh-a/receive');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'FEATURE_DISABLED' });
  });

  it('R423: 所有先が有効ならコピーURLのまま通る', async () => {
    setFeature(db, 'account-a', true);
    const res = await post('/api/webhooks/incoming/wh-a/receive');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { received: true } });
  });

  it('R426: 所有先の停止中は別accountのquery指定でも止まる', async () => {
    setFeature(db, 'account-a', false);
    setFeature(db, 'account-b', true);
    const res = await post('/api/webhooks/incoming/wh-a/receive?lineAccountId=account-b');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'FEATURE_DISABLED' });
  });

  it('R426: 所有先の停止中は本文のaccount指定でも止まる', async () => {
    setFeature(db, 'account-a', false);
    setFeature(db, 'account-b', true);
    const res = await post('/api/webhooks/incoming/wh-a/receive', { lineAccountId: 'account-b' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'FEATURE_DISABLED' });
  });

  it('R426: 所有先の停止中は存在しないaccount指定でも止まる', async () => {
    setFeature(db, 'account-a', false);
    const res = await post('/api/webhooks/incoming/wh-a/receive?lineAccountId=nonexistent');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ success: false, code: 'FEATURE_DISABLED' });
  });

  it('R426: 有効な所有先の受信を無関係な指定で拒否しない', async () => {
    setFeature(db, 'account-a', true);
    setFeature(db, 'account-b', false);
    const res = await post('/api/webhooks/incoming/wh-a/receive?lineAccountId=account-b');
    expect(res.status).toBe(200);
  });

  it('未知の受信口は従来どおり account 要求になる', async () => {
    const res = await post('/api/webhooks/incoming/wh-unknown/receive');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'LINE_ACCOUNT_REQUIRED' });
  });

  it('R428: 受信口の判定で本文を先読みしない（巨大本文の早期413のため）', async () => {
    setFeature(db, 'account-a', true);
    const big = JSON.stringify({ lineAccountId: 'account-a', pad: 'x'.repeat(1024 * 1024) });
    const bytes = new TextEncoder().encode(big);
    let pulled = 0;
    const stream = new ReadableStream({
      start(controller) {
        const half = Math.ceil(bytes.length / 2);
        controller.enqueue(bytes.slice(0, half));
        controller.enqueue(bytes.slice(half));
        controller.close();
      },
      pull() {},
    });
    const counting = stream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        pulled += (chunk as Uint8Array).byteLength;
        controller.enqueue(chunk);
      },
    }));
    const res = await routeApp().request(
      '/api/webhooks/incoming/wh-a/receive?lineAccountId=account-a',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: counting,
        duplex: 'half',
      } as RequestInit,
      env,
    );
    expect(res.status).toBe(200);
    // account 探索の JSON 先読みが無ければ、stub 応答まで本文は読まれない。
    expect(pulled).toBe(0);
  });
});
