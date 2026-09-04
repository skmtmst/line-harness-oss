import { describe, expect, it } from 'vitest';
import {
  compareProviders,
  countsAddUp,
  generateHandoverCode,
} from '../src/account-handovers.js';

/**
 * 乗り換え（引き継ぎ）の判定。設計 ★V6 33-4。台帳 #133。
 */

describe('4区分の合計', () => {
  /*
    **合わない結果を保存しない。** 出すと、運用者は「どこかの人が消えた」と読む。
    画面側（`handover-view.ts` の `totalsMatch`）と同じ決まりを口の側でも守る。
  */
  it('合っていれば true', () => {
    expect(countsAddUp({ auto: 60, review: 20, unmatched: 15, lookalike: 5 }, 100)).toBe(true);
  });

  it('1人でも足りなければ false', () => {
    expect(countsAddUp({ auto: 60, review: 20, unmatched: 15, lookalike: 4 }, 100)).toBe(false);
  });

  it('多すぎても false', () => {
    expect(countsAddUp({ auto: 60, review: 20, unmatched: 15, lookalike: 6 }, 100)).toBe(false);
  });

  it('友だちが0人でも合う', () => {
    expect(countsAddUp({ auto: 0, review: 0, unmatched: 0, lookalike: 0 }, 0)).toBe(true);
  });
});

describe('プロバイダーの照合', () => {
  /*
    **分からないことを「同じ」と書かない。** LINE の Messaging API は
    プロバイダーを返さないので、入っていなければ unknown。
    ここで same にすると、事前確認で「一致しない」が大量に出た理由が
    運用者に分からなくなる。
  */
  it('両方入っていて同じなら same', () => {
    expect(compareProviders('p-1', 'p-1')).toBe('same');
  });

  it('両方入っていて違えば different', () => {
    expect(compareProviders('p-1', 'p-2')).toBe('different');
  });

  it.each([
    ['引き継ぎ元が空', null, 'p-1'],
    ['引き継ぎ先が空', 'p-1', null],
    ['どちらも空', null, null],
    ['空文字', '', 'p-1'],
    ['未定義', undefined, 'p-1'],
  ])('%s なら unknown（same と決めつけない）', (_label, from, to) => {
    expect(compareProviders(from, to)).toBe('unknown');
  });
});

describe('引き継ぎコード', () => {
  it('4文字ごとに区切った12文字', () => {
    const code = generateHandoverCode(() => 0);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  /*
    **読み違えやすい文字を使わない。** 0とO、1とIとLは、
    電話や口頭で伝えるときに必ず取り違える。
  */
  it('0 O 1 I L を含まない', () => {
    const codes = Array.from({ length: 200 }, () => generateHandoverCode());
    for (const code of codes) {
      expect(code).not.toMatch(/[01OIL]/);
    }
  });
});
