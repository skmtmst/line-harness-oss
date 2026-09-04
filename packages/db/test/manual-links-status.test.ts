import { describe, expect, it } from 'vitest';
import { statusFor } from '../src/manual-links.js';
import { missingFeatures, prefixedName } from '../src/recipes.js';

/**
 * マニュアルの正本表とレシピの判定。台帳 #134。
 */

describe('リンクの状態', () => {
  /*
    **「決めていない」と「開けない」を言い分ける。**
    どちらもマニュアルは開かないが、運営のやることが違う——
    前者は決める、後者は直す。
  */
  it.each([
    ['URL が空', null, true],
    ['空文字', '', true],
    ['空白だけ', '   ', true],
  ])('%s なら unset', (_label, url, _x) => {
    expect(statusFor(url, true)).toBe('unset');
  });

  /* **確かめていない URL を「開けます」と言わない。** */
  it('URL が入っていても、確かめていなければ unset', () => {
    expect(statusFor('https://example.com', null)).toBe('unset');
  });

  it('確かめて開けたら ok', () => {
    expect(statusFor('https://example.com', true)).toBe('ok');
  });

  it('確かめて開けなければ broken', () => {
    expect(statusFor('https://example.com', false)).toBe('broken');
  });
});

describe('レシピの必要な機能', () => {
  /*
    **機能設定に行が無い機能を「オフ」と読まない。** 友だち属性のように
    切れない機能は表に無い。無いことをオフと読むと、どのレシピも使えなくなる。
  */
  it('表に無い機能を足りないと数えない', () => {
    expect(missingFeatures(['scenarios', 'templates'], {})).toEqual([]);
  });

  it('明示的に false のものだけ数える', () => {
    expect(missingFeatures(['scenarios', 'templates'], { scenarios: false, templates: true })).toEqual([
      'scenarios',
    ]);
  });
});

describe('名前のあたまに付ける文字', () => {
  it('空のときは何も足さない', () => {
    expect(prefixedName('', '7日間フォロー')).toBe('7日間フォロー');
    expect(prefixedName('  ', '7日間フォロー')).toBe('7日間フォロー');
    expect(prefixedName(null, '7日間フォロー')).toBe('7日間フォロー');
  });

  it('あれば1つ空白をはさむ', () => {
    expect(prefixedName('2026春', '7日間フォロー')).toBe('2026春 7日間フォロー');
  });
});
