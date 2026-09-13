/**
 * Stripe の API を呼ぶ小さな道具。SDK は使わず fetch で叩く（Workers で軽く保つ）。
 *
 * 鍵は `STRIPE_SECRET_KEY`（secret）。ここには値を書かない。
 * 送る形は Stripe の決まり（application/x-www-form-urlencoded、入れ子は `a[b]`）。
 */

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
}

export class StripeApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'StripeApiError';
    this.status = status;
    this.code = code;
  }
}

type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

/** 入れ子のオブジェクトを `a[b][0]=x` の形にする。 */
export function encodeForm(input: Record<string, FormValue>): string {
  const params = new URLSearchParams();
  const walk = (prefix: string, value: FormValue) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(`${prefix}[${index}]`, item));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) walk(`${prefix}[${key}]`, inner);
      return;
    }
    params.set(prefix, String(value));
  };
  for (const [key, value] of Object.entries(input)) walk(key, value);
  return params.toString();
}

export async function stripeRequest<T>(
  env: StripeEnv,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, FormValue>,
  options: { idempotencyKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new StripeApiError(503, 'Stripe の接続設定がまだありません', 'not_configured');
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${env.STRIPE_SECRET_KEY}:`)}`,
    'Stripe-Version': '2024-06-20',
  };
  let url = `https://api.stripe.com${path}`;
  let payload: string | undefined;
  if (method === 'GET') {
    if (body) url += `?${encodeForm(body)}`;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = body ? encodeForm(body) : '';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  }
  const res = await fetchImpl(url, { method, headers, body: payload });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const error = (json as { error?: { message?: string; code?: string } } | null)?.error;
    throw new StripeApiError(res.status, error?.message ?? `Stripe error ${res.status}`, error?.code ?? null);
  }
  return json as T;
}

export interface StripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
  subscription: string | null;
  client_reference_id: string | null;
  metadata?: Record<string, string>;
}

export interface StripePortalSession {
  id: string;
  url: string;
}

export interface StripePrice {
  id: string;
  unit_amount: number | null;
  currency: string;
  recurring?: { interval: string } | null;
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
  items: { data: Array<{ price: { id: string } }> };
}

export interface StripeInvoice {
  id: string;
  number: string | null;
  status: string | null;
  amount_paid: number;
  amount_due: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  lines?: { data: Array<{ description: string | null }> };
}

export const stripeApi = {
  createCustomer: (env: StripeEnv, input: { name: string; email: string | null; tenantId: string }, fetchImpl?: typeof fetch) =>
    stripeRequest<StripeCustomer>(env, 'POST', '/v1/customers', {
      name: input.name,
      email: input.email,
      metadata: { tenant_id: input.tenantId },
    }, { fetchImpl, idempotencyKey: `customer-${input.tenantId}` }),

  createCheckoutSession: (
    env: StripeEnv,
    input: { customerId: string; priceId: string; tenantId: string; planKey: string; successUrl: string; cancelUrl: string },
    fetchImpl?: typeof fetch,
  ) =>
    stripeRequest<StripeCheckoutSession>(env, 'POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      customer: input.customerId,
      client_reference_id: input.tenantId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: true,
      locale: 'ja',
      metadata: { tenant_id: input.tenantId, plan_key: input.planKey },
      subscription_data: { metadata: { tenant_id: input.tenantId, plan_key: input.planKey } },
    }, { fetchImpl }),

  createPortalSession: (env: StripeEnv, input: { customerId: string; returnUrl: string }, fetchImpl?: typeof fetch) =>
    stripeRequest<StripePortalSession>(env, 'POST', '/v1/billing_portal/sessions', {
      customer: input.customerId,
      return_url: input.returnUrl,
      locale: 'ja',
    }, { fetchImpl }),

  retrievePrice: (env: StripeEnv, priceId: string, fetchImpl?: typeof fetch) =>
    stripeRequest<StripePrice>(env, 'GET', `/v1/prices/${encodeURIComponent(priceId)}`, undefined, { fetchImpl }),

  retrieveSubscription: (env: StripeEnv, subscriptionId: string, fetchImpl?: typeof fetch) =>
    stripeRequest<StripeSubscription>(env, 'GET', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, undefined, { fetchImpl }),

  listInvoices: (env: StripeEnv, customerId: string, limit = 12, fetchImpl?: typeof fetch) =>
    stripeRequest<{ data: StripeInvoice[] }>(env, 'GET', '/v1/invoices', { customer: customerId, limit }, { fetchImpl }),
};
