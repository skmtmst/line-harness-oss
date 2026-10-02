/**
 * TikTok利益計算API：Google連携の「接続済み」判定の回帰テスト。
 *
 * 利益計算は自分でスプレッドシートを作るので、#838 の書き出し先
 * （google_sheets_integrations.spreadsheet_id）を使わない。
 * それなのに書き出し先が未選択の `pending_target` を未接続として扱うと、
 * Googleの認可を済ませた利用者の画面に「未接続」と出て、同期ボタンも
 * 409 で弾かれる。実際に検証環境でこれが起きたので、ここで固定する。
 *
 * 逆に認可が切れた `expired` を接続済みにしてしまうと、再接続の案内が
 * 出ないまま同期が失敗し続ける。両方向を確かめる。
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { tiktokPnl } from './tiktok-pnl.js';

const ACCOUNT = 'acc-1';

function makeApp() {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'owner', readOnly: false } as never);
    return next();
  });
  app.route('/', tiktokPnl);
  return app;
}

function seedIntegration(testDb: SqliteD1, status: string): void {
  testDb.raw.prepare(
    `INSERT INTO google_sheets_integrations
       (id, line_account_id, google_account_email, refresh_token_enc, status, connected_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(`int-${ACCOUNT}`, ACCOUNT, 'owner@example.com', 'enc', status, '2026-10-02T00:00:00Z');
}

async function statusOf(testDb: SqliteD1): Promise<{ sheetsConnected: boolean }> {
  const res = await makeApp().request(
    `/api/integrations/tiktok-pnl/status?account_id=${ACCOUNT}`,
    {},
    { DB: testDb.db } as Env['Bindings'],
  );
  expect(res.status).toBe(200);
  const body = await res.json() as { data: { sheetsConnected: boolean } };
  return body.data;
}

describe('TikTok利益計算：Google連携の接続済み判定', () => {
  let testDb: SqliteD1;
  beforeEach(() => {
    testDb = createTestD1();
  });

  it('書き出し先が未選択（pending_target）でも接続済みとして扱う', async () => {
    // Googleの認可は済んでいて更新用トークンもある。#838 の書き出し先を
    // 選んでいないだけ。利益計算はその書き出し先を使わないので動かせる。
    seedIntegration(testDb, 'pending_target');

    expect((await statusOf(testDb)).sheetsConnected).toBe(true);
  });

  it('書き出し先まで選び終えた（connected）場合も接続済み', async () => {
    seedIntegration(testDb, 'connected');

    expect((await statusOf(testDb)).sheetsConnected).toBe(true);
  });

  it('認可切れ（expired）は接続済みにしない', async () => {
    seedIntegration(testDb, 'expired');

    expect((await statusOf(testDb)).sheetsConnected).toBe(false);
  });

  it('連携そのものが無ければ接続済みにしない', async () => {
    expect((await statusOf(testDb)).sheetsConnected).toBe(false);
  });

  it('手動同期は pending_target を未接続として断らない', async () => {
    seedIntegration(testDb, 'pending_target');

    const res = await makeApp().request(
      `/api/integrations/tiktok-pnl/sync?account_id=${ACCOUNT}`,
      { method: 'POST' },
      { DB: testDb.db } as Env['Bindings'],
    );

    // Googleへは実際に繋がないので同期自体は失敗してよい。ここで見たいのは
    // 「未接続です」の 409 で門前払いされないこと。
    expect(res.status).not.toBe(409);
  });

  it('手動同期は認可切れを未接続として断る', async () => {
    seedIntegration(testDb, 'expired');

    const res = await makeApp().request(
      `/api/integrations/tiktok-pnl/sync?account_id=${ACCOUNT}`,
      { method: 'POST' },
      { DB: testDb.db } as Env['Bindings'],
    );

    expect(res.status).toBe(409);
    // 有効化だけ先に済ませてしまうと、認可が切れたままcronの対象になる。
    const settings = await testDb.db.prepare(
      'SELECT enabled FROM tiktok_pnl_settings WHERE line_account_id = ?',
    ).bind(ACCOUNT).first<{ enabled: number }>();
    expect(settings).toBeNull();
  });
});
