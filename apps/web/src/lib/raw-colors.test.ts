/*
 * 生の Tailwind の色を、**これ以上増やさない**ための試験。
 *
 * `design-tokens.test.ts` は「自分たちの語彙が定義どおりに書けているか」しか
 * 見ていない。だから `bg-white` や `text-gray-500` は**素通りする**。
 * 色は実際に出るので、目で見ても間違いに見えない。
 *
 * いま 3,476 か所ある。一晩で書き換えるのは危ない（画面が壊れても、誰も
 * 見ていない時間に入る）ので、**増えたら落ちる**形にした。
 *
 *   - ファイルごとの数が基準より増えたら落ちる
 *   - 基準に無いファイルに1か所でもあれば落ちる
 *   - 減ったときも落ちる。基準を締め直さないと、また増える余地が残るため
 *
 * 直し方はどちらも同じ:
 *
 *     node apps/web/scripts/raw-color-baseline.mjs
 *
 * **わざと生の色を使う場所**もある。たとえば一斉配信のプレビューは
 * LINEのトーク画面を描いたもので、アプリの色ではない
 * （`broadcast-form.tsx` の `LINE_MOCK`）。そういう場所は名前を付けて
 * 理由をコメントに書く。数としては基準に残る。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { countRawColors, BASELINE } from '../../scripts/raw-color-baseline.mjs'

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>

describe('生の Tailwind の色', () => {
  const now = countRawColors()

  it('増えていない', () => {
    const worse: Record<string, string> = {}
    for (const [file, count] of Object.entries(now)) {
      const was = baseline[file] ?? 0
      if (count > was) worse[file] = `${was} → ${count}`
    }
    // 落ちたら: トークンに直すか、意図があるならコメントを書いて
    // node apps/web/scripts/raw-color-baseline.mjs で基準を更新してください。
    expect(worse).toEqual({})
  })

  it('減ったら基準も締め直されている', () => {
    const better: Record<string, string> = {}
    for (const [file, was] of Object.entries(baseline)) {
      const count = now[file] ?? 0
      if (count < was) better[file] = `${was} → ${count}`
    }
    // 落ちたら: node apps/web/scripts/raw-color-baseline.mjs
    expect(better).toEqual({})
  })
})
