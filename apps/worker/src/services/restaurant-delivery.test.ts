import { describe, expect, it } from 'vitest';
import {
  UBER_OAUTH_CALLBACK_PATH,
  uberOAuthClient,
  uberWebhookSecret,
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
    });
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
