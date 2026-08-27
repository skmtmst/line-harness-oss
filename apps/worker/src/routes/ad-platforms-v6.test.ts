import { describe, expect, it } from 'vitest';
import { maskConfig } from './ad-platforms.js';

describe('広告接続の秘密値', () => {
  it('秘密値を部分的にも返さず、表示可能な口座番号だけを残す', () => {
    expect(maskConfig({
      customer_id: 'customer-123',
      access_token: 'secret-access-token',
      api_secret: 'secret-api-value',
      developer_token: 'secret-developer-token',
      password: 'secret-password',
      empty_token: '',
    })).toEqual({
      customer_id: 'customer-123',
      access_token: '設定済み',
      api_secret: '設定済み',
      developer_token: '設定済み',
      password: '設定済み',
      empty_token: '',
    });
  });
});
