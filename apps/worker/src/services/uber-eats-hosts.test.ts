import { describe, expect, it } from 'vitest';
import {
  UBER_OPERATION_SCOPES,
  UBER_PRODUCTION_HOSTS,
  UBER_PROVISIONING_SCOPES,
  UBER_SANDBOX_HOSTS,
  uberHosts,
} from './uber-eats-hosts.js';

/**
 * 接続先の選び分けの試験。
 *
 * 公式仕様で TEST APP（Sandbox）と PRODUCTION APP は接続先が分かれており、
 * 認証とAPIを混ぜると認証が落ちる。ここでは「束が崩れていないこと」と
 * 「設定の書き間違いが本番へ漏れないこと」を見る。
 */

describe('Uber Eats の接続先', () => {
  it('設定が無ければ本番側。これまでの動きを変えない', () => {
    expect(uberHosts({})).toEqual(UBER_PRODUCTION_HOSTS);
    expect(uberHosts({ RT_DELIVERY_UBEREATS_ENVIRONMENT: '' })).toEqual(UBER_PRODUCTION_HOSTS);
    expect(uberHosts({ RT_DELIVERY_UBEREATS_ENVIRONMENT: 'production' })).toEqual(UBER_PRODUCTION_HOSTS);
  });

  it('sandbox のときは TEST APP 側へ向ける', () => {
    expect(uberHosts({ RT_DELIVERY_UBEREATS_ENVIRONMENT: 'sandbox' })).toEqual(UBER_SANDBOX_HOSTS);
  });

  it('前後の空白と大文字小文字は読み飛ばす', () => {
    expect(uberHosts({ RT_DELIVERY_UBEREATS_ENVIRONMENT: '  Sandbox  ' })).toEqual(UBER_SANDBOX_HOSTS);
    expect(uberHosts({ RT_DELIVERY_UBEREATS_ENVIRONMENT: 'PRODUCTION' })).toEqual(UBER_PRODUCTION_HOSTS);
  });

  it('想定外の文字列は本番へ落とさず、未設定として止める', () => {
    for (const value of ['stg', 'staging', 'test', 'sandbox-login', 'prod']) {
      expect(uberHosts({ RT_DELIVERY_UBEREATS_ENVIRONMENT: value })).toBeNull();
    }
  });

  it('認証とAPIは必ず同じ側で、2組が混ざらない', () => {
    expect(UBER_PRODUCTION_HOSTS.authorizeUrl.startsWith('https://auth.uber.com/')).toBe(true);
    expect(UBER_PRODUCTION_HOSTS.tokenUrl).toBe('https://auth.uber.com/oauth/v2/token');
    expect(UBER_PRODUCTION_HOSTS.apiBaseUrl).toBe('https://api.uber.com');

    expect(UBER_SANDBOX_HOSTS.authorizeUrl.startsWith('https://sandbox-login.uber.com/')).toBe(true);
    expect(UBER_SANDBOX_HOSTS.tokenUrl).toBe('https://sandbox-login.uber.com/oauth/v2/token');
    expect(UBER_SANDBOX_HOSTS.apiBaseUrl).toBe('https://test-api.uber.com');

    // 片方の値がもう片方へ混ざっていないこと（取り違えの検出）。
    for (const key of ['authorizeUrl', 'tokenUrl', 'apiBaseUrl'] as const) {
      expect(UBER_SANDBOX_HOSTS[key]).not.toBe(UBER_PRODUCTION_HOSTS[key]);
    }
  });

  it('権限は許可の取り方ごとに分かれており、混ぜられない', () => {
    // authorization_code 側は1つだけ。client_credentials 側とは併用できない（公式仕様）。
    expect(UBER_PROVISIONING_SCOPES).toEqual(['eats.pos_provisioning']);
    expect(UBER_OPERATION_SCOPES).not.toContain('eats.pos_provisioning');
    expect(UBER_OPERATION_SCOPES).toContain('eats.order');
  });
});
