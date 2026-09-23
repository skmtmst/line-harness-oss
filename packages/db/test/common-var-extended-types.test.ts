import { describe, expect, it } from 'vitest';
import { normalizeCommonVarValue } from '../src/common-vars.js';

describe('N-187 共通情報の追加型', () => {
  it('長文・真偽・実在する年月日と日時を保存用に正規化する', () => {
    expect(normalizeCommonVarValue('long_text', 'あ'.repeat(10_000))).toHaveLength(10_000);
    expect(normalizeCommonVarValue('boolean', 'true')).toBe('true');
    expect(normalizeCommonVarValue('date', '2028-02-29')).toBe('2028-02-29');
    expect(normalizeCommonVarValue('datetime', '2028-02-29T23:59')).toBe('2028-02-29T23:59');
  });

  it('境界外の値を既存型へ丸めず拒否する', () => {
    expect(normalizeCommonVarValue('long_text', 'あ'.repeat(10_001))).toBeNull();
    expect(normalizeCommonVarValue('boolean', '1')).toBeNull();
    expect(normalizeCommonVarValue('date', '2026-02-30')).toBeNull();
    expect(normalizeCommonVarValue('datetime', '2026-02-30T24:00')).toBeNull();
  });

  it('VAR-03: 画像は https URL だけを受け、URLでない文字列を拒否する', () => {
    expect(normalizeCommonVarValue('image', 'https://cdn.example.com/logo.png'))
      .toBe('https://cdn.example.com/logo.png');
    // 空は「空のまま」運用があるため通す。
    expect(normalizeCommonVarValue('image', '')).toBe('');
    // URLでない文字列・http・他schemeは送信時に壊れるため止める。
    expect(normalizeCommonVarValue('image', 'not-an-image')).toBeNull();
    expect(normalizeCommonVarValue('image', 'http://example.com/logo.png')).toBeNull();
    expect(normalizeCommonVarValue('image', 'javascript:alert(1)')).toBeNull();
    expect(normalizeCommonVarValue('image', `https://example.com/${'a'.repeat(300)}`)).toBeNull();
  });
});
