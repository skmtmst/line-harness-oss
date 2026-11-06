import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StyleAnalyticsData, StyleDashboardPayments, StyleSnapshot } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { seedAssignmentFixture } from '../test-utils/assignment-fixture.js';
import { paymentSummary, paymentSummaryInWindow } from '../features/booking/booking-payment-admin/index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { styles } from './styles.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: string[]) => ids.every(id => id === 'a'),
}));
let sql: ReturnType<typeof createTestD1>;
let actor: Env['Variables']['staff'];
const window = { from: '2026-09-15T15:00:00.000Z', to: '2026-10-15T15:00:00.000Z' };
const now = new Date('2026-10-21T03:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external_communication_not_allowed'); }));
  sql = createTestD1({ foreignKeys: true }); seedAssignmentFixture(sql);
  sql.raw.exec(`INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','担当','owner','fixture','${DEFAULT_TENANT_ID}');
    UPDATE staff SET staff_member_id='owner' WHERE id='s1';
    INSERT INTO friends(id,line_user_id,line_account_id) VALUES('f','Uf','a'),('fb','Ufb','b');
    INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('mb','b','別店',30,1000);
    INSERT INTO booking_settings(id,line_account_id,timezone) VALUES('settings','a','Asia/Tokyo');`);
  actor = { id: 'owner', name: '担当', tenantId: DEFAULT_TENANT_ID, role: 'owner', readOnly: false } as Env['Variables']['staff'];
});
afterEach(() => { sql.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function payment(id: string, amount: number, status: string, paid: string | null, created = '2026-09-30T01:00:00Z', updated = created, staff = 's1', account = 'a', bookingStatus = 'confirmed') {
  sql.raw.prepare(`INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at)
    VALUES(?,?,?,?,?,'2030-01-01T00:00:00Z','2030-01-01T01:00:00Z','2030-01-01T01:00:00Z',?,1000,'2026-09-01T00:00:00Z')`)
    .run(id, account, account === 'a' ? 'f' : 'fb', staff, account === 'a' ? 'm' : 'mb', bookingStatus);
  sql.raw.prepare(`INSERT INTO booking_payments(id,line_account_id,booking_id,amount,status,provider,idempotency_key,paid_at,created_at,updated_at)
    VALUES(?,?,?,?,?,'stripe',?,?,?,?)`).run(id, account, id, amount, status, id, paid, created, updated);
}
function refund(id: string, paymentId: string, amount: number, date: string) {
  sql.raw.prepare(`INSERT INTO booking_payment_refunds(id,payment_id,line_account_id,idempotency_key,amount,reason,actor_id,actor_label,notification_status,created_at)
    VALUES(?,?,'a',?,?,'返金','owner','担当','not_requested',?)`).run(id, paymentId, id, amount, date);
}
async function request(query = 'from=2026-09-16&to=2026-10-16&staff_id=s1', endpoint = 'analytics', account = 'a', style = 'salon') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', actor); await next(); });
  app.route('/', styles);
  const response = await app.request(`/api/dashboard/style/${endpoint}?account_id=${account}&style=${style}&${query}`, undefined,
    { DB: sql.db, DEPLOY_ENV: 'test', RESTAURANT_TEST_ENABLED: 'true' } as Env['Bindings']);
  const body = await response.json<{ success: boolean; data: StyleSnapshot & { payments: StyleDashboardPayments; analytics: StyleAnalyticsData } }>();
  return { status: response.status, body };
}
function available(body: Awaited<ReturnType<typeof request>>['body']) {
  const payments = body.data.payments;
  if (payments.status !== 'available') throw new Error(`unexpected_status:${payments.status}`);
  return payments;
}

function periodData() {
  payment('start', 100, 'paid', window.from);
  payment('end', 900, 'paid', window.to);
  payment('inside', 300, 'paid', '2026-10-01T00:00:00Z');
  payment('staff2', 700, 'paid', '2026-10-01T00:00:00Z', undefined, undefined, 's2');
  payment('foreign', 10000, 'paid', '2026-10-01T00:00:00Z', undefined, undefined, 'other', 'b');
  payment('today', 500, 'paid', now.toISOString());
  payment('wait', 100, 'pending', null, window.from);
  payment('failed', 100, 'failed', null);
  payment('expired', 100, 'expired', null, undefined, '2026-10-01T00:00:00Z', 's1', 'a', 'expired');
  payment('retained', 100, 'expired', null);
  payment('legacy', 200, 'refunded', '2026-09-01T00:00:00Z', undefined, '2026-10-02T00:00:00Z');
  payment('partial', 1000, 'paid', '2026-09-01T00:00:00Z');
  refund('r1', 'partial', 300, '2026-09-30T00:00:00Z');
  refund('r2', 'partial', 100, '2026-10-01T00:00:00Z');
  refund('r3', 'partial', 200, window.to);
}

describe('選択期間の支払い集計', () => {
  it('入金・返金・待ち・期限切れをそれぞれの日時で数え、別店と別担当を混ぜない', async () => {
    periodData();
    expect(await paymentSummaryInWindow(sql.db, 'a', window, 's1')).toMatchObject({
      paidAmount: 400, paidCount: 2, refundedAmount: 600, refundedCount: 2, pendingCount: 1, expiredCount: 1,
    });
    expect(await paymentSummaryInWindow(sql.db, 'a', window)).toMatchObject({ paidAmount: 1100, paidCount: 3 });
    expect(await paymentSummary(sql.db, 'a', now, 'today', 's1')).toMatchObject({ paidAmount: 500, paidCount: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('分析だけ選択した過去30日の担当別値を返し、今日のまとめは従来の範囲を保つ', async () => {
    periodData();
    const analytics = await request();
    expect(analytics.status).toBe(200);
    expect(available(analytics.body)).toMatchObject({ paidAmount: 400, refundedAmount: 600,
      period: { ...window, timeZone: 'Asia/Tokyo', dateBasis: 'payment' } });
    const summary = await request('staff_id=s1', 'summary');
    expect(summary.status).toBe(200);
    expect(available(summary.body)).toMatchObject({ paidAmount: 500, paidCount: 1 });
    expect(available(summary.body).period).toBeUndefined();
  });

  it('選んだ日の店舗時間帯で境界を決め、終了時刻ちょうどの入金を含めない', async () => {
    sql.raw.exec("UPDATE booking_settings SET timezone='America/Los_Angeles'");
    payment('before', 200, 'paid', '2026-10-01T06:59:59Z');
    payment('first', 300, 'paid', '2026-10-01T07:00:00Z');
    payment('last', 500, 'paid', '2026-10-02T07:00:00Z');
    const result = await request('from=2026-10-01&to=2026-10-02&staff_id=s1');
    expect(result.status).toBe(200);
    expect(available(result.body)).toMatchObject({ paidAmount: 300, paidCount: 1,
      period: { from: '2026-10-01T07:00:00.000Z', to: '2026-10-02T07:00:00.000Z', timeZone: 'America/Los_Angeles' } });
  });

  it('有効な0件を返し、無効な範囲や他店・他店担当を0件として成功させない', async () => {
    expect(available((await request()).body)).toMatchObject({ paidAmount: 0, refundedAmount: 0, pendingCount: 0 });
    expect((await request('from=not-a-date&to=2026-10-16')).status).toBe(400);
    expect((await request('from=2026-10-16&to=2026-09-16')).status).toBe(400);
    expect((await request(undefined, 'analytics', 'b')).status).toBe(404);
    expect((await request('staff_id=other')).status).toBe(404);
    await expect(paymentSummaryInWindow(sql.db, 'a', { from: 'invalid', to: window.to })).rejects.toThrow('invalid_payment_window');
  });

  it('担当者本人の範囲を保ち、支払い閲覧権限がない人へ金額を返さない', async () => {
    periodData(); actor.role = 'staff'; actor.permissionKeys = ['/booking/bookings'];
    const own = await request('from=2026-09-16&to=2026-10-16', 'analytics', 'a', 'consult');
    expect(own.status).toBe(200);
    expect(available(own.body).paidAmount).toBe(400);
    expect((await request('staff_id=s2', 'analytics', 'a', 'consult')).status).toBe(403);
    actor.permissionKeys = ['/events'];
    const noPayment = await request(undefined, 'analytics', 'a', 'lesson');
    expect(noPayment.status).toBe(200);
    expect(noPayment.body.data.payments).toEqual({ status: 'forbidden' });
  });

  it('日別比較は当期と前期の正規指標と0件の日を返し、担当者の範囲を保つ', async () => {
    payment('current', 100, 'paid', window.from, undefined, undefined, 's1', 'a', 'completed');
    payment('previous', 100, 'paid', window.from);
    payment('other-staff', 100, 'paid', window.from, undefined, undefined, 's2');
    sql.raw.exec("UPDATE bookings SET starts_at='2026-10-15T01:00:00Z' WHERE id IN('current','other-staff'); UPDATE bookings SET starts_at='2026-10-13T01:00:00Z' WHERE id='previous'");
    const result = await request('from=2026-10-14&to=2026-10-16&staff_id=s1');
    expect(result.status).toBe(200);
    expect(result.body.data.analytics.dailyComparison).toMatchObject({
      current: [
        { date: '2026-10-14', metrics: { bookings: { value: 0, status: 'available' }, visits: { value: 0, status: 'available' } } },
        { date: '2026-10-15', metrics: { bookings: { value: 1, status: 'available' }, visits: { value: 1, status: 'available' } } },
      ],
      previous: [
        { date: '2026-10-12', metrics: { bookings: { value: 0, status: 'available' } } },
        { date: '2026-10-13', metrics: { bookings: { value: 1, status: 'available' } } },
      ],
    });
  });

  it('集計を取得できないときは正常な0件へ変えず失敗を返す', async () => {
    sql.raw.exec('DROP TABLE booking_payment_refunds');
    const result = await request();
    expect(result.status).toBe(503);
    expect(result.body.success).toBe(false);
    expect(result.body.data).toBeUndefined();
  });
});
