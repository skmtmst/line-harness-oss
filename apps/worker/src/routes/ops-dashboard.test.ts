import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createHqSupportRequest, recordBillingEvent } from '@line-crm/db';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { jstMonthStart, opsDashboard, resolvePeriod } from './ops-dashboard.js';

/** ★V6 37-2 運営ダッシュボード。金額は定価ベース（決定 2026-09-17）。 */

let testDb: SqliteD1;

function app(staff: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => { c.set('staff', staff); return next(); });
  instance.route('/', opsDashboard);
  return { request: (path: string) => instance.request(path, {}, { DB: testDb.db, ADMIN_PUBLIC_URL: 'https://admin.example.com' } as Env['Bindings']) };
}

const master: AuthenticatedStaff = { id: 'master-1', name: '坂本 真人', role: 'owner', readOnly: false, tenantId: null };
const tenantOwner: AuthenticatedStaff = { id: 'owner-1', name: '山田 太郎', role: 'owner', readOnly: false, tenantId: 'tenant-a' };

type Body = { data: {
  kpis: { mrr: number; mrrDelta: number; active: number; byPlan: Record<string, number>; trialing: number; newInPeriod: number; churnInPeriod: number; churnRate: number };
  revenueByMonth: Array<{ label: string; yen: number; current: boolean }>;
  planShare: { total: number; rows: Array<{ key: string; count: number; percent: number }> };
  alerts: { pastDue: number; trialEndingSoon: number; lineTokenExpiring: number; unansweredTickets: number };
  tickets: { newCount: number; inProgressCount: number; closedInPeriod: number };
  lineRegistration: { registered: number; total: number; unregisteredCount: number };
  usage: Array<{ tenantName: string; usageRate: number; messages: number; limits: { messages: number | null } }>;
  periodLabel: string;
} };

function iso(daysFromNow: number): string {
  const t = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
  return t.toISOString().replace('Z', '+09:00');
}

beforeEach(() => {
  testDb = createTestD1();
  const now = iso(0);
  const tenants: Array<[string, string, string, string | null, string | null, string]> = [
    ['tenant-a', '株式会社サンプル', 'active', 'standard', null, iso(-90)],
    ['tenant-b', 'カフェ ムスビ', 'active', 'light', null, iso(-60)],
    ['tenant-c', '株式会社ハレ', 'past_due', 'pro', null, iso(-45)],
    ['tenant-d', 'サンプル商店', 'trialing', null, iso(2), iso(-5)],
    ['tenant-e', '解約した会社', 'canceled', 'light', null, iso(-120)],
    ['tenant-z', '保管', 'active', 'pro', null, iso(-10)],
  ];
  for (const [id, name, planStatus, planKey, trialEnds, createdAt] of tenants) {
    testDb.raw.prepare(`INSERT INTO tenants (id, name, status, plan_key, plan_status, trial_ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, id === 'tenant-z' ? 'archived' : 'active', planKey, planStatus, trialEnds, createdAt);
  }
  testDb.raw.prepare(`INSERT INTO staff_members (id, name, role, api_key, tenant_id) VALUES ('master-1', '坂本 真人', 'owner', 'k1', NULL)`).run();
  testDb.raw.prepare(`INSERT INTO platform_admins (staff_id, is_active) VALUES ('master-1', 1)`).run();
  testDb.raw.prepare(`INSERT INTO staff_members (id, name, role, api_key, tenant_id, line_user_id, notice_friend_id, email) VALUES ('owner-1', '山田 太郎', 'owner', 'k2', 'tenant-a', 'U1', 'notice-friend-1', 'a@example.com')`).run();
  testDb.raw.prepare(`INSERT INTO staff_members (id, name, role, api_key, tenant_id, email) VALUES ('owner-2', '木下 花', 'owner', 'k3', 'tenant-b', 'b@example.com')`).run();
  testDb.raw.prepare(`INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token, tenant_id, token_expires_at) VALUES ('la-1', '店舗1', 'c1', 's1', 't1', 'tenant-a', ?)`).run(iso(5));
  void now;
});

describe('期間', () => {
  it('今月・先月・今年の境界を JST で切る', () => {
    const at = Date.parse('2026-09-17T14:00:00+09:00');
    expect(resolvePeriod('month', at)).toEqual({ from: '2026-09-01T00:00:00.000+09:00', to: '2026-10-01T00:00:00.000+09:00', label: '今月' });
    expect(resolvePeriod('prev_month', at).from).toBe('2026-08-01T00:00:00.000+09:00');
    expect(resolvePeriod('year', at)).toMatchObject({ from: '2026-01-01T00:00:00.000+09:00', to: '2027-01-01T00:00:00.000+09:00' });
    expect(jstMonthStart(2026, -1)).toBe('2025-12-01T00:00:00.000+09:00');
    expect(jstMonthStart(2026, 12)).toBe('2027-01-01T00:00:00.000+09:00');
  });
});

describe('集計', () => {
  it('統括のオーナーは呼べない', async () => {
    expect((await app(tenantOwner).request('/api/ops/dashboard')).status).toBe(403);
  });

  it('MRR は契約中（決済失敗を含む）の定価の合計。保管した契約先と運営会社は数えない', async () => {
    const res = await app(master).request('/api/ops/dashboard');
    expect(res.status).toBe(200);
    const body = await res.json() as Body;
    // standard 29,800 + light 9,800 + pro 59,800（past_due も契約中に含む）
    expect(body.data.kpis.mrr).toBe(99_400);
    expect(body.data.kpis.active).toBe(3);
    expect(body.data.kpis.byPlan).toEqual({ light: 1, standard: 1, pro: 1 });
    expect(body.data.kpis.trialing).toBe(1);
    expect(body.data.planShare.total).toBe(4);
    expect(body.data.planShare.rows.find((r) => r.key === 'trial')?.percent).toBe(25);
    expect(body.data.revenueByMonth).toHaveLength(6);
    expect(body.data.revenueByMonth[5]).toMatchObject({ current: true, yen: 99_400 });
    expect(body.data.periodLabel).toBe('今月');
  });

  it('要対応：決済失敗・トライアル期限3日以内・LINEトークン期限・未返信のお問い合わせ', async () => {
    await createHqSupportRequest(testDb.db, { tenantId: 'tenant-a', staffId: 'owner-1', staffName: '山田 太郎', staffEmail: null, kind: 'bug', subject: 'x', body: 'y', lineAccountId: null, attachmentKeys: [] });
    const body = await (await app(master).request('/api/ops/dashboard')).json() as Body;
    expect(body.data.alerts).toEqual({ pastDue: 1, trialEndingSoon: 1, lineTokenExpiring: 1, unansweredTickets: 1 });
    expect(body.data.tickets.newCount).toBe(1);
  });

  it('解約は Stripe の出来事から数え、解約率は期間はじめの契約数で割る', async () => {
    await recordBillingEvent(testDb.db, { id: 'evt-1', type: 'customer.subscription.deleted', tenantId: 'tenant-e' });
    const body = await (await app(master).request('/api/ops/dashboard')).json() as Body;
    expect(body.data.kpis.churnInPeriod).toBe(1);
    // 期間はじめに契約中だったのは a, b, c と（今月解約した）e の 4 社 → 25%
    expect(body.data.kpis.churnRate).toBe(25);
    // 先月末には e も契約中だったので、前月比はマイナス
    expect(body.data.kpis.mrrDelta).toBe(-9_800);
  });

  it('LINE 登録は権限者のうち LINE 連携済みの人数。未登録の一覧は名前と契約先だけ', async () => {
    const body = await (await app(master).request('/api/ops/dashboard')).json() as Body;
    expect(body.data.lineRegistration).toEqual({ registered: 1, total: 2, unregisteredCount: 1 });
    const list = await (await app(master).request('/api/ops/dashboard/line-unregistered')).json() as { data: { people: Array<Record<string, unknown>> } };
    expect(list.data.people).toEqual([{ staffId: 'owner-2', name: '木下 花', tenantName: 'カフェ ムスビ', hasEmail: true }]);
    expect(JSON.stringify(list)).not.toContain('b@example.com');
  });

  it('使用量は今月の配信通数・バナー生成・メディア容量をプランの上限と比べる', async () => {
    testDb.raw.prepare(`INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('f1', 'Uf1', '友だち', 'la-1')`).run();
    for (let i = 0; i < 4; i += 1) {
      testDb.raw.prepare(`INSERT INTO messages_log (id, friend_id, line_account_id, direction, message_type, content, created_at) VALUES (?, 'f1', 'la-1', 'outgoing', 'text', 'hi', ?)`).run(`m${i}`, iso(-1));
    }
    testDb.raw.prepare(`INSERT INTO banner_usage_ledger (id, tenant_id, units, reason, created_at) VALUES ('b1', 'tenant-a', 30, 'generate', ?)`).run(iso(-1));
    const body = await (await app(master).request('/api/ops/dashboard')).json() as Body;
    expect(body.data.usage[0]).toMatchObject({ tenantName: '株式会社サンプル', messages: 4, limits: { messages: 30_000 } });
    // バナー 30/150 = 20% が最大
    expect(body.data.usage[0].usageRate).toBe(20);
  });
});
