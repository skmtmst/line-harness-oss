import { describe, expect, it } from 'vitest';
import { googleBusinessEnabled, restaurantTestEnabled } from './environment-features.js';

describe('環境限定機能', () => {
  it.each([undefined, '', 'production', 'PRODUCTION', ' production ', 'prod', 'unknown'])(
    '本番や未知の環境ではtrueでも開かない: %s', DEPLOY_ENV => {
      expect(restaurantTestEnabled({ RESTAURANT_TEST_ENABLED: 'true', DEPLOY_ENV })).toBe(false);
    },
  );
  it('検証環境では明示的なtrueで開く', () => {
    expect(restaurantTestEnabled({ RESTAURANT_TEST_ENABLED: 'true', DEPLOY_ENV: 'staging' })).toBe(true);
  });
  it.each([undefined, '', 'false', '0', 'yes', 'TRUEE'])(
    '飲食店テストは明示的なtrue以外で無効: %s',
    (value) => expect(restaurantTestEnabled({ RESTAURANT_TEST_ENABLED: value, DEPLOY_ENV: 'test' })).toBe(false),
  );

  it.each(['true', 'TRUE', ' true '])('明示的なtrueだけ有効: %s', (value) => {
    expect(restaurantTestEnabled({ RESTAURANT_TEST_ENABLED: value, DEPLOY_ENV: 'test' })).toBe(true);
  });
});


describe('Google ビジネスは飲食店の試験旗から独立', () => {
  it.each([undefined, '', 'false', '0', 'yes'])('未設定・誤記では閉じる: %s', value => {
    expect(googleBusinessEnabled({ GOOGLE_BUSINESS_ENABLED: value })).toBe(false);
  });
  it.each(['true', 'TRUE', ' true '])('本番でも明示的なtrueなら開く: %s', value => {
    expect(googleBusinessEnabled({ GOOGLE_BUSINESS_ENABLED: value })).toBe(true);
  });
});
