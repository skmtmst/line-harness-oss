import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';

const access = vi.hoisted(() => vi.fn());

vi.mock('../services/account-access.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/account-access.js')>();
  return { ...actual, canAccessAllLineAccounts: access };
});

const { ecCommerce } = await import('./ec-commerce.js');

function fakeDb() {
  return {
    prepare(_sql: string) {
      const statement = {
        bind(..._bindings: unknown[]) {
          return statement;
        },
        all: async () => ({ results: [] }),
        first: async () => ({ id: 'account-1', channel_access_token: null }),
      };
      return statement;
    },
  };
}

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner-a', name: '管理者', role: 'owner', readOnly: false, tenantId: 'tenant-a',
    });
    await next();
  });
  instance.route('/', ecCommerce);
  return instance;
}

describe('点検・中: テスト送信の連打防止', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.mockResolvedValue(true);
  });

  it('中10: 同じ店・種別の連続テスト送信は2回目を429で断る', async () => {
    const target = app();
    const db = fakeDb() as unknown as D1Database;
    const payload = {
      eventType: 'ec.order.confirmed',
      accountId: 'account-1',
      title: '注文のお知らせ',
      introText: 'ご注文ありがとうございます',
      outroText: 'またのご利用をお待ちしています',
      buttonLabel: '注文を見る',
      buttonUrl: 'https://example.co.jp/orders/1',
      imageUrl: 'https://example.co.jp/images/1.png',
    };
    const send = () => target.request('/api/ec-commerce/test-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, { DB: db } as Env['Bindings']);

    // アカウント未設定で400になるが、クールダウンは刻まれる。
    const first = await send();
    expect(first.status).toBe(400);

    const second = await send();
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ success: false });
  });
});
