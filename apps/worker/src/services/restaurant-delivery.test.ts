import { describe, expect, it, vi } from 'vitest';
import {
  deliveryWebhookIpAllowlist,
  isDeliveryWebhookIpAllowed,
} from './delivery-webhook-ip.js';
import { UBER_PRODUCTION_HOSTS, UBER_SANDBOX_HOSTS } from './uber-eats-hosts.js';
import {
  UBER_OAUTH_CALLBACK_PATH,
  uberOAuthClient,
  uberWebhookSecret,
  dispatchToDeliveryService,
  type DeliveryEnv,
} from './restaurant-delivery.js';

/**
 * Uber Eats のログイン連携の設定の読み取りの試験。
 * 試験用の値はすべて作り物で、本物のID・秘密値は置かない。
 */

const base: DeliveryEnv = {
  RT_DELIVERY_UBEREATS_CLIENT_ID: 'test-client-id',
  RT_DELIVERY_UBEREATS_CLIENT_SECRET: 'test-client-secret',
  WORKER_PUBLIC_URL: 'https://stg-api.example.test',
};

describe('Uber Eats のログイン連携の設定', () => {
  it('戻り先は配備の設定から組み立てる。店舗が入れる値はない', () => {
    expect(uberOAuthClient(base)).toEqual({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: `https://stg-api.example.test${UBER_OAUTH_CALLBACK_PATH}`,
      hosts: UBER_PRODUCTION_HOSTS,
    });
  });

  it('接続先は配備の設定で選ぶ。sandbox のときだけ TEST APP 側へ向ける', () => {
    expect(uberOAuthClient({ ...base, RT_DELIVERY_UBEREATS_ENVIRONMENT: 'sandbox' })?.hosts)
      .toEqual(UBER_SANDBOX_HOSTS);
    expect(uberOAuthClient({ ...base, RT_DELIVERY_UBEREATS_ENVIRONMENT: 'production' })?.hosts)
      .toEqual(UBER_PRODUCTION_HOSTS);
  });

  it('接続先の書き間違いは本番へ落とさず、連携の口を開けない', () => {
    expect(uberOAuthClient({ ...base, RT_DELIVERY_UBEREATS_ENVIRONMENT: 'stg' })).toBeNull();
  });

  it('土台の末尾の斜線は重ねない', () => {
    expect(uberOAuthClient({ ...base, WORKER_PUBLIC_URL: 'https://stg-api.example.test//' })?.redirectUri).toBe(
      `https://stg-api.example.test${UBER_OAUTH_CALLBACK_PATH}`,
    );
  });

  it('Uber 側の登録が別の文字列のときだけ上書きを使う', () => {
    expect(
      uberOAuthClient({ ...base, RT_DELIVERY_UBEREATS_REDIRECT_URI: 'https://other.example.test/back' })?.redirectUri,
    ).toBe('https://other.example.test/back');
  });

  it('ID・Secret・戻り先のどれかが欠ければ連携の口を開けない', () => {
    expect(uberOAuthClient({ ...base, RT_DELIVERY_UBEREATS_CLIENT_ID: '  ' })).toBeNull();
    expect(uberOAuthClient({ ...base, RT_DELIVERY_UBEREATS_CLIENT_SECRET: undefined })).toBeNull();
    expect(uberOAuthClient({ ...base, WORKER_PUBLIC_URL: undefined })).toBeNull();
  });

  it('暗号化されない経路の戻り先は受け付けない', () => {
    expect(uberOAuthClient({ ...base, WORKER_PUBLIC_URL: 'http://stg-api.example.test' })).toBeNull();
    expect(uberOAuthClient({ ...base, RT_DELIVERY_UBEREATS_REDIRECT_URI: 'http://other.example.test/back' })).toBeNull();
  });

  it('受信の署名の鍵は同じアプリの Secret で、静的なトークンの経路とは混ぜない', () => {
    expect(uberWebhookSecret(base)).toBe('test-client-secret');
    expect(
      uberWebhookSecret({
        RT_DELIVERY_UBEREATS_WEBHOOK_SECRET: 'static-secret-value-that-is-long-enough',
      }),
    ).toBeNull();
  });
});

describe('Uber Eats 注文操作の送信経路', () => {
  it('旧来の静的URLとトークンが残っていても汎用経路からは送信しない', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await dispatchToDeliveryService(
      {
        RT_DELIVERY_SEND_ENABLED: 'true',
        RT_DELIVERY_UBEREATS_API_BASE_URL: 'https://legacy-ubereats.example.test',
        RT_DELIVERY_UBEREATS_API_TOKEN: 'synthetic-static-token',
      },
      {
        service: 'ubereats',
        action: 'accept',
        externalId: 'synthetic-order-id',
      },
      {
        completedAttempts: 0,
        now: new Date('2026-10-22T00:00:00.000Z'),
        fetcher,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'delivery_action_unsupported', retryable: false },
      nextAttemptAt: null,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/**
 * 通知を受け取っていい送信元IPの一覧の試験（出前館QA#7）。
 * 試験用のIPは文書用に予約された範囲（192.0.2.0/24・198.51.100.0/24・203.0.113.0/24）だけを使う。
 */
describe('通知の送信元IPの許可リストの読み取り', () => {
  it('どこにも書かれていなければ null＝制限しない。いまの動きを変えない', () => {
    expect(deliveryWebhookIpAllowlist({}, 'demaecan')).toBeNull();
  });

  it('共通の値はどのサービスにも効く', () => {
    const env: DeliveryEnv = { RT_DELIVERY_WEBHOOK_IP_ALLOWLIST: '203.0.113.5' };
    expect(deliveryWebhookIpAllowlist(env, 'demaecan')).toEqual(['203.0.113.5']);
    expect(deliveryWebhookIpAllowlist(env, 'ubereats')).toEqual(['203.0.113.5']);
    expect(deliveryWebhookIpAllowlist(env, 'rocketnow')).toEqual(['203.0.113.5']);
  });

  it('サービスごとの指定があればそちらが先で、共通は混ぜない', () => {
    const env: DeliveryEnv = {
      RT_DELIVERY_WEBHOOK_IP_ALLOWLIST: '203.0.113.5',
      RT_DELIVERY_DEMAECAN_WEBHOOK_IP_ALLOWLIST: '198.51.100.7, 198.51.100.8',
    };
    expect(deliveryWebhookIpAllowlist(env, 'demaecan')).toEqual(['198.51.100.7', '198.51.100.8']);
    expect(deliveryWebhookIpAllowlist(env, 'ubereats')).toEqual(['203.0.113.5']);
  });

  it('空欄や読点だけの書き間違いは「誰も通さない」にせず制限なしへ戻す', () => {
    expect(deliveryWebhookIpAllowlist({ RT_DELIVERY_WEBHOOK_IP_ALLOWLIST: '  ' }, 'demaecan')).toBeNull();
    expect(deliveryWebhookIpAllowlist({ RT_DELIVERY_WEBHOOK_IP_ALLOWLIST: ' , , ' }, 'demaecan')).toBeNull();
  });
});

describe('通知の送信元IPの照合', () => {
  it('一覧が null のときは全部通す', () => {
    expect(isDeliveryWebhookIpAllowed('203.0.113.5', null)).toBe(true);
    expect(isDeliveryWebhookIpAllowed('', null)).toBe(true);
  });

  it('1件ずつの指定は文字列の一致で見る', () => {
    expect(isDeliveryWebhookIpAllowed('203.0.113.5', ['203.0.113.5'])).toBe(true);
    expect(isDeliveryWebhookIpAllowed('203.0.113.6', ['203.0.113.5'])).toBe(false);
  });

  it('IPv6 も1件ずつなら大文字小文字を揃えて一致で見る', () => {
    expect(isDeliveryWebhookIpAllowed('2001:DB8::1', ['2001:db8::1'])).toBe(true);
    expect(isDeliveryWebhookIpAllowed('2001:db8::2', ['2001:db8::1'])).toBe(false);
  });

  it('送信元が取れなかったときは通さない', () => {
    expect(isDeliveryWebhookIpAllowed('', ['203.0.113.5'])).toBe(false);
    expect(isDeliveryWebhookIpAllowed('   ', ['203.0.113.5'])).toBe(false);
  });

  it('IPv4 のまとまり指定は範囲で見る', () => {
    expect(isDeliveryWebhookIpAllowed('203.0.113.200', ['203.0.113.0/24'])).toBe(true);
    expect(isDeliveryWebhookIpAllowed('203.0.114.1', ['203.0.113.0/24'])).toBe(false);
    expect(isDeliveryWebhookIpAllowed('192.0.2.130', ['192.0.2.128/25'])).toBe(true);
    expect(isDeliveryWebhookIpAllowed('192.0.2.127', ['192.0.2.128/25'])).toBe(false);
    expect(isDeliveryWebhookIpAllowed('192.0.2.1', ['192.0.2.1/32'])).toBe(true);
    expect(isDeliveryWebhookIpAllowed('192.0.2.2', ['192.0.2.1/32'])).toBe(false);
  });

  it('/0 は全許可。32ビットの桁あふれで取り違えない', () => {
    expect(isDeliveryWebhookIpAllowed('198.51.100.1', ['0.0.0.0/0'])).toBe(true);
  });

  it('何件か並べたうちの1つに当たれば通す', () => {
    const list = ['198.51.100.7', '203.0.113.0/24'];
    expect(isDeliveryWebhookIpAllowed('198.51.100.7', list)).toBe(true);
    expect(isDeliveryWebhookIpAllowed('203.0.113.9', list)).toBe(true);
    expect(isDeliveryWebhookIpAllowed('192.0.2.9', list)).toBe(false);
  });

  it('書き間違いの行は無視して、他の行の判断を壊さない', () => {
    // 幅が範囲外・0埋め・IPv6 のまとまり指定はその行だけ飛ばす。
    const list = ['203.0.113.0/33', '010.0.0.1', '2001:db8::/32', '198.51.100.7'];
    expect(isDeliveryWebhookIpAllowed('198.51.100.7', list)).toBe(true);
    expect(isDeliveryWebhookIpAllowed('203.0.113.9', list)).toBe(false);
    expect(isDeliveryWebhookIpAllowed('2001:db8::1', list)).toBe(false);
  });
});
