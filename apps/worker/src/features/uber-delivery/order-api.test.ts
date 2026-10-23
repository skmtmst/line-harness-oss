import { describe, expect, it, vi } from 'vitest';
import { UberEatsError } from '../../services/uber-eats.js';
import { UBER_PRODUCTION_HOSTS } from '../../services/uber-eats-hosts.js';
import { getUberOrder, sendUberOrderAction, type UberOrderApiOptions } from './order-api.js';

function options(fetch: UberOrderApiOptions['fetch']): UberOrderApiOptions {
  return { hosts: UBER_PRODUCTION_HOSTS, accessToken: 'test-access-token', fetch };
}

describe('Uber注文API', () => {
  it('設定済みホストの固定v2経路から注文を1回だけ取得し、redirectを追わない', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-access-token');
      return Response.json({ id: 'order/with space' });
    });

    await expect(getUberOrder(options(fetch), 'order/with space')).resolves.toEqual({ id: 'order/with space' });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://api.uber.com/v2/eats/order/order%2Fwith%20space',
      expect.any(Object),
    );
  });

  it.each([
    ['accept', undefined, '/v1/eats/orders/order-1/accept_pos_order', { reason: 'Accepted by musubo' }, 204],
    ['reject', 'out_of_stock', '/v1/eats/orders/order-1/deny_pos_order', {
      reason: { code: 'ITEM_AVAILABILITY', explanation: 'Item unavailable' },
    }, 204],
    ['reject', 'store_busy', '/v1/eats/orders/order-1/deny_pos_order', {
      reason: { code: 'CAPACITY', explanation: 'Store capacity unavailable' },
    }, 204],
    ['cancel', 'customer_request', '/v1/eats/orders/order-1/cancel', {
      reason: 'CUSTOMER_CALLED_TO_CANCEL',
    }, 200],
  ] as const)('%sはlegacy固定経路とProviderの正式な本文を使う', async (action, reasonCode, path, body, status) => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toEqual(body);
      return new Response(null, { status });
    });

    await sendUberOrderAction(options(fetch), { action, orderId: 'order-1', reasonCode });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://api.uber.com${path}`, expect.any(Object));
  });

  it('未知または未指定の拒否理由を自由文にせずOTHERへ固定する', async () => {
    const bodies: unknown[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    });

    await sendUberOrderAction(options(fetch), { action: 'reject', orderId: 'order-1' });
    await sendUberOrderAction(options(fetch), { action: 'reject', orderId: 'order-2', reasonCode: 'provider says secret' });
    await sendUberOrderAction(options(fetch), { action: 'reject', orderId: 'order-3', reasonCode: 'toString' });
    expect(bodies).toEqual([
      { reason: { code: 'OTHER', explanation: 'Other' } },
      { reason: { code: 'OTHER', explanation: 'Other' } },
      { reason: { code: 'OTHER', explanation: 'Other' } },
    ]);
  });

  it('既知のSandboxまたはProduction以外のホストへトークンを送らない', async () => {
    const fetch = vi.fn();
    await expect(getUberOrder({
      hosts: {
        authorizeUrl: 'https://auth.uber.com/oauth/v2/authorize',
        tokenUrl: 'https://auth.uber.com/oauth/v2/token',
        apiBaseUrl: 'https://attacker.example',
      },
      accessToken: 'secret',
      fetch,
    }, 'order-1')).rejects.toMatchObject({ kind: 'invalid_request', status: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('失敗本文や通信例外の自由文を例外へ含めず、自動再送しない', async () => {
    const providerSecret = 'provider-secret-that-must-not-leak';
    const responseFetch = vi.fn(async () => Response.json({ message: providerSecret }, { status: 503 }));
    let responseError: unknown;
    try {
      await getUberOrder(options(responseFetch), 'order-1');
    } catch (error) {
      responseError = error;
    }
    expect(responseError).toBeInstanceOf(UberEatsError);
    expect(responseError).toMatchObject({ kind: 'unavailable', status: 503 });
    expect(String(responseError)).not.toContain(providerSecret);
    expect(responseFetch).toHaveBeenCalledTimes(1);

    const thrownSecret = 'transport-secret-that-must-not-leak';
    const throwingFetch = vi.fn(async () => { throw new Error(thrownSecret); });
    let transportError: unknown;
    try {
      await sendUberOrderAction(options(throwingFetch), { action: 'cancel', orderId: 'order-1', reasonCode: 'other' });
    } catch (error) {
      transportError = error;
    }
    expect(transportError).toMatchObject({ kind: 'unavailable', status: null });
    expect(String(transportError)).not.toContain(thrownSecret);
    expect(throwingFetch).toHaveBeenCalledTimes(1);
  });

  it('注文詳細の応答を1MiBで打ち切り、安全な固定例外にする', async () => {
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel,
    })));
    await expect(getUberOrder(options(fetch), 'order-1')).rejects.toMatchObject({
      kind: 'unavailable',
      status: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('正式な成功status以外の2xxを成功扱いしない', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(sendUberOrderAction(options(fetch), {
      action: 'accept',
      orderId: 'order-1',
    })).rejects.toMatchObject({ kind: 'unknown', status: 200 });
  });
});
