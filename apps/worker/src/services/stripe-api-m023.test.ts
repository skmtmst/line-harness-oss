import { describe, expect, test } from 'vitest';
import { StripeApiError, stripeRequest } from './stripe-api.js';

/**
 * M023：Stripe への輸送失敗（到達不能）が汎用 500 の内部文になる。
 * fetch 自体の throw を StripeApiError（502）で包み、
 * 口側の 502 日本語案内へ載せる。
 */
describe('M023 Stripe 輸送失敗の包み', () => {
  test('fetch が投げたら StripeApiError(502) になる', async () => {
    const failingFetch = async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    };
    const error = await stripeRequest(
      { STRIPE_SECRET_KEY: 'sk-test' },
      'GET',
      '/v1/prices/price_1',
      undefined,
      { fetchImpl: failingFetch as typeof fetch },
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StripeApiError);
    expect((error as StripeApiError).status).toBe(502);
    expect((error as Error).message).toContain('決済サービスにつながりませんでした');
  });

  test('HTTP 応答の失敗は今までどおり状態番号を保つ', async () => {
    const badFetch = async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid API Key', code: 'invalid_api_key' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    const error = await stripeRequest(
      { STRIPE_SECRET_KEY: 'sk-test' },
      'GET',
      '/v1/prices/price_1',
      undefined,
      { fetchImpl: badFetch as typeof fetch },
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StripeApiError);
    expect((error as StripeApiError).status).toBe(401);
  });
});
