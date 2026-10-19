import { describe, expect, it } from 'vitest';

import { evaluateQuota, shortfallMessage } from './broadcast-quota-guard';

/**
 * 予約配信の送信直前に、残りの送信枠を確かめる（台帳 Issue #120）。
 *
 * 設計 `Bw0zt` は「予約時刻の直前に対象人数と送信枠を再確認します。」と
 * 約束している。**予約したあとに枠を使い切ると、予約は実行されるが途中で
 * 失敗する。** 送った人と送れなかった人が混ざり、運用者は結果を見るまで
 * 気づけない。
 */
describe('送信枠の再確認', () => {
  it('残りが足りていれば通す', () => {
    expect(evaluateQuota({ limit: 5_000, used: 1_000 }, 500)).toEqual({
      state: 'ok',
      limit: 5_000,
      used: 1_000,
      remaining: 4_000,
    });
  });

  it('ちょうど使い切る配信は通す', () => {
    /* 残り 100 に 100通 は送れる。**1通の差で止めない。** */
    const check = evaluateQuota({ limit: 200, used: 100 }, 100);
    expect(check.state).toBe('ok');
  });

  it('1通でも超えたら止める', () => {
    const check = evaluateQuota({ limit: 200, used: 100 }, 101);
    expect(check).toEqual({
      state: 'short',
      limit: 200,
      used: 100,
      remaining: 100,
      shortfall: 1,
    });
  });

  it('使い切っていても、残りを負の数にしない', () => {
    /* LINE 側の集計が上限を超えることがある。`-50通 残り` と出さない。 */
    const check = evaluateQuota({ limit: 200, used: 250 }, 10);
    expect(check).toMatchObject({ state: 'short', remaining: 0, shortfall: 10 });
  });
});

describe('取れないときは止めない', () => {
  it('上限が読めなければ通す', () => {
    /*
     * **LINE の口が落ちているだけで予約を潰さない。**
     * 送れるはずの配信が届かなくなるほうが害が大きい。
     */
    expect(evaluateQuota({ limit: null, used: 100 }, 500)).toEqual({
      state: 'unknown',
      reason: '送信枠の上限を取得できませんでした',
    });
  });

  it('今月の送信数が読めなければ通す', () => {
    expect(evaluateQuota({ limit: 5_000, used: null }, 500)).toEqual({
      state: 'unknown',
      reason: '今月の送信数を取得できませんでした',
    });
  });

  it('分からないことを 0 として扱わない', () => {
    /* `used: null` を 0 と読むと、使い切っていても「残り全部」に見える。 */
    const check = evaluateQuota({ limit: 200, used: null }, 200);
    expect(check.state).not.toBe('ok');
    expect(check.state).toBe('unknown');
  });
});

describe('足りないときに出す文', () => {
  const check = evaluateQuota({ limit: 5_000, used: 4_800 }, 500) as Extract<
    ReturnType<typeof evaluateQuota>,
    { state: 'short' }
  >;

  it('何通足りないかと、次にやることを書く', () => {
    const text = shortfallMessage(check, 500);
    expect(text).toContain('500通');
    expect(text).toContain('200通');
    expect(text).toContain('300通 足りません');
    expect(text).toContain('下書きへ戻しました');
    expect(text).toContain('送る相手を減らすか、来月に予約し直してください');
  });

  it('内部の語も番号も出さない', () => {
    const text = shortfallMessage(check, 500);
    expect(text).not.toMatch(/quota|consumption|4[0-9]{2}|5[0-9]{2}\s*error|null|undefined/i);
  });

  it('桁区切りを付ける', () => {
    /* 「12000通」は読み違える。 */
    const big = evaluateQuota({ limit: 30_000, used: 18_000 }, 24_000) as Extract<
      ReturnType<typeof evaluateQuota>,
      { state: 'short' }
    >;
    expect(shortfallMessage(big, 24_000)).toContain('24,000通');
    expect(shortfallMessage(big, 24_000)).toContain('12,000通');
  });
});
