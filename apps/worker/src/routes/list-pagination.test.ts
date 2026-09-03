import { describe, expect, test } from 'vitest';
import { listLimit, listOffset, listPage } from './list-pagination.js';

describe('管理画面一覧のページ指定', () => {
  test.each([undefined, '', 'abc', '0', '-1', '1.5'])(
    'limit=%s は安全な既定値へ戻す',
    (raw) => expect(listLimit(raw, 50)).toBe(50),
  );

  test('巨大なlimitを200件に止める', () => {
    expect(listLimit('999999', 50)).toBe(200);
  });

  test('offsetとpageの不正値を先頭へ戻す', () => {
    expect(listOffset('-1')).toBe(0);
    expect(listOffset('NaN')).toBe(0);
    expect(listPage('0')).toBe(1);
    expect(listPage('NaN')).toBe(1);
  });
});
