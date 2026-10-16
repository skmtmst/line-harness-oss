import { describe, expect, it } from 'vitest';
import { computeHmacSha256Hex } from '../lib/hmac.js';
import {
  NEN_SIGNATURE_HEADER,
  NEN_TIMESTAMP_HEADER,
  deliveryWebhookSigningSecret,
  verifyDeliveryWebhook,
} from './delivery-webhook-auth.js';
import { WEBHOOK_SKEW_SECONDS } from './delivery-webhook-payload.js';
import type { DeliveryEnv } from './restaurant-delivery.js';
import { UBER_SIGNATURE_HEADER, webhookSignatureFor } from './uber-eats.js';

/**
 * 受信口の「この通知は本物か」の試験。
 * 試験用の値はすべて作り物で、本物のID・秘密値は置かない。
 */

const CLIENT_SECRET = 'test-client-secret';
const NEN_SECRET = 'static-secret-value-that-is-long-enough';
const BODY = '{"order_id":"test-order-1"}';
const NOW = 1_760_000_000;

const uberEnv: DeliveryEnv = {
  RT_DELIVERY_UBEREATS_CLIENT_ID: 'test-client-id',
  RT_DELIVERY_UBEREATS_CLIENT_SECRET: CLIENT_SECRET,
  RT_DELIVERY_UBEREATS_ENVIRONMENT: 'sandbox',
  WORKER_PUBLIC_URL: 'https://stg-api.example.test',
};

/** 見出しの読み取り役。入っていない名前は undefined を返す（受け口の `c.req.header` と同じ）。 */
function headers(map: Record<string, string>) {
  return (name: string) => map[name.toLowerCase()];
}

describe('受信の署名の鍵の選び方', () => {
  it('Uber は同じアプリの Secret を使い、静的なトークンの合言葉は使わない', () => {
    expect(deliveryWebhookSigningSecret(uberEnv, 'ubereats')).toBe(CLIENT_SECRET);
    expect(
      deliveryWebhookSigningSecret(
        { ...uberEnv, RT_DELIVERY_UBEREATS_WEBHOOK_SECRET: NEN_SECRET },
        'ubereats',
      ),
    ).toBe(CLIENT_SECRET);
  });

  it('Uber の連携の設定が欠けているときは鍵を返さない（受け口は設定不足として返す）', () => {
    expect(
      deliveryWebhookSigningSecret({ ...uberEnv, RT_DELIVERY_UBEREATS_CLIENT_SECRET: undefined }, 'ubereats'),
    ).toBeNull();
  });

  it('出前館・ロケットナウは自社の合言葉を使い、32文字未満は使わない', () => {
    expect(
      deliveryWebhookSigningSecret({ RT_DELIVERY_DEMAECAN_WEBHOOK_SECRET: NEN_SECRET }, 'demaecan'),
    ).toBe(NEN_SECRET);
    expect(
      deliveryWebhookSigningSecret({ RT_DELIVERY_ROCKETNOW_WEBHOOK_SECRET: NEN_SECRET }, 'rocketnow'),
    ).toBe(NEN_SECRET);
    expect(
      deliveryWebhookSigningSecret({ RT_DELIVERY_DEMAECAN_WEBHOOK_SECRET: 'too-short' }, 'demaecan'),
    ).toBeNull();
  });
});

describe('Uber Eats からの通知の確かめ方', () => {
  it('本文だけの署名が合っていれば受け取る。時刻の見出しは要らない', async () => {
    const signature = await webhookSignatureFor(CLIENT_SECRET, BODY);
    expect(
      await verifyDeliveryWebhook({
        service: 'ubereats',
        secret: CLIENT_SECRET,
        rawBody: BODY,
        header: headers({ [UBER_SIGNATURE_HEADER]: signature }),
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it('Uber は時刻を送らないので、時刻のずれでは落とさない', async () => {
    const signature = await webhookSignatureFor(CLIENT_SECRET, BODY);
    expect(
      await verifyDeliveryWebhook({
        service: 'ubereats',
        secret: CLIENT_SECRET,
        rawBody: BODY,
        header: headers({
          [UBER_SIGNATURE_HEADER]: signature,
          [NEN_TIMESTAMP_HEADER]: String(NOW - WEBHOOK_SKEW_SECONDS * 10),
        }),
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it('署名が無い・違う・本文が変わっているときは受け取らない', async () => {
    const signature = await webhookSignatureFor(CLIENT_SECRET, BODY);
    const other = await webhookSignatureFor('another-client-secret', BODY);
    const cases: Array<Record<string, string>> = [
      {},
      { [UBER_SIGNATURE_HEADER]: '' },
      { [UBER_SIGNATURE_HEADER]: other },
      { [UBER_SIGNATURE_HEADER]: signature.slice(0, 63) },
      // 自社方式の見出しだけでは通さない（取り違えをそのまま受け取らない）。
      { [NEN_SIGNATURE_HEADER]: signature, [NEN_TIMESTAMP_HEADER]: String(NOW) },
    ];
    for (const map of cases) {
      expect(
        await verifyDeliveryWebhook({
          service: 'ubereats',
          secret: CLIENT_SECRET,
          rawBody: BODY,
          header: headers(map),
          nowSeconds: NOW,
        }),
      ).toEqual({ ok: false, error: 'Invalid signature' });
    }
    expect(
      await verifyDeliveryWebhook({
        service: 'ubereats',
        secret: CLIENT_SECRET,
        rawBody: `${BODY} `,
        header: headers({ [UBER_SIGNATURE_HEADER]: signature }),
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, error: 'Invalid signature' });
  });
});

describe('出前館・ロケットナウからの通知の確かめ方（変えない）', () => {
  async function nenHeaders(timestamp: number, body = BODY, secret = NEN_SECRET) {
    return {
      [NEN_TIMESTAMP_HEADER]: String(timestamp),
      [NEN_SIGNATURE_HEADER]: await computeHmacSha256Hex(secret, `${timestamp}.${body}`),
    };
  }

  it('時刻が新しく署名も合っていれば受け取る', async () => {
    for (const service of ['demaecan', 'rocketnow'] as const) {
      expect(
        await verifyDeliveryWebhook({
          service,
          secret: NEN_SECRET,
          rawBody: BODY,
          header: headers(await nenHeaders(NOW)),
          nowSeconds: NOW,
        }),
      ).toEqual({ ok: true });
    }
  });

  it('時刻が離れすぎている・数でないときは期限切れとして返す', async () => {
    for (const map of [
      await nenHeaders(NOW - WEBHOOK_SKEW_SECONDS - 1),
      await nenHeaders(NOW + WEBHOOK_SKEW_SECONDS + 1),
      { ...(await nenHeaders(NOW)), [NEN_TIMESTAMP_HEADER]: 'not-a-number' },
      { [NEN_SIGNATURE_HEADER]: await computeHmacSha256Hex(NEN_SECRET, `.${BODY}`) },
    ]) {
      expect(
        await verifyDeliveryWebhook({
          service: 'demaecan',
          secret: NEN_SECRET,
          rawBody: BODY,
          header: headers(map),
          nowSeconds: NOW,
        }),
      ).toEqual({ ok: false, error: 'Expired request' });
    }
  });

  it('署名が合わないときは受け取らない。Uber の見出しでは通さない', async () => {
    const uber = await webhookSignatureFor(NEN_SECRET, BODY);
    const cases: Array<Record<string, string>> = [
      { [NEN_TIMESTAMP_HEADER]: String(NOW) },
      { [NEN_TIMESTAMP_HEADER]: String(NOW), [NEN_SIGNATURE_HEADER]: 'zz' },
      await nenHeaders(NOW, `${BODY} `),
      { [NEN_TIMESTAMP_HEADER]: String(NOW), [UBER_SIGNATURE_HEADER]: uber },
    ];
    for (const map of cases) {
      expect(
        await verifyDeliveryWebhook({
          service: 'demaecan',
          secret: NEN_SECRET,
          rawBody: BODY,
          header: headers(map),
          nowSeconds: NOW,
        }),
      ).toEqual({ ok: false, error: 'Invalid signature' });
    }
  });

  it('見出しの `sha256=` と大文字は読み替える（これまでの受け取り方を変えない）', async () => {
    const map = await nenHeaders(NOW);
    expect(
      await verifyDeliveryWebhook({
        service: 'rocketnow',
        secret: NEN_SECRET,
        rawBody: BODY,
        header: headers({
          ...map,
          [NEN_SIGNATURE_HEADER]: `sha256=${map[NEN_SIGNATURE_HEADER].toUpperCase()}`,
        }),
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: true });
  });
});
