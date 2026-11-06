import { describe, expect, it } from 'vitest';
import { nextVersionToken } from './utils.js';

/*
 * M507・M509・M511・M513: updated_at を版にする更新は、同じミリ秒の連打
 * でも版が進まないと古い画面からの保存を見分けられない。版の単調増加を
 * ここで固定する。
 */
describe('nextVersionToken', () => {
  it('現在時刻が進んでいれば現在時刻をそのまま使う', () => {
    expect(nextVersionToken('2026-09-01T00:00:00.000+09:00', '2026-09-02T00:00:00.000+09:00'))
      .toBe('2026-09-02T00:00:00.000+09:00');
  });

  it('同じミリ秒なら読んだ版の1ms先へ進める', () => {
    const token = nextVersionToken('2026-09-01T00:00:00.000+09:00', '2026-09-01T00:00:00.000+09:00');
    expect(new Date(token).getTime()).toBe(new Date('2026-09-01T00:00:00.000+09:00').getTime() + 1);
  });

  it('版が無い・読めないときは現在時刻を使う', () => {
    expect(nextVersionToken(null, '2026-09-02T00:00:00.000+09:00')).toBe('2026-09-02T00:00:00.000+09:00');
    expect(nextVersionToken('壊れた値', '2026-09-02T00:00:00.000+09:00')).toBe('2026-09-02T00:00:00.000+09:00');
  });
});
