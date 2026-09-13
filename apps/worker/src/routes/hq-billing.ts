import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getStaffById,
  getTenantBilling,
  getTenantBillingByStripeCustomer,
  recordBillingEvent,
  updateTenantBilling,
  type TenantBilling,
  type TenantPlanStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  BILLING_PLANS,
  DATA_RETENTION_DAYS,
  TRIAL_MONTHLY_IMAGES,
  findPlan,
  formatJstMonthDay,
  planKeyForPrice,
  priceIdForPlan,
  resolveEntitlements,
  type PlanKey,
} from '../services/billing-plans.js';
import { StripeApiError, stripeApi, type StripeSubscription } from '../services/stripe-api.js';
import { MAX_STRIPE_WEBHOOK_BODY_BYTES, readBodyWithinLimit, verifyStripeSignature } from '../services/stripe-signature.js';

/**
 * 統括の課金（★V6 36-2）。Stripe のサブスクリプション。
 *
 * - `summary`: いまの契約状態とプラン一覧（金額は Stripe の価格が取れればそちら）
 * - `checkout`: Stripe Checkout（申込画面）の URL を作る。オーナーだけ
 * - `portal`: 支払い方法・解約は Stripe のカスタマーポータルに任せる
 * - `invoices`: 支払い履歴（Stripe から読む）
 * - `webhook`: Stripe からの通知。署名で確かめ、イベントIDで二度処理しない
 *
 * 鍵と価格IDは env（`STRIPE_SECRET_KEY`、`STRIPE_BILLING_WEBHOOK_SECRET`、`STRIPE_PRICE_*`）。
 * 値はここにも Git にも書かない。
 */
export const hqBilling = new Hono<Env>();

function tenantOf(c: Context<Env>): string {
  return c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
}

function exemptMonthlyImages(c: Context<Env>): number | undefined {
  const raw = Number(c.env.BANNER_MONTHLY_IMAGES ?? '');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : undefined;
}

/** 管理画面の URL。Checkout から戻る先に使う。`ADMIN_ORIGIN` の先頭。 */
function adminOrigin(c: Context<Env>): string | null {
  const first = (c.env.ADMIN_ORIGIN ?? '').split(',').map((s) => s.trim()).find(Boolean);
  return first ?? null;
}

function stripeReady(c: Context<Env>): boolean {
  return Boolean(c.env.STRIPE_SECRET_KEY);
}

export function mapStripeSubscriptionStatus(status: string): TenantPlanStatus | null {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'incomplete':
      return null;
    default:
      // canceled / incomplete_expired / paused
      return 'canceled';
  }
}

function periodEndIso(subscription: Pick<StripeSubscription, 'current_period_end' | 'items'>): string | null {
  const periodEnd = subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  return periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
}

async function applySubscription(c: Context<Env>, tenant: TenantBilling, subscription: StripeSubscription): Promise<TenantBilling | null> {
  if (subscription.status === 'incomplete') {
    return updateTenantBilling(c.env.DB, tenant.id, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer,
    });
  }
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  const planKey = planKeyForPrice(c.env, priceId) ?? (subscription.metadata?.plan_key as PlanKey | undefined) ?? tenant.plan_key;
  const planStatus = mapStripeSubscriptionStatus(subscription.status);
  return updateTenantBilling(c.env.DB, tenant.id, {
    plan_key: planKey ?? null,
    plan_status: planStatus ?? tenant.plan_status,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: subscription.customer,
    current_period_ends_at: periodEndIso(subscription),
    trial_ends_at: null,
  });
}

// ================================================================ summary

hqBilling.get('/api/hq/billing/summary', async (c) => {
  try {
    const tenantId = tenantOf(c);
    const billing = await getTenantBilling(c.env.DB, tenantId);
    if (!billing) return c.json({ success: false, error: '統括が見つかりません' }, 404);
    const entitlements = resolveEntitlements(billing, { exemptMonthlyImages: exemptMonthlyImages(c) });

    // 金額は Stripe の価格が正本。取れなければ仮の表示。
    const prices = await Promise.all(
      BILLING_PLANS.map(async (plan) => {
        const priceId = priceIdForPlan(c.env, plan.key);
        if (!priceId || !stripeReady(c)) return null;
        try {
          const price = await stripeApi.retrievePrice(c.env, priceId);
          return price.unit_amount ?? null;
        } catch {
          return null;
        }
      }),
    );

    return c.json({
      success: true,
      data: {
        state: entitlements.state,
        planKey: billing.plan_key,
        planName: entitlements.plan?.name ?? null,
        planStatus: billing.plan_status,
        trialEndsAt: billing.trial_ends_at,
        trialEndsLabel: formatJstMonthDay(billing.trial_ends_at),
        trialDaysLeft: entitlements.trialDaysLeft,
        trialMonthlyImages: TRIAL_MONTHLY_IMAGES,
        currentPeriodEndsAt: billing.current_period_ends_at,
        currentPeriodEndsLabel: formatJstMonthDay(billing.current_period_ends_at),
        canSend: entitlements.canSend,
        canGenerate: entitlements.canGenerate,
        blockedReason: entitlements.blockedReason,
        dataRetentionDays: DATA_RETENTION_DAYS,
        stripeReady: stripeReady(c),
        portalAvailable: stripeReady(c) && Boolean(billing.stripe_customer_id),
        plans: BILLING_PLANS.map((plan, index) => ({
          key: plan.key,
          name: plan.name,
          description: plan.description,
          cta: plan.cta,
          monthlyYen: prices[index] ?? plan.fallbackMonthlyYen,
          priceFromStripe: prices[index] !== null,
          monthlyImages: plan.monthlyImages,
          maxStaff: plan.maxStaff,
          features: plan.features,
          recommended: Boolean(plan.recommended),
          available: stripeReady(c) && Boolean(priceIdForPlan(c.env, plan.key)),
          current: billing.plan_key === plan.key && (billing.plan_status === 'active' || billing.plan_status === 'past_due'),
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/hq/billing/summary error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ================================================================ checkout

hqBilling.post('/api/hq/billing/checkout', requireRole('owner'), async (c) => {
  try {
    const tenantId = tenantOf(c);
    const body = await c.req.json<{ planKey?: string }>().catch(() => ({} as { planKey?: string }));
    const plan = findPlan(body.planKey);
    if (!plan) return c.json({ success: false, error: 'プランを選んでください' }, 400);
    if (!stripeReady(c)) return c.json({ success: false, error: '決済の接続設定がまだありません。運営にお問い合わせください' }, 503);
    const priceId = priceIdForPlan(c.env, plan.key);
    if (!priceId) return c.json({ success: false, error: 'このプランの価格がまだ設定されていません。運営にお問い合わせください' }, 503);
    const origin = adminOrigin(c);
    if (!origin) return c.json({ success: false, error: '管理画面のURLが設定されていないため、申込画面へ進めません' }, 503);

    const billing = await getTenantBilling(c.env.DB, tenantId);
    if (!billing) return c.json({ success: false, error: '統括が見つかりません' }, 404);
    if (billing.plan_status === 'exempt') {
      return c.json({ success: false, error: 'この統括は課金の対象外です' }, 409);
    }
    if (billing.stripe_subscription_id && (billing.plan_status === 'active' || billing.plan_status === 'past_due')) {
      return c.json({ success: false, error: 'すでに契約中です。プランの変更や解約は「支払い方法を管理」から行ってください' }, 409);
    }

    let customerId = billing.stripe_customer_id;
    if (!customerId) {
      const staff = c.get('staff');
      const member = staff?.id ? await getStaffById(c.env.DB, staff.id).catch(() => null) : null;
      const customer = await stripeApi.createCustomer(c.env, { name: billing.name, email: member?.email ?? null, tenantId });
      customerId = customer.id;
      await updateTenantBilling(c.env.DB, tenantId, { stripe_customer_id: customerId });
    }

    const session = await stripeApi.createCheckoutSession(c.env, {
      customerId,
      priceId,
      tenantId,
      planKey: plan.key,
      successUrl: `${origin}/hq/billing?checkout=success`,
      cancelUrl: `${origin}/hq/billing?checkout=cancel`,
    });
    if (!session.url) return c.json({ success: false, error: '申込画面のURLを作れませんでした' }, 502);
    return c.json({ success: true, data: { url: session.url } });
  } catch (err) {
    if (err instanceof StripeApiError) {
      console.warn('billing checkout stripe error:', err.status, err.code);
      return c.json({ success: false, error: '決済サービスに接続できませんでした。時間をおいてもう一度お試しください' }, 502);
    }
    console.error('POST /api/hq/billing/checkout error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ================================================================ portal

hqBilling.post('/api/hq/billing/portal', requireRole('owner', 'admin'), async (c) => {
  try {
    const billing = await getTenantBilling(c.env.DB, tenantOf(c));
    if (!billing?.stripe_customer_id || !stripeReady(c)) {
      return c.json({ success: false, error: 'まだ契約がないため、支払い方法の管理画面はありません' }, 409);
    }
    const origin = adminOrigin(c);
    if (!origin) return c.json({ success: false, error: '管理画面のURLが設定されていません' }, 503);
    const session = await stripeApi.createPortalSession(c.env, { customerId: billing.stripe_customer_id, returnUrl: `${origin}/hq/billing` });
    return c.json({ success: true, data: { url: session.url } });
  } catch (err) {
    if (err instanceof StripeApiError) {
      return c.json({ success: false, error: '決済サービスに接続できませんでした。時間をおいてもう一度お試しください' }, 502);
    }
    console.error('POST /api/hq/billing/portal error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ================================================================ invoices

hqBilling.get('/api/hq/billing/invoices', requireRole('owner', 'admin'), async (c) => {
  try {
    const billing = await getTenantBilling(c.env.DB, tenantOf(c));
    if (!billing?.stripe_customer_id || !stripeReady(c)) return c.json({ success: true, data: [] });
    const invoices = await stripeApi.listInvoices(c.env, billing.stripe_customer_id, 12);
    return c.json({
      success: true,
      data: invoices.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amountYen: inv.status === 'paid' ? inv.amount_paid : inv.amount_due,
        currency: inv.currency,
        createdAt: new Date(inv.created * 1000).toISOString(),
        description: inv.lines?.data?.[0]?.description ?? null,
        hostedUrl: inv.hosted_invoice_url,
        pdfUrl: inv.invoice_pdf,
      })),
    });
  } catch (err) {
    if (err instanceof StripeApiError) {
      return c.json({ success: false, error: '支払い履歴を取得できませんでした。時間をおいてもう一度お試しください' }, 502);
    }
    console.error('GET /api/hq/billing/invoices error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ================================================================ webhook

interface BillingWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

async function findTenantForEvent(c: Context<Env>, object: Record<string, unknown>): Promise<TenantBilling | null> {
  const metadata = (object.metadata ?? {}) as Record<string, string>;
  const byMeta = metadata.tenant_id ?? (typeof object.client_reference_id === 'string' ? object.client_reference_id : null);
  if (byMeta) {
    const tenant = await getTenantBilling(c.env.DB, byMeta);
    if (tenant) return tenant;
  }
  const customer = typeof object.customer === 'string' ? object.customer : null;
  return customer ? getTenantBillingByStripeCustomer(c.env.DB, customer) : null;
}

hqBilling.post('/api/hq/billing/webhook', async (c) => {
  const secret = c.env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!secret) return c.json({ success: false, error: 'Webhook is not configured' }, 503);
  const declaredLength = Number(c.req.header('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_STRIPE_WEBHOOK_BODY_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }
  const rawBody = await readBodyWithinLimit(c.req.raw);
  if (rawBody === null) return c.json({ success: false, error: 'Payload too large' }, 413);
  const signature = c.req.header('stripe-signature') ?? '';
  if (!(await verifyStripeSignature(secret, rawBody, signature))) {
    return c.json({ success: false, error: 'Invalid signature' }, 400);
  }

  let event: BillingWebhookEvent;
  try {
    event = JSON.parse(rawBody) as BillingWebhookEvent;
  } catch {
    return c.json({ success: false, error: 'Invalid payload' }, 400);
  }
  if (!event?.id || !event.type || !event.data?.object) return c.json({ success: false, error: 'Invalid payload' }, 400);

  try {
    const object = event.data.object;
    const tenant = await findTenantForEvent(c, object);
    const first = await recordBillingEvent(c.env.DB, { id: event.id, type: event.type, tenantId: tenant?.id ?? null, summary: event.type });
    if (!first) return c.json({ success: true, data: { received: true, duplicate: true } });
    if (!tenant) {
      console.warn('billing webhook: tenant not found for event', event.type);
      return c.json({ success: true, data: { received: true, matched: false } });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const subscriptionId = typeof object.subscription === 'string' ? object.subscription : null;
        const customerId = typeof object.customer === 'string' ? object.customer : tenant.stripe_customer_id;
        const metadata = (object.metadata ?? {}) as Record<string, string>;
        let applied = false;
        if (subscriptionId && stripeReady(c)) {
          try {
            const subscription = await stripeApi.retrieveSubscription(c.env, subscriptionId);
            await applySubscription(c, tenant, subscription);
            applied = true;
          } catch (error) {
            console.warn('billing webhook: subscription fetch failed', error instanceof Error ? error.message : error);
          }
        }
        if (!applied) {
          await updateTenantBilling(c.env.DB, tenant.id, {
            plan_key: findPlan(metadata.plan_key)?.key ?? tenant.plan_key,
            plan_status: 'active',
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            trial_ends_at: null,
          });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const payload = object as unknown as StripeSubscription;
        let subscription = payload;
        if (stripeReady(c)) {
          try {
            subscription = await stripeApi.retrieveSubscription(c.env, payload.id);
          } catch (error) {
            console.warn('billing webhook: subscription fetch failed', error instanceof Error ? error.message : error);
          }
        }
        await applySubscription(c, tenant, subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        await applySubscription(c, tenant, { ...(object as unknown as StripeSubscription), status: 'canceled' });
        break;
      }
      case 'invoice.paid': {
        if (tenant.plan_status === 'past_due') await updateTenantBilling(c.env.DB, tenant.id, { plan_status: 'active' });
        break;
      }
      case 'invoice.payment_failed': {
        if (tenant.plan_status === 'active') await updateTenantBilling(c.env.DB, tenant.id, { plan_status: 'past_due' });
        break;
      }
      default:
        break;
    }
    return c.json({ success: true, data: { received: true } });
  } catch (err) {
    console.error('POST /api/hq/billing/webhook error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
