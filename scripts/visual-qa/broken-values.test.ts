/*
 * 撮った画面に `undefined` や `NaN` が写っていないかの試験。
 *
 * **絵では見つからなかった。** 表の1列に紛れていて、262枚を人が見比べても
 * 素通りする。文字にしてから数えたら 101回と 6回あった。
 *
 *   templates-v6/W7LBc ほか4枚 … 「undefined件で使用」が一覧の20行すべてに
 *   mileage-v6/z3PB2            … 「いまの点数」の列が `NaN`
 *   broadcasts-v6/u6gHt         … 「1通（undefined）」
 *
 * どれも「値が入っていないときに素通しする」形が元。
 * `Intl.NumberFormat(undefined)` は `NaN` を返し、テンプレート文字列は
 * `undefined` をそのまま並べる。**取れていないことを言う**か、
 * 0 と言い分けるかを、出す側で決める。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { ROOT } from './cited-shots.mjs';

const CAPTURED = join(ROOT, 'docs', 'design-qa');

/** 画面に出てはいけない、こわれた値。 */
const BROKEN = [
  { word: 'undefined', why: '値が入っていないのを素通ししている' },
  { word: 'NaN', why: '数でないものを数として整形している' },
  { word: '[object Object]', why: '入れ物をそのまま文字にしている' },
];

function capturedTexts(): Array<{ file: string; text: string }> {
  if (!existsSync(CAPTURED)) return [];
  const out: Array<{ file: string; text: string }> = [];
  for (const dir of readdirSync(CAPTURED, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const path = join(CAPTURED, dir.name);
    for (const entry of readdirSync(path)) {
      if (!entry.endsWith('.txt')) continue;
      out.push({ file: `${dir.name}/${entry}`, text: readFileSync(join(path, entry), 'utf8') });
    }
  }
  return out;
}

const TEXTS = capturedTexts();

describe('撮った画面にこわれた値が出ていない', () => {
  it('撮影結果が在る（0枚なら、この試験は何も見ていない）', () => {
    expect(TEXTS.length).toBeGreaterThan(50);
  });

  for (const { word, why } of BROKEN) {
    it(`画面に「${word}」が出ていない（${why}）`, () => {
      const hits = TEXTS
        .filter(({ text }) => text.includes(word))
        .map(({ file, text }) => `${file}（${text.split(word).length - 1}回）`);
      expect(hits, `出す側で「取れていない」と言い分けてください:\n  ${hits.join('\n  ')}`).toEqual([]);
    });
  }
});
