import { describe, expect, it } from 'vitest';
import { normalizeCommonVarValue } from './common-vars.js';

/*
 * R36: URL型の共通情報にURLでない文章を保存できてしまう。
 * 新規・編集・代替値・予約の更新はすべてこの判定を通るため、
 * ここで止めれば4つの口すべてに同じ確かめが効く。
 */
describe('normalizeCommonVarValue の URL型（R36）', () => {
  it('http/https のURLを通す', () => {
    expect(normalizeCommonVarValue('url', 'https://example.com/shop')).toBe('https://example.com/shop');
    expect(normalizeCommonVarValue('url', 'http://example.com/shop')).toBe('http://example.com/shop');
  });

  it('空は「空のまま」運用のため通す', () => {
    expect(normalizeCommonVarValue('url', '')).toBe('');
  });

  it('監査で保存できてしまった文章を止める', () => {
    expect(normalizeCommonVarValue('url', 'これはURLではありません')).toBeNull();
    expect(normalizeCommonVarValue('url', 'example.com/shop')).toBeNull();
    expect(normalizeCommonVarValue('url', 'ftp://example.com/a')).toBeNull();
    expect(normalizeCommonVarValue('url', 'https://')).toBeNull();
  });

  it('200文字を超えるURLは止める', () => {
    expect(normalizeCommonVarValue('url', `https://example.com/${'あ'.repeat(200)}`)).toBeNull();
  });

  it('画像の https のみ判定は変えない', () => {
    expect(normalizeCommonVarValue('image', 'https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png',
    );
    expect(normalizeCommonVarValue('image', 'http://example.com/a.png')).toBeNull();
  });
});
