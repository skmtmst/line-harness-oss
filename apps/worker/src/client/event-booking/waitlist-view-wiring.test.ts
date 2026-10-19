/*
 * 画面が `waitlist-view.ts` の判断を本当に通しているかを走査する試験
 * (#747 / N-416)。
 *
 * **なぜ必要か。**worker の vitest は `src/**\/*.test.ts` だけを拾い、
 * `.tsx` は拾わない。描画の土台も無いので、`main.tsx` の中身は普通の
 * 試験からは見えない。切り出した関数だけを試験すると、**画面がその関数を
 * 使わなくなっても緑のまま**になる。
 *
 * 実際そうなった。逆変異を当てたところ、`main.tsx` を
 *   const disabled = isSlotDisabled({ full, waitlistOpen, overLimit });
 * から
 *   const disabled = full || overLimit;
 * へ戻しても、`onDone(bookingOutcome(res))` を `onDone(res.status)` へ
 * 戻しても、**どの試験も赤くならなかった**(2026-09-12)。つまり直したはずの
 * 2つは、切り出し先を見張っているだけで、画面については何も見張って
 * いなかった。この走査はその蓋である。
 *
 * 見張るのは2つ。
 *  1. `main.tsx` が4つの関数を呼んでいること(迂回したら赤)
 *  2. 迂回の形そのもの(自前の `full || overLimit`、`res.status` の直渡し)が
 *     `main.tsx` に無いこと
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(join(HERE, 'main.tsx'), 'utf8');

/** 画面が必ず通すべき判断。`waitlist-view.ts` 側は素の試験で見張っている。 */
const REQUIRED_CALLS = [
  'isSlotDisabled(',
  'slotSeatLabel(',
  'bookingOutcome(',
  'doneScreenCopy(',
] as const;

/**
 * 迂回の形。ここに挙げたのは**実際に直す前の main.tsx に書かれていた式**で、
 * 逆変異でそのまま戻せてしまったもの。
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /const\s+disabled\s*=\s*full\s*\|\|\s*overLimit/,
    why: '満席の枠をキャンセル待ちの有無に関係なく押せなくしている（直す前の形）',
  },
  {
    pattern: /onDone\(\s*res\.status/,
    why: '待ちの応答(200 + waitlisted)を確定として完了画面へ渡している（直す前の形）',
  },
  {
    pattern: /status\s*===\s*'requested'\s*\?\s*'受付しました'/,
    why: '完了画面の文言を画面側で組み立てている（待ちの3通り目が落ちる）',
  },
];

describe('画面がキャンセル待ちの判断を切り出し先へ通しているか', () => {
  test.each(REQUIRED_CALLS)('main.tsx が %s を呼んでいる', (call) => {
    expect(MAIN).toContain(call);
  });

  test('waitlist-view.js から取り込んでいる', () => {
    expect(MAIN).toMatch(/from '\.\/waitlist-view\.js'/);
  });

  test.each(FORBIDDEN_PATTERNS)('迂回の形が残っていない: $why', ({ pattern }) => {
    expect(MAIN).not.toMatch(pattern);
  });
});
