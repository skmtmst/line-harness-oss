import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const stripe = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  retrievePrice: vi.fn(),
  retrieveSubscription: vi.fn(),
  listInvoices: vi.fn(),
}));
vi.mock('../services/stripe-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/stripe-api.js')>();
  return { ...actual, stripeApi: stripe };
});

const { hqBilling } = await import('./hq-billing.js');

let testDb: SqliteD1;
const WEBHOOK_SECRET = 'whsec_test_secret';

const staffOf = (overrides: Partial<AuthenticatedStaff> = {}): AuthenticatedStaff => ({
  id: 'staff-1',
  name: '山田 太郎',
  role: 'owner',
  readOnly: false,
  tenantId: DEFAULT_TENANT_ID,
  ...overrides,
});

function app(staff: AuthenticatedStaff | null) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    if (staff) c.set('staff', staff);
    return next();
  });
  instance.route('/', hqBilling);
  return instance;
}

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: testDb.db,
    ADMIN_ORIGIN: 'https://admin.example.com',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_BILLING_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_LIGHT: 'price_light',
    STRIPE_PRICE_STANDARD: 'price_standard',
    STRIPE_PRICE_PRO: 'price_pro',
    ...overrides,
  } as Env['Bindings'];
}

async function call(method: string, path: string, body?: unknown, opts: { staff?: AuthenticatedStaff | null; env?: Partial<Env['Bindings']> } = {}) {
  return app(opts.staff === undefined ? staffOf() : opts.staff).request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env(opts.env));
}

async function sign(payload: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

async function webhook(event: Record<string, unknown>, opts: { secret?: string; env?: Partial<Env['Bindings']> } = {}) {
  const payload = JSON.stringify(event);
  return app(null).request('/api/hq/billing/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': await sign(payload, opts.secret) },
    body: payload,
  }, env(opts.env));
}

function setTenant(patch: Record<string, string | null>) {
  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  testDb.raw.prepare(`UPDATE tenants SET ${sets} WHERE id = ?`).run(...Object.values(patch), DEFAULT_TENANT_ID);
}

function tenantRow() {
  return testDb.raw.prepare('SELECT plan_key, plan_status, trial_ends_at, stripe_customer_id, stripe_subscription_id, current_period_ends_at FROM tenants WHERE id = ?').get(DEFAULT_TENANT_ID) as Record<string, string | null>;
}

beforeEach(() => {
  testDb = createTestD1();
  for (const fn of Object.values(stripe)) fn.mockReset();
  stripe.retrievePrice.mockResolvedValue({ id: 'price', unit_amount: 12345, currency: 'jpy' });
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, email, role, api_key, tenant_id) VALUES ('staff-1', '山田 太郎', 'masato@example.com', 'admin', 'key-1', ?)`,
  ).run(DEFAULT_TENANT_ID);
});

describe('契約状況（summary）', () => {
  it('既存の統括は課金対象外で、何も止まらない', async () => {
    const res = await call('GET', '/api/hq/billing/summary', undefined, { env: { STRIPE_SECRET_KEY: undefined } });
    expect(res.status).toBe(200);
    const data = (await res.json<{ data: { state: string; canSend: boolean; stripeReady: boolean; plans: Array<{ key: string; monthlyYen: number; available: boolean; priceFromStripe: boolean }> } }>()).data;
    expect(data.state).toBe('exempt');
    expect(data.canSend).toBe(true);
    expect(data.stripeReady).toBe(false);
    expect(data.plans.map((p) => p.key)).toEqual(['light', 'standard', 'pro']);
    expect(data.plans[0]).toMatchObject({ monthlyYen: 9800, available: false, priceFromStripe: false });
  });

  it('Stripe の価格が取れればその金額を出す', async () => {
    const res = await call('GET', '/api/hq/billing/summary');
    const data = (await res.json<{ data: { plans: Array<{ monthlyYen: number; priceFromStripe: boolean; available: boolean }> } }>()).data;
    expect(data.plans[1]).toMatchObject({ monthlyYen: 12345, priceFromStripe: true, available: true });
  });

  it('トライアル中は残り日数、期限切れは止まる理由が出る', async () => {
    setTenant({ plan_status: 'trialing', trial_ends_at: '2999-01-10T00:00:00.000' });
    const data = (await (await call('GET', '/api/hq/billing/summary')).json<{ data: { state: string; trialDaysLeft: number; trialEndsLabel: string } }>()).data;
    expect(data.state).toBe('trialing');
    expect(data.trialDaysLeft).toBeGreaterThan(0);
    expect(data.trialEndsLabel).toBe('1/10');

    setTenant({ trial_ends_at: '2020-01-01T00:00:00.000' });
    const expired = (await (await call('GET', '/api/hq/billing/summary')).json<{ data: { state: string; canSend: boolean; blockedReason: string } }>()).data;
    expect(expired.state).toBe('trial_expired');
    expect(expired.canSend).toBe(false);
    expect(expired.blockedReason).toContain('課金プラン');
  });
});

describe('申込（checkout）', () => {
  beforeEach(() => {
    setTenant({ plan_status: 'trialing', trial_ends_at: '2020-01-01T00:00:00.000' });
    stripe.createCustomer.mockResolvedValue({ id: 'cus_1', email: 'masato@example.com', name: '既定の統括' });
    stripe.createCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1', customer: 'cus_1', subscription: null, client_reference_id: DEFAULT_TENANT_ID });
  });

  it('オーナーがプランを選ぶと、顧客を作って Checkout の URL を返す', async () => {
    const res = await call('POST', '/api/hq/billing/checkout', { planKey: 'standard' });
    expect(res.status).toBe(200);
    expect((await res.json<{ data: { url: string } }>()).data.url).toContain('checkout.stripe.com');
    expect(stripe.createCustomer).toHaveBeenCalledTimes(1);
    const args = stripe.createCheckoutSession.mock.calls[0][1] as { priceId: string; planKey: string; successUrl: string; cancelUrl: string };
    expect(args.priceId).toBe('price_standard');
    expect(args.planKey).toBe('standard');
    expect(args.successUrl).toBe('https://admin.example.com/hq/billing?checkout=success');
    expect(tenantRow().stripe_customer_id).toBe('cus_1');
  });

  it('2回目は顧客を作り直さない', async () => {
    setTenant({ stripe_customer_id: 'cus_existing' });
    await call('POST', '/api/hq/billing/checkout', { planKey: 'light' });
    expect(stripe.createCustomer).not.toHaveBeenCalled();
    expect((stripe.createCheckoutSession.mock.calls[0][1] as { customerId: string }).customerId).toBe('cus_existing');
  });

  it('管理者は申し込めない（オーナーだけ）', async () => {
    const res = await call('POST', '/api/hq/billing/checkout', { planKey: 'light' }, { staff: staffOf({ role: 'admin' }) });
    expect(res.status).toBe(403);
  });

  it('課金対象外・契約中・設定なし・不正なプランは断る', async () => {
    expect((await call('POST', '/api/hq/billing/checkout', { planKey: 'gold' })).status).toBe(400);
    expect((await call('POST', '/api/hq/billing/checkout', { planKey: 'light' }, { env: { STRIPE_SECRET_KEY: undefined } })).status).toBe(503);
    expect((await call('POST', '/api/hq/billing/checkout', { planKey: 'light' }, { env: { STRIPE_PRICE_LIGHT: undefined } })).status).toBe(503);
    setTenant({ plan_status: 'exempt' });
    expect((await call('POST', '/api/hq/billing/checkout', { planKey: 'light' })).status).toBe(409);
    setTenant({ plan_status: 'active', stripe_subscription_id: 'sub_1' });
    expect((await call('POST', '/api/hq/billing/checkout', { planKey: 'light' })).status).toBe(409);
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('ポータルと支払い履歴', () => {
  it('契約前はポータルが無く、履歴は空', async () => {
    expect((await call('POST', '/api/hq/billing/portal')).status).toBe(409);
    const res = await call('GET', '/api/hq/billing/invoices');
    expect((await res.json<{ data: unknown[] }>()).data).toEqual([]);
    expect(stripe.listInvoices).not.toHaveBeenCalled();
  });

  it('契約後はポータルの URL と履歴を返す', async () => {
    setTenant({ stripe_customer_id: 'cus_1', plan_status: 'active', plan_key: 'light' });
    stripe.createPortalSession.mockResolvedValue({ id: 'bps_1', url: 'https://billing.stripe.com/p/session/x' });
    stripe.listInvoices.mockResolvedValue({ data: [{ id: 'in_1', number: 'A-1', status: 'paid', amount_paid: 9800, amount_due: 9800, currency: 'jpy', created: 1_760_000_000, hosted_invoice_url: 'https://invoice', invoice_pdf: 'https://pdf', lines: { data: [{ description: 'ライト' }] } }] });
    expect((await (await call('POST', '/api/hq/billing/portal')).json<{ data: { url: string } }>()).data.url).toContain('billing.stripe.com');
    const invoices = (await (await call('GET', '/api/hq/billing/invoices')).json<{ data: Array<{ amountYen: number; description: string }> }>()).data;
    expect(invoices[0]).toMatchObject({ amountYen: 9800, description: 'ライト' });
  });
});

describe('課金 Webhook', () => {
  const completed = (id = 'evt_1') => ({
    id,
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', customer: 'cus_1', subscription: 'sub_1', client_reference_id: DEFAULT_TENANT_ID, metadata: { tenant_id: DEFAULT_TENANT_ID, plan_key: 'standard' } } },
  });

  beforeEach(() => {
    setTenant({ plan_status: 'trialing', trial_ends_at: '2020-01-01T00:00:00.000' });
    stripe.retrieveSubscription.mockResolvedValue({ id: 'sub_1', status: 'active', customer: 'cus_1', current_period_end: 1_760_000_000, items: { data: [{ price: { id: 'price_standard' } }] } });
  });

  it('署名が違えば 400、設定が無ければ 503', async () => {
    expect((await webhook(completed(), { secret: 'wrong' })).status).toBe(400);
    expect((await webhook(completed(), { env: { STRIPE_BILLING_WEBHOOK_SECRET: undefined } })).status).toBe(503);
    expect(tenantRow().plan_status).toBe('trialing');
  });

  it('申込が完了すると契約中になり、プランは Stripe の価格から決まる', async () => {
    const res = await webhook(completed());
    expect(res.status).toBe(200);
    expect(tenantRow()).toMatchObject({ plan_status: 'active', plan_key: 'standard', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', trial_ends_at: null });
  });

  it('active のあとに incomplete の作成通知が届いても契約中を保つ', async () => {
    await webhook(completed());
    stripe.retrieveSubscription.mockRejectedValueOnce(new Error('temporary Stripe failure'));

    await webhook({
      id: 'evt_incomplete_after_active',
      type: 'customer.subscription.created',
      data: { object: { id: 'sub_1', status: 'incomplete', customer: 'cus_1', items: { data: [{ price: { id: 'price_standard' } }] } } },
    });

    expect(tenantRow()).toMatchObject({ plan_status: 'active', plan_key: 'standard', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' });
  });

  it('作成通知が incomplete でも Stripe の現在値が active なら契約中にする', async () => {
    setTenant({ stripe_customer_id: 'cus_1' });
    stripe.retrieveSubscription.mockResolvedValueOnce({
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      current_period_end: 1_760_000_000,
      items: { data: [{ price: { id: 'price_standard' } }] },
    });

    await webhook({
      id: 'evt_retrieve_active',
      type: 'customer.subscription.created',
      data: { object: { id: 'sub_1', status: 'incomplete', customer: 'cus_1', items: { data: [{ price: { id: 'price_standard' } }] } } },
    });

    expect(stripe.retrieveSubscription).toHaveBeenCalledWith(expect.anything(), 'sub_1');
    expect(tenantRow()).toMatchObject({ plan_status: 'active', plan_key: 'standard' });
  });

  it('明細の current_period_end から次回更新日を記録する', async () => {
    setTenant({ stripe_customer_id: 'cus_1' });
    stripe.retrieveSubscription.mockResolvedValueOnce({
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      items: { data: [{ price: { id: 'price_standard' }, current_period_end: 1_760_000_000 }] },
    });

    await webhook({
      id: 'evt_item_period_end',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', items: { data: [{ price: { id: 'price_standard' } }] } } },
    });

    expect(tenantRow().current_period_ends_at).toBe(new Date(1_760_000_000 * 1000).toISOString());
  });

  it('同じイベントは二度処理しない', async () => {
    await webhook(completed());
    stripe.retrieveSubscription.mockClear();
    const res = await webhook(completed());
    expect((await res.json<{ data: { duplicate: boolean } }>()).data.duplicate).toBe(true);
    expect(stripe.retrieveSubscription).not.toHaveBeenCalled();
  });

  it('解約・支払い失敗・支払い成功で状態が動く', async () => {
    await webhook(completed());
    await webhook({ id: 'evt_2', type: 'invoice.payment_failed', data: { object: { id: 'in_1', customer: 'cus_1' } } });
    expect(tenantRow().plan_status).toBe('past_due');
    await webhook({ id: 'evt_3', type: 'invoice.paid', data: { object: { id: 'in_2', customer: 'cus_1' } } });
    expect(tenantRow().plan_status).toBe('active');
    await webhook({ id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', items: { data: [{ price: { id: 'price_standard' } }] } } } });
    expect(tenantRow().plan_status).toBe('canceled');
    const summary = (await (await call('GET', '/api/hq/billing/summary')).json<{ data: { canSend: boolean; state: string } }>()).data;
    expect(summary).toMatchObject({ state: 'canceled', canSend: false });
  });

  it('知らない顧客のイベントは受け取るだけで何も変えない', async () => {
    const res = await webhook({ id: 'evt_9', type: 'customer.subscription.updated', data: { object: { id: 'sub_x', status: 'active', customer: 'cus_unknown', items: { data: [] } } } });
    expect((await res.json<{ data: { matched: boolean } }>()).data.matched).toBe(false);
    expect(tenantRow().plan_status).toBe('trialing');
  });
});
