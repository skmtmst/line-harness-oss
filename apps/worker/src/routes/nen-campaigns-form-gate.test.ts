/*
 * NEN-07 (#1078): 「回答フォームを開く」配信はつなぐフォームが使えることが前提。
 * 使えない(削除済み・非公開・別アカウント専用)設定は保存・稼働開始を止め、
 * 一覧へ「設定不足」の判定を返す。実DBで確かめる。
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const accessMocks = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: accessMocks.canAccess,
}));
vi.mock('../services/nen-tag-sync.js', () => ({ syncNenPetTags: vi.fn() }));
vi.mock('../services/line-proxy-send.js', () => ({ pushViaHarnessProxy: vi.fn() }));
vi.mock('../services/local-line-proxy.js', () => ({ dispatchLineProxyLocally: vi.fn() }));

const { nenCampaigns } = await import('./nen-campaigns.js');

let testDb: ReturnType<typeof createTestD1>;
let sqlite: Database.Database;

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: testDb.db } as unknown as Env['Bindings'];
    c.set('staff', {
      id: 'owner', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-a',
    } as never);
    await next();
  });
  instance.route('/', nenCampaigns);
  return instance;
}

function putSetting(body: Record<string, unknown>, key = 'review_request') {
  return app().request(`/api/nen-campaigns/settings/${key}?lineAccountId=account-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isEnabled: true,
    title: '題名',
    bodyText: '本文',
    delayDays: 10,
    deliveryTime: '10:00',
    buttonLabel: '',
    buttonUrl: '',
    imageUrl: '',
    dedupWindowDays: 30,
    excludeFormRespondents: false,
    afterActions: [],
    ...overrides,
  };
}

beforeEach(() => {
  testDb = createTestD1();
  sqlite = testDb.raw;
  sqlite.exec(`
    INSERT INTO nen_campaign_settings
      (campaign_key, label, category, trigger_event, delay_days, delivery_time,
       is_enabled, title, body_text, created_at, updated_at)
    VALUES
      ('arrival_check', '到着確認', 'follow_up', 'ec.order.shipped', 5, '10:00', 1, '題名', '本文', '2026-09-01', '2026-09-01'),
      ('review_request', '口コミ依頼', 'follow_up', 'ec.order.shipped', 10, '10:00', 1, '題名', '本文', '2026-09-01', '2026-09-01'),
      ('cross_sell', '次の商品', 'follow_up', 'ec.order.shipped', 14, '10:00', 1, '題名', '本文', '2026-09-01', '2026-09-01');
  `);
});

afterEach(() => {
  sqlite.close();
});

const openForm = (formId: string) => [
  { kind: 'open_form', formId, formName: '口コミ', buttonLabel: '回答する' },
];

describe('PUT /api/nen-campaigns/settings/:key のフォーム検査', () => {
  test('存在しないフォームを選ぶと保存できない', async () => {
    const res = await putSetting(baseBody({ afterActions: openForm('missing-form') }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('見つかりません');
  });

  test('公開されていないフォームを選ぶと保存できない', async () => {
    sqlite.prepare(`INSERT INTO forms (id, name, is_active) VALUES ('draft-form', '口コミ', 0)`).run();
    const res = await putSetting(baseBody({ afterActions: openForm('draft-form') }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('公開されていません');
  });

  test('別アカウント専用のフォームを選ぶと保存できない', async () => {
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('other-form', '口コミ')`).run();
    sqlite.prepare(
      `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('other-form', 'account-2')`,
    ).run();
    const res = await putSetting(baseBody({ afterActions: openForm('other-form') }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('別のLINEアカウント');
  });

  test('使えるフォームなら保存できる', async () => {
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('ok-form', '口コミ')`).run();
    sqlite.prepare(
      `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('ok-form', 'account-1')`,
    ).run();
    const res = await putSetting(baseBody({
      afterActions: openForm('ok-form'),
      buttonUrl: 'https://liff.line.me/liff-1/?page=form&id=ok-form',
    }));
    expect(res.status).toBe(200);
  });

  test('ボタンのURLだけがフォームを指す(未選択)状態は保存できない', async () => {
    const res = await putSetting(baseBody({
      buttonUrl: 'https://liff.line.me/liff-1/?page=form&id=ok-form',
    }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('フォームが選ばれていません');
  });

  test('ボタンのURLと選んだフォームが食い違うと保存できない', async () => {
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('ok-form', '口コミ')`).run();
    const res = await putSetting(baseBody({
      afterActions: openForm('ok-form'),
      buttonUrl: 'https://liff.line.me/liff-1/?page=form&id=another-form',
    }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('フォームが選ばれていません');
  });

  test('フォーム未選択で口コミ回答の除外だけ有効にはできない', async () => {
    const res = await putSetting(baseBody({ excludeFormRespondents: true }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('回答フォームの選択が必要');
  });
});

describe('PUT /api/nen-campaigns/settings/:key/enabled の稼働開始検査', () => {
  function putEnabled(isEnabled: boolean, key = 'review_request') {
    return app().request(`/api/nen-campaigns/settings/${key}/enabled?lineAccountId=account-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled }),
    });
  }

  test('つなぐフォームが使えない配信は動かせない', async () => {
    // 既存の稼働中設定が「フォームを選んだあとフォームが消えた」状態を作る。
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('gone-form', '口コミ')`).run();
    const ok = await putSetting(baseBody({ afterActions: openForm('gone-form') }));
    expect(ok.status).toBe(200);
    sqlite.prepare(`DELETE FROM forms WHERE id = 'gone-form'`).run();

    const res = await putEnabled(true);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain('設定不足');
  });

  test('設定不足でも停止はできる', async () => {
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('gone-form', '口コミ')`).run();
    await putSetting(baseBody({ afterActions: openForm('gone-form') }));
    sqlite.prepare(`DELETE FROM forms WHERE id = 'gone-form'`).run();
    const res = await putEnabled(false);
    expect(res.status).toBe(200);
  });

  test('フォームを使わない配信は従来どおり動かせる', async () => {
    const res = await putEnabled(true, 'arrival_check');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/nen-campaigns/settings の設定不足判定', () => {
  test('つなぐフォームが消えた配信へ formIssue を返す', async () => {
    sqlite.prepare(`INSERT INTO forms (id, name) VALUES ('gone-form', '口コミ')`).run();
    await putSetting(baseBody({ afterActions: openForm('gone-form') }));
    sqlite.prepare(`DELETE FROM forms WHERE id = 'gone-form'`).run();

    const res = await app().request('/api/nen-campaigns/settings?lineAccountId=account-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ campaignKey: string; formIssue: string | null }> };
    const review = body.data.find((row) => row.campaignKey === 'review_request');
    const arrival = body.data.find((row) => row.campaignKey === 'arrival_check');
    expect(review?.formIssue).toBe('form_missing');
    expect(arrival?.formIssue).toBeNull();
  });
});
