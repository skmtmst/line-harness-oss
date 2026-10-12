import { describe, expect, it } from 'vitest';
import {
  UBER_OPERATION_SCOPES,
  UberEatsError,
  activatePosIntegration,
  buildAuthorizeUrl,
  deactivatePosIntegration,
  exchangeAuthorizationCode,
  fetchApplicationToken,
  fetchPosData,
  listStores,
  setPosIntegrationEnabled,
  tokenNeedsRenewal,
  verifyWebhookSignature,
  webhookSignatureFor,
  type FetchLike,
} from './uber-eats.js';

/**
 * Uber Eats POS API の通信の層（公式仕様に合わせた形）の試験。
 * 試験用の値はすべて作り物で、本物のID・秘密値は置かない。
 */

const client = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://stg-api.example.test/api/restaurant-test/delivery/ubereats/oauth/callback',
};

const NOW_MS = 1_760_000_000_000;
const THIRTY_DAYS_MS = 2_592_000 * 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fetchFrom(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  fetch: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

const noSleep = async () => {};

function formOf(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ''));
}

describe('Uber Eats の認可', () => {
  it('認可URLは店舗の連携用の権限と state を持つ', () => {
    const url = new URL(buildAuthorizeUrl({ clientId: client.clientId, redirectUri: client.redirectUri, state: 'st-1' }));

    expect(url.origin + url.pathname).toBe('https://auth.uber.com/oauth/v2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('eats.pos_provisioning');
    expect(url.searchParams.get('client_id')).toBe(client.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(client.redirectUri);
    expect(url.searchParams.get('state')).toBe('st-1');
  });

  it('戻ってきた符号をトークンに替える。期限は30日で、更新用のトークンは使わない', async () => {
    const { fetch, calls } = fetchFrom(() =>
      jsonResponse({
        access_token: 'access-1',
        token_type: 'Bearer',
        expires_in: 2_592_000,
        scope: 'eats.pos_provisioning',
        refresh_token: '',
      }),
    );

    const token = await exchangeAuthorizationCode({ client, code: 'code-1', fetch, nowMs: NOW_MS });

    expect(calls[0].url).toBe('https://auth.uber.com/oauth/v2/token');
    const form = formOf(calls[0].init);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('code-1');
    expect(form.get('redirect_uri')).toBe(client.redirectUri);
    expect(form.get('client_id')).toBe(client.clientId);
    expect(token.accessToken).toBe('access-1');
    expect(token.scope).toEqual(['eats.pos_provisioning']);
    expect(token.expiresAtMs).toBe(NOW_MS + THIRTY_DAYS_MS);
    expect(Object.keys(token)).not.toContain('refreshToken');
  });

  it('許された権限が足りないときは権限不足として止める', async () => {
    const { fetch } = fetchFrom(() =>
      jsonResponse({ access_token: 'access-1', expires_in: 2_592_000, scope: 'eats.store' }),
    );

    await expect(exchangeAuthorizationCode({ client, code: 'code-1', fetch, nowMs: NOW_MS })).rejects.toMatchObject({
      kind: 'no_permission',
    });
  });

  it('連携済みの店舗を動かすトークンは店舗側の操作なしで取り直せる', async () => {
    const { fetch, calls } = fetchFrom(() =>
      jsonResponse({ access_token: 'access-2', expires_in: 2_592_000, scope: UBER_OPERATION_SCOPES.join(' ') }),
    );

    const token = await fetchApplicationToken({ client, fetch, nowMs: NOW_MS });

    const form = formOf(calls[0].init);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('scope')).toBe('eats.store eats.store.status.write eats.order eats.store.orders.read');
    // 認可画面側の権限は混ぜない。
    expect(form.get('scope')).not.toContain('eats.pos_provisioning');
    expect(token.accessToken).toBe('access-2');
  });

  it('期限が無い応答でも30日として扱う', async () => {
    const { fetch } = fetchFrom(() => jsonResponse({ access_token: 'access-3', scope: 'eats.store' }));

    const token = await fetchApplicationToken({ client, fetch, scopes: ['eats.store'], nowMs: NOW_MS });

    expect(token.expiresAtMs).toBe(NOW_MS + THIRTY_DAYS_MS);
  });

  it('トークンの口の失敗は種類別に分け、自由文は残さない', async () => {
    const cases: Array<{ status: number; error: string; kind: string }> = [
      { status: 401, error: 'invalid_client', kind: 'auth_expired' },
      { status: 400, error: 'invalid_grant', kind: 'auth_expired' },
      { status: 400, error: 'invalid_scope', kind: 'no_permission' },
      { status: 429, error: 'rate_limited', kind: 'rate_limited' },
      { status: 503, error: 'server_error', kind: 'unavailable' },
    ];

    for (const testCase of cases) {
      const { fetch } = fetchFrom(() =>
        jsonResponse({ error: testCase.error, error_description: '店舗名 山田太郎 さまの申請' }, testCase.status),
      );
      const error = await fetchApplicationToken({ client, fetch, nowMs: NOW_MS }).catch((caught) => caught);
      expect(error).toBeInstanceOf(UberEatsError);
      expect((error as UberEatsError).kind).toBe(testCase.kind);
      expect((error as UberEatsError).message).toBe(`uber_token_${testCase.error}`);
      expect((error as UberEatsError).message).not.toContain('山田');
    }
  });

  it('期限の3日前から取り直す', () => {
    expect(tokenNeedsRenewal(NOW_MS + THIRTY_DAYS_MS, NOW_MS)).toBe(false);
    expect(tokenNeedsRenewal(NOW_MS + 4 * 24 * 60 * 60 * 1000, NOW_MS)).toBe(false);
    expect(tokenNeedsRenewal(NOW_MS + 2 * 24 * 60 * 60 * 1000, NOW_MS)).toBe(true);
    expect(tokenNeedsRenewal(NOW_MS - 1, NOW_MS)).toBe(true);
    expect(tokenNeedsRenewal(null, NOW_MS)).toBe(true);
  });
});

describe('Uber Eats の店舗と連携の状態', () => {
  const options = (fetch: FetchLike) => ({ fetch, accessToken: 'access-1', sleep: noSleep });

  it('店舗の一覧を画面で使える形に直す', async () => {
    const { fetch, calls } = fetchFrom(() =>
      jsonResponse({
        stores: [
          {
            store_id: 'uber-store-1',
            name: '渋谷店',
            external_store_id: 'shibuya-1',
            location: { address: '東京都渋谷区道玄坂1-2-3', city: '渋谷区', postal_code: '150-0043', country: 'JP' },
          },
          { store_id: 'uber-store-2' },
          { name: '番号のない店舗' },
        ],
      }),
    );

    const stores = await listStores(options(fetch));

    expect(calls[0].url).toBe('https://api.uber.com/v1/eats/stores');
    expect(String((calls[0].init?.headers as Record<string, string>).authorization)).toBe('Bearer access-1');
    expect(stores).toHaveLength(2);
    expect(stores[0]).toEqual({
      storeId: 'uber-store-1',
      name: '渋谷店',
      externalStoreId: 'shibuya-1',
      location: { address: '東京都渋谷区道玄坂1-2-3', city: '渋谷区', postalCode: '150-0043', country: 'JP' },
    });
    // 名前が無いときは番号で出す（空欄の行を作らない）。
    expect(stores[1]).toEqual({ storeId: 'uber-store-2', name: 'uber-store-2', externalStoreId: null, location: null });
  });

  it('利用制限と一時的な不調は間を置いて試し直す', async () => {
    let attempt = 0;
    const { fetch, calls } = fetchFrom(() => {
      attempt += 1;
      if (attempt === 1) return new Response('', { status: 429 });
      if (attempt === 2) return new Response('', { status: 503 });
      return jsonResponse({ stores: [] });
    });

    await expect(listStores(options(fetch))).resolves.toEqual([]);
    expect(calls).toHaveLength(3);
  });

  it('権限と認可の失敗は試し直さない', async () => {
    for (const testCase of [
      { status: 401, kind: 'auth_expired' },
      { status: 403, kind: 'no_permission' },
      { status: 404, kind: 'not_found' },
      { status: 400, kind: 'invalid_request' },
    ]) {
      const { fetch, calls } = fetchFrom(() => new Response('', { status: testCase.status }));
      const error = await listStores(options(fetch)).catch((caught) => caught);
      expect((error as UberEatsError).kind).toBe(testCase.kind);
      expect(calls).toHaveLength(1);
    }
  });

  it('連携の有効化は本文なしの200でも成功として扱い、二重には送らない', async () => {
    const { fetch, calls } = fetchFrom(() => new Response('', { status: 200 }));

    await activatePosIntegration(options(fetch), 'uber-store-1', {
      integratorStoreId: 'store-1',
      isOrderManager: true,
    });

    expect(calls[0].url).toBe('https://api.uber.com/v1/eats/stores/uber-store-1/pos_data');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ integrator_store_id: 'store-1', is_order_manager: true });

    const failing = fetchFrom(() => new Response('', { status: 503 }));
    await expect(activatePosIntegration(options(failing.fetch), 'uber-store-1')).rejects.toMatchObject({
      kind: 'unavailable',
    });
    expect(failing.calls).toHaveLength(1);
  });

  it('連携の今の状態を読む', async () => {
    const { fetch } = fetchFrom(() =>
      jsonResponse({
        integration_enabled: true,
        integrator_store_id: 'store-1',
        order_manager_client_id: 'manager-1',
        is_order_manager_pending: false,
        online_status: 'ONLINE',
      }),
    );

    await expect(fetchPosData(options(fetch), 'uber-store-1')).resolves.toEqual({
      integrationEnabled: true,
      integratorStoreId: 'store-1',
      orderManagerClientId: 'manager-1',
      isOrderManagerPending: false,
      onlineStatus: 'ONLINE',
    });
  });

  it('一時停止と解除はそれぞれの動詞で送る', async () => {
    const paused = fetchFrom(() => new Response(null, { status: 204 }));
    await setPosIntegrationEnabled(options(paused.fetch), 'uber-store-1', false);
    expect(paused.calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(String(paused.calls[0].init?.body))).toEqual({ integration_enabled: false });

    const removed = fetchFrom(() => new Response(null, { status: 204 }));
    await deactivatePosIntegration(options(removed.fetch), 'uber-store-1');
    expect(removed.calls[0].init?.method).toBe('DELETE');
  });

  it('店舗番号に記号が入っていてもURLを壊さない', async () => {
    const { fetch, calls } = fetchFrom(() => jsonResponse({ integration_enabled: false }));

    await fetchPosData(options(fetch), 'store/../other');

    expect(calls[0].url).toBe('https://api.uber.com/v1/eats/stores/store%2F..%2Fother/pos_data');
  });
});

describe('Uber Eats からの通知の署名', () => {
  const rawBody = JSON.stringify({ event_type: 'orders.notification', meta: { resource_id: 'order-1' } });

  it('本文の署名が合えば受け取る', async () => {
    const signature = await webhookSignatureFor(client.clientSecret, rawBody);

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyWebhookSignature({ clientSecret: client.clientSecret, rawBody, signature })).resolves.toBe(true);
    // 大文字で届いても同じものとして扱う。
    await expect(
      verifyWebhookSignature({ clientSecret: client.clientSecret, rawBody, signature: signature.toUpperCase() }),
    ).resolves.toBe(true);
  });

  it('本文・鍵・署名のどれかが違えば受け取らない', async () => {
    const signature = await webhookSignatureFor(client.clientSecret, rawBody);

    await expect(
      verifyWebhookSignature({ clientSecret: client.clientSecret, rawBody: `${rawBody} `, signature }),
    ).resolves.toBe(false);
    await expect(verifyWebhookSignature({ clientSecret: 'other-secret', rawBody, signature })).resolves.toBe(false);
    await expect(
      verifyWebhookSignature({ clientSecret: client.clientSecret, rawBody, signature: signature.slice(0, -1) }),
    ).resolves.toBe(false);
    await expect(verifyWebhookSignature({ clientSecret: client.clientSecret, rawBody, signature: null })).resolves.toBe(
      false,
    );
    await expect(verifyWebhookSignature({ clientSecret: '', rawBody, signature })).resolves.toBe(false);
  });
});
