import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const RAW = readFileSync(new URL('./tabs.tsx', import.meta.url), 'utf8')

/*
  注釈を落とす。**「なぜ直したか」を書いた文が、直したはずの字面に当たる。**
  ここでは `as unknown as ReportV2` を禁じているが、その理由を書いた注釈に
  同じ字面が入るので、消してから見ないと直したのに落ちる。
*/
const TABS = RAW
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/*
  **集計の返事を、確かめずに数として扱わない。**

  集計は期間で絞れるので、その期間に成果が1件も無い紹介者は**行そのものが
  返らない**。一覧には載っているので押せてしまい、
  `report.clicks.toLocaleString()` で**内訳の面ごと落ちていた**
  （`Cannot read properties of undefined (reading 'toLocaleString')`）。

  ここが緩むと、押した運用者には「壊れた」としか見えない。
*/
describe('紹介者の内訳は、集計が読めないときに落ちない', () => {
  it('返事を確かめてから入れる（型で嘘をつかない）', () => {
    expect(TABS).toContain('asReportV2(reportRes.data)')
    expect(TABS, '確かめずに型を当てている').not.toContain('as unknown as ReportV2')
  })

  it('数として読めない返事は入れない', () => {
    const start = TABS.indexOf('function asReportV2')
    expect(start, '形の検査が見つからない').toBeGreaterThan(-1)
    const guard = TABS.slice(start, TABS.indexOf('\n}\n', start))
    // 配列や null を弾く
    expect(guard).toContain('Array.isArray(raw)')
    // 数の欄が数であることを見る
    expect(guard).toContain('Number.isFinite')
    // 一覧で回す欄が配列であることを見る
    expect(guard).toContain('Array.isArray(value.byOffer)')
  })

  it('読めなかったことを0件として描かない', () => {
    expect(TABS).toContain('この期間の集計を取得できませんでした')
    expect(TABS, '記録が消えたと読ませない').toContain('リンクと成果の記録は消えていません')
  })
})
