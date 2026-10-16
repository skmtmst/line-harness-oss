import type { Env } from '../index.js';

export const STRIPE_CONNECT_CALLBACK = '/api/booking/admin/payment-connection/callback';
export class StripeConnectError extends Error {
  constructor(public code: string) { super(code); }
}

/** 予約専用のtest secretだけを使う。統括課金のSTRIPE_SECRET_KEYへフォールバックしない。 */
export function stripeConnectConfig(env: Env['Bindings']) {
  const key = env.BOOKING_STRIPE_TEST_SECRET_KEY;
  const clientId = env.BOOKING_STRIPE_TEST_CLIENT_ID;
  if (!key || !clientId || !env.BOOKING_STRIPE_CONNECT_REDIRECT_URI) throw new StripeConnectError('stripe_connect_not_ready');
  if (!/^sk_test_[A-Za-z0-9]+$/.test(key) || !/^ca_[A-Za-z0-9]+$/.test(clientId)) throw new StripeConnectError('stripe_connect_test_only');
  let redirect: URL;
  try { redirect = new URL(env.BOOKING_STRIPE_CONNECT_REDIRECT_URI); }
  catch { throw new StripeConnectError('stripe_connect_not_ready'); }
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash
    || redirect.pathname !== STRIPE_CONNECT_CALLBACK) throw new StripeConnectError('stripe_connect_not_ready');
  return { key, clientId, redirectUri: redirect.href };
}

export async function connectHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** URL・生の例外・Stripeのerror_descriptionを外へ出さない。再試行はしない。 */
async function stripeOAuth(config: ReturnType<typeof stripeConnectConfig>, operation: 'token' | 'deauthorize', values: Record<string, string>) {
  try {
    const response = await fetch(`https://connect.stripe.com/oauth/${operation}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Basic ${btoa(config.key + ':')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString(),
    });
    if (!response.ok) throw new StripeConnectError('stripe_connect_provider_failed');
    const data = await response.json() as Record<string, unknown>;
    if (data.error) throw new StripeConnectError('stripe_connect_provider_failed');
    return data;
  } catch { throw new StripeConnectError('stripe_connect_provider_failed'); }
}

export async function exchangeStripeConnectCode(config: ReturnType<typeof stripeConnectConfig>, code: string) {
  const data = await stripeOAuth(config, 'token', { grant_type: 'authorization_code', code });
  if (data.livemode !== false) throw new StripeConnectError('stripe_connect_test_only');
  if (data.scope !== 'read_write' || typeof data.stripe_user_id !== 'string' || !/^acct_[A-Za-z0-9]{1,240}$/.test(data.stripe_user_id)) {
    throw new StripeConnectError('stripe_connect_invalid_response');
  }
  // access_token/refresh_tokenは使わない・保存しない。
  return data.stripe_user_id;
}

export async function revokeStripeConnect(config: ReturnType<typeof stripeConnectConfig>, account: string) {
  const data = await stripeOAuth(config, 'deauthorize', { client_id: config.clientId, stripe_user_id: account });
  if (data.stripe_user_id !== account) throw new StripeConnectError('stripe_connect_invalid_response');
}
