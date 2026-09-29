import { describe, expect, it } from 'vitest';
import { isHttpsUrl } from './Event.js';

/**
 * #607：会場URL・画像URLは安全な https だけ表示する。
 * 空・http・javascript:・不正文字列はリンク化も画像表示もしない。
 */
describe('isHttpsUrl', () => {
  it('https だけ通す', () => {
    expect(isHttpsUrl('https://example.com/venue')).toBe(true);
    expect(isHttpsUrl('HTTPS://EXAMPLE.COM/x.png')).toBe(true);
  });

  it('空は出さない', () => {
    expect(isHttpsUrl(null)).toBe(false);
    expect(isHttpsUrl(undefined)).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
    expect(isHttpsUrl('   ')).toBe(false);
  });

  it('http は出さない', () => {
    expect(isHttpsUrl('http://example.com/venue')).toBe(false);
  });

  it('javascript: は出さない', () => {
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('  javascript:alert(1)')).toBe(false);
  });

  it('不正文字列は出さない', () => {
    expect(isHttpsUrl('not a url')).toBe(false);
    expect(isHttpsUrl('//example.com/x')).toBe(false);
    expect(isHttpsUrl('https:')).toBe(false);
    expect(isHttpsUrl(123)).toBe(false);
  });
});
