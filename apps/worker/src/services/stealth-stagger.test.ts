/*
 * 合計遅延20秒の上限を守るため、実際の1バッチ人数から遅延を計算することを確かめる。
 * dedup-broadcast の差し込みは10人単位でも遅延を使う。別の試験では遅延が差し替えられるため、ここで関数自体を検証する。
 */
import { describe, it, expect } from 'vitest';
import { calculateStaggerDelay } from './stealth.js';

/** 実際に送るときと同じ回数だけ呼んで、sleep の合計を出す。 */
function totalDelayMs(totalMessages: number, batchSize: number): number {
  const batches = Math.ceil(totalMessages / batchSize);
  let sum = 0;
  // batchIndex = 0 は遅延なしで呼ばれない。1 から数える。
  for (let i = 1; i < batches; i += 1) sum += calculateStaggerDelay(totalMessages, i, batchSize);
  return sum;
}

// 約束は「合計 20 秒」。ジッターは 1 回あたり base の 2 割（上限 500ms）を上乗せ
// するので、理論上の最大は 20,000 × 1.2 = 24,000ms。少し余裕を見て 25 秒で切る。
// ここを緩くすると、ずれていても素通りしてしまう（実際、最初に 120 秒で書いたら
// 101 人のときの 50 秒を見逃した）。
const CEILING_MS = 25_000;

describe('ステアリング遅延', () => {
  it('multicast（1バッチ500人）では、合計が実行の枠に収まる', () => {
    expect(totalDelayMs(5000, 500)).toBeLessThanOrEqual(CEILING_MS);
    expect(totalDelayMs(50_000, 500)).toBeLessThanOrEqual(CEILING_MS);
  });

  it('1バッチ10人で回っても、合計が実行の枠に収まる', () => {
    // 差し込みのバッチ数でも合計20秒の上限を守る。
    expect(totalDelayMs(5000, 10)).toBeLessThanOrEqual(CEILING_MS);
    expect(totalDelayMs(1000, 10)).toBeLessThanOrEqual(CEILING_MS);
  });

  it('1バッチ10人・101人で、待ち時間が跳ね上がらない', () => {
    // 100 人までは短い遅延で済む。101 人で急に何十秒も待つようだと、
    // 5分ごとの処理を止めないよう、合計遅延を制限する。
    const at100 = totalDelayMs(100, 10);
    const at101 = totalDelayMs(101, 10);
    expect(at100).toBeLessThanOrEqual(CEILING_MS);
    expect(at101).toBeLessThanOrEqual(CEILING_MS);
  });

  it('バッチサイズを渡さないと、これまでどおり500人ぶんとして計算する', () => {
    // 既存の呼び出しを壊していないことの確認。
    const withDefault = calculateStaggerDelay(5000, 1);
    const with500 = calculateStaggerDelay(5000, 1, 500);
    // ジッターがあるので値は一致しない。同じ桁に収まることを見る。
    expect(Math.abs(withDefault - with500)).toBeLessThan(1500);
  });

  it('バッチサイズに0を渡しても、0で割らない', () => {
    expect(Number.isFinite(calculateStaggerDelay(5000, 1, 0))).toBe(true);
  });
});
