import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { getFriendSummary } from '@line-crm/db';
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn() }));
vi.mock('../services/step-delivery.js', () => ({ buildMessage: vi.fn() }));
const { friends } = await import('./friends.js');
let db: SqliteD1;
const now = new Date('2026-10-07T00:00:00Z');
beforeEach(() => {
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('a1', 'test-channel', '試験', 'fixture-token', 'fixture-secret')`).run();
  db.raw.prepare(`INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('f1', 'U-test', 'a1')`).run();
});
afterEach(() => db.raw.close());
function connect() {
  db.raw.prepare(`INSERT INTO ec_connectors
    (id, line_account_id, provider, shop_domain, created_at, updated_at)
    VALUES ('c1', 'a1', 'ec_cube', 'example.test', ?, ?)`).run(now.toISOString(), now.toISOString());
}
function order(id: string, opts: { at?: string; currency?: string; amount?: number | null; status?: string; account?: string; friend?: string; refund?: number } = {}) {
  db.raw.prepare(`INSERT INTO ec_orders
    (id, line_account_id, source_key, external_order_id, friend_id, order_number,
     normalized_status, provider_status, currency, total_amount_minor, refunded_amount_minor,
     ordered_at, last_event_id, created_at, updated_at)
    VALUES (?, ?, 'test', ?, ?, ?, ?, 'paid', ?, ?, ?, ?, 'test-event', ?, ?)`)
    .run(id, opts.account ?? 'a1', id, opts.friend ?? 'f1', id, opts.status ?? 'current', opts.currency ?? 'JPY',
      opts.amount === undefined ? 1000 : opts.amount, opts.refund ?? null,
      opts.at ?? '2026-10-01T00:00:00Z', now.toISOString(), now.toISOString());
}
const summary = () => getFriendSummary(db.db, 'f1', 'a1', now);
describe('友だちの90日集計', () => {
  test('個人開封の分母0とEC未連携はnull', async () => {
    const data = await summary();
    expect(data.deliveryOpenRate90Days).toBeNull();
    expect(data.deliveryOpenMeasuredCount90Days).toBe(0);
    expect(data.purchases90Days).toBeNull();
  });
  test('EC接続済みで購入なしは0', async () => {
    connect();
    expect((await summary()).purchases90Days).toMatchObject({ count: 0, totalAmountMinor: 0 });
  });
  test('直近90日だけを集計し、取消・返金・別人・別アカウント・未来は除く', async () => {
    connect();
    order('valid', { amount: 2000, refund: 500 });
    order('cancelled', { status: 'cancelled' });
    order('refunded', { status: 'refunded' });
    order('other-friend', { friend: 'f2' });
    order('other-account', { account: 'a2' });
    order('old', { at: '2026-07-08T23:59:59Z' });
    order('future', { at: '2026-10-08T00:00:00Z' });
    order('boundary', { at: '2026-07-09T00:00:00Z', amount: 100 });
    expect((await summary()).purchases90Days).toMatchObject({ count: 2, totalAmountMinor: 1600, currency: 'JPY' });
  });
  test('複数通貨を足さず、通貨別金額を返す', async () => {
    connect(); order('jpy'); order('usd', { currency: 'USD', amount: 500 });
    const data = (await summary()).purchases90Days;
    expect(data).toMatchObject({ count: 2, totalAmountMinor: null, currency: null });
    expect(data?.byCurrency).toHaveLength(2);
  });
  test('金額が不明な注文を0円扱いしない', async () => {
    connect(); order('unknown', { amount: null }); order('known');
    expect((await summary()).purchases90Days).toMatchObject({ count: 2, totalAmountMinor: null });
  });
  test('実ルートが返り値を包み、存在しない友だちは404', async () => {
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'owner-test', name: '試験', role: 'owner', readOnly: false });
      await next();
    });
    app.route('/', friends);
    const res = await app.request('/api/friends/f1/summary', {}, { DB: db.db });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { periodDays: 90, deliveryOpenRate90Days: null } });
    expect((await app.request('/api/friends/missing/summary', {}, { DB: db.db })).status).toBe(404);
  });
});
