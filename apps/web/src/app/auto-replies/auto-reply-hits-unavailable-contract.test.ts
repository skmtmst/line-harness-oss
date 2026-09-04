import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { metricWord } from './auto-reply-words'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * 自動応答一覧（設計 `cmDfJ` 8-1 ／ `q8wSqO` 8-1-J）で、
 * **ヒット数が「数えられていない」ことと「0回だった」ことを取り違えない**。
 *
 * ヒット数はルールごとに返る。**1つでも欠けていると合計は足りない**のに、
 * `?? 0` で埋めて足すと、実測より小さい数を実測として読ませることになる。
 * 「未ヒット」に混ざると、当たっているかもしれないルールが**消してよいもの**
 * として並ぶ。
 */
describe('ヒット数の未取得', () => {
  it('数が無いときは — にする', () => {
    expect(metricWord('ready', null)).toBe('—')
  })

  it('読めた 0 は 0 のまま出す', () => {
    /* 「一度も当たらなかった」は事実。`—` にすると分からなくなる。 */
    expect(metricWord('ready', 0)).toBe('0')
  })

  it('読み込み中・失敗のときは、数を出さない', () => {
    for (const state of ['loading', 'error', 'forbidden'] as const) {
      expect(metricWord(state, 12)).toBe('—')
    }
  })
})

describe('一覧の帯と行（設計 8-1 `cmDfJ`）', () => {
  it('ヒット数が1つでも欠けていたら、合計を出さない', () => {
    expect(PAGE).toContain('const hitsAllKnown = items.length > 0 && items.every((r) => r.hits !== undefined)')
    expect(PAGE, '足りない合計をそのまま出している').not.toContain(
      'const monthlyHits = items.reduce((sum, r) => sum + (r.hits?.period ?? 0), 0)',
    )
    expect(PAGE).toContain('const monthlyHits = hitsAllKnown')
    expect(PAGE).toContain('const totalHits = hitsAllKnown')
  })

  it('数えられていないルールを「未ヒット」に数えない', () => {
    /* `?? 0` だと、数えられていないだけのルールが未ヒットに混ざる。 */
    expect(PAGE).toContain('items.filter((r) => r.hits?.total === 0).length')
    expect(PAGE, '未取得を0として数えている').not.toContain('items.filter((r) => (r.hits?.total ?? 0) === 0)')
  })

  it('「未ヒット」の絞り込みも、未取得を混ぜない', () => {
    expect(PAGE).toContain("if (savedFilter === 'never') return r.hits?.total === 0")
  })

  it('行のヒット数を 0 で埋めない', () => {
    expect(PAGE).toContain("{r.hits?.period ?? '—'}")
    expect(PAGE).toContain("（累計 {r.hits?.total ?? '—'}）")
    expect(PAGE).not.toContain("{r.hits?.period ?? 0}")
    expect(PAGE).not.toContain("（累計 {r.hits?.total ?? 0}）")
  })

  it('累計の副題にも、未取得のときは数を出さない', () => {
    expect(PAGE).toContain("累計 ${totalHits ?? '—'}回")
  })
})

describe('「準備中」を出さない（v6-common-rules §5-5）', () => {
  it('絞り込みの説明に「準備中」を残さない', () => {
    /*
     * 「一度も当たっていないルール（30日以上の絞り込みは準備中）」と
     * 出ていた。**動くまで描かない。** 押せない機能の位置だけを見せても、
     * いつ使えるようになるのか分からない。
     */
    expect(PAGE).not.toContain('準備中')
    expect(PAGE).toContain("? '一度も当たっていないルール'")
  })
})
