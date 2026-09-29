import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const mocks = vi.hoisted(() => ({
  getStripeEventByStripeId: vi.fn(),
  createStripeEvent: vi.fn(),
}));

vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getStripeEventByStripeId: mocks.getStripeEventByStripeId,
  createStripeEvent: mocks.createStripeEvent,
}));

const { stripe } = await import('./stripe.js');

const secret = 'whsec_test_stripe_webhook_secret';
const payload = {
  id: 'evt_security_test',
  type: 'charge.refunded',
  data: {
    object: {
      id: 'ch_security_test',
      amount: 1200,
      currency: 'jpy',
      metadata: {},
    },
  },
};

function app() {
  const instance = new Hono<Env>();
  instance.route('/', stripe);
  return instance;
}

function env(stripeSecret: string | null = secret): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    ...(stripeSecret === null ? {} : { STRIPE_WEBHOOK_SECRET: stripeSecret }),
  } as Env['Bindings'];
}

async function signature(rawBody: string, timestamp: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signedHeaders(rawBody: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  return {
    'Content-Type': 'application/json',
    'Stripe-Signature': `t=${timestamp},v1=${await signature(rawBody, timestamp)}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStripeEventByStripeId.mockResolvedValue(null);
  mocks.createStripeEvent.mockResolvedValue({
    id: 'stripe-event-1',
    stripe_event_id: payload.id,
    event_type: payload.type,
    friend_id: null,
    amount: payload.data.object.amount,
    currency: payload.data.object.currency,
    metadata: '{}',
    processed_at: '2026-09-04T12:00:00+09:00',
  });
});

describe('POST /api/integrations/stripe/webhook security boundary', () => {
  test('署名キー未設定時は本文を処理せず503で拒否する', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await app().request('/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, env(null));

    expect(response.status).toBe(503);
    expect(consoleError).toHaveBeenCalledWith('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured');
    expect(mocks.getStripeEventByStripeId).not.toHaveBeenCalled();
    expect(mocks.createStripeEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test.each([
    ['署名なし', ''],
    ['不正な署名', `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`],
  ])('%sの本文はDB処理前に401で拒否する', async (_label, stripeSignature) => {
    const response = await app().request('/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': stripeSignature },
      body: JSON.stringify(payload),
    }, env());

    expect(response.status).toBe(401);
    expect(mocks.getStripeEventByStripeId).not.toHaveBeenCalled();
    expect(mocks.createStripeEvent).not.toHaveBeenCalled();
  });

  test('5分を超えた署名はDB処理前に401で拒否する', async () => {
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    const response = await app().request('/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: await signedHeaders(rawBody, timestamp),
      body: rawBody,
    }, env());

    expect(response.status).toBe(401);
    expect(mocks.getStripeEventByStripeId).not.toHaveBeenCalled();
    expect(mocks.createStripeEvent).not.toHaveBeenCalled();
  });

  test('複数v1署名のうち1つが正しければ受理する', async () => {
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const validSignature = await signature(rawBody, timestamp);
    const response = await app().request('/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': `t=${timestamp},v1=${validSignature},v1=${'0'.repeat(64)}`,
      },
      body: rawBody,
    }, env());

    expect(response.status).toBe(200);
    expect(mocks.createStripeEvent).toHaveBeenCalledTimes(1);
  });

  test('v1署名が上限を超えるヘッダーは検証せず拒否する', async () => {
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const validSignature = await signature(rawBody, timestamp);
    const extraSignatures = Array.from({ length: 8 }, () => `v1=${'0'.repeat(64)}`).join(',');
    const response = await app().request('/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': `t=${timestamp},v1=${validSignature},${extraSignatures}`,
      },
      body: rawBody,
    }, env());

    expect(response.status).toBe(401);
    expect(mocks.getStripeEventByStripeId).not.toHaveBeenCalled();
  });

  test('Content-Lengthが256KiBを超える本文は読む前に413で拒否する', async () => {
    const response = await app().request('/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(256 * 1024 + 1),
      },
      body: JSON.stringify(payload),
    }, env());

    expect(response.status).toBe(413);
    expect(mocks.getStripeEventByStripeId).not.toHaveBeenCalled();
  });

  test('実測本文が256KiBを超えた時点で読み取りを中断し413で拒否する', async () => {
    let pullCount = 0;
    const totalChunks = 10;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount > totalChunks) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const request = new Request('https://worker.example.test/api/integrations/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const response = await app().fetch(request, env());

    expect(response.status).toBe(413);
    expect(pullCount).toBeLessThan(totalChunks);
    expect(mocks.getStripeEventByStripeId).not.toHaveBeenCalled();
  });

  test('同じStripeイベントの再送は成功応答し二重登録しない', async () => {
    const rawBody = JSON.stringify(payload);
    const headers = await signedHeaders(rawBody);
    let stored: Record<string, unknown> | null = null;
    mocks.getStripeEventByStripeId.mockImplementation(async () => stored);
    mocks.createStripeEvent.mockImplementation(async () => {
      stored = {
        id: 'stripe-event-1',
        stripe_event_id: payload.id,
        event_type: payload.type,
        friend_id: null,
        amount: payload.data.object.amount,
        currency: payload.data.object.currency,
        metadata: '{}',
        processed_at: '2026-09-04T12:00:00+09:00',
      };
      return stored;
    });

    const first = await app().request('/api/integrations/stripe/webhook', {
      method: 'POST', headers, body: rawBody,
    }, env());
    const retry = await app().request('/api/integrations/stripe/webhook', {
      method: 'POST', headers, body: rawBody,
    }, env());

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ success: true, data: { message: 'Already processed' } });
    expect(mocks.createStripeEvent).toHaveBeenCalledTimes(1);
  });
});
