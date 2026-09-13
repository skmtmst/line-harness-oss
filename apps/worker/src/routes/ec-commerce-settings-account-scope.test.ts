import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { ecCommerce } from './ec-commerce';

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

function app(db: D1Database) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db } as Env['Bindings'];
    c.set('staff', owner);
    await next();
  });
  instance.route('/', ecCommerce);
  return instance;
}

function seedAccounts(testDb: SqliteD1): void {
  testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')`).run();
  for (const [id, tenant] of [['account-1', 'tenant-1'], ['account-2', 'tenant-1'], ['account-3', 'tenant-2']]) {
    testDb.raw.prepare(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
      VALUES (?, ?, ?, 'token', 'secret', 1, ?)
    `).run(id, `channel-${id}`, id, tenant);
  }
  testDb.raw.prepare(`
    INSERT INTO ec_notification_settings
      (event_type, is_enabled, title_override, intro_text, outro_text, category,
       button_label, button_url, image_url, display_order, created_at, updated_at)
    VALUES ('ec.order.confirmed', 1, '既定の注文通知', 'ご注文ありがとうございます。',
            'またのご利用をお待ちしています。', 'order', '注文を見る', NULL, NULL, 10,
            '2026-09-08T00:00:00+09:00', '2026-09-08T00:00:00+09:00')
  `).run();
}

const setting = {
  isEnabled: false,
  title: '店舗1だけの注文通知',
  introText: '店舗1のご注文ありがとうございます。',
  outroText: '店舗1からのお知らせです。',
  buttonLabel: '注文を見る',
  buttonUrl: 'https://example.com/orders/1',
  imageUrl: 'https://example.com/order.png',
};

describe('EC通知設定のアカウント境界', () => {
  it('同じ統括内でも保存した店舗だけを変更し、別統括の店舗は拒否する', async () => {
    const testDb = createTestD1();
    seedAccounts(testDb);
    const target = app(testDb.db);

    const before = await target.request('/api/ec-commerce/settings?lineAccountId=account-2');
    expect(before.status).toBe(200);
    const beforeBody = await before.json() as { data: Array<{ eventType: string; title: string }> };
    const account2Title = beforeBody.data.find((item) => item.eventType === 'ec.order.confirmed')?.title;

    const updated = await target.request(
      '/api/ec-commerce/settings/ec.order.confirmed?lineAccountId=account-1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(setting) },
    );
    expect(updated.status).toBe(200);

    const account1 = await target.request('/api/ec-commerce/settings?lineAccountId=account-1');
    const account1Body = await account1.json() as { data: Array<{ eventType: string; title: string }> };
    expect(account1Body.data.find((item) => item.eventType === 'ec.order.confirmed')?.title)
      .toBe('店舗1だけの注文通知');

    const account2 = await target.request('/api/ec-commerce/settings?lineAccountId=account-2');
    const account2Body = await account2.json() as { data: Array<{ eventType: string; title: string }> };
    expect(account2Body.data.find((item) => item.eventType === 'ec.order.confirmed')?.title)
      .toBe(account2Title);

    const cleared = await target.request(
      '/api/ec-commerce/settings/ec.order.confirmed?lineAccountId=account-1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...setting, buttonLabel: '', buttonUrl: '', imageUrl: '' }),
      },
    );
    expect(cleared.status).toBe(200);
    const clearedBody = await (await target.request(
      '/api/ec-commerce/settings?lineAccountId=account-1',
    )).json() as { data: Array<{ eventType: string; buttonLabel: string }> };
    expect(clearedBody.data.find((item) => item.eventType === 'ec.order.confirmed')?.buttonLabel)
      .toBe('');

    expect((await target.request('/api/ec-commerce/settings?lineAccountId=account-3')).status).toBe(403);
    expect((await target.request('/api/ec-commerce/settings')).status).toBe(400);
  });

  it('実配信も受信したLINEアカウントの設定を優先して読む', () => {
    const source = readFileSync(new URL('./ec-integrations.ts', import.meta.url), 'utf8');
    expect(source).toContain('a.line_account_id = ?');
    expect(source).toContain('.bind(lineAccountId, event.event_type)');
    expect(source).toContain('COALESCE(a.is_enabled, s.is_enabled)');
  });
});
