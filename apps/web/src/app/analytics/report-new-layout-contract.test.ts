import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./reports/new/page.tsx', import.meta.url), 'utf8')

/*
 * R229: 「いつ送りますか」の欄は Select の標準幅(176px)固定だと
 * 中間の画面幅(1295px)で隣の欄に重なっていた。列の幅に合わせる
 * size="full" で、どの画面幅でも列の中に収まる。
 */
describe('定期レポート「いつ送りますか」の幅 (R229)', () => {
  it('間隔・曜日/日・集計期間は列の幅に合わせる（固定176pxへ戻さない）', () => {
    expect(PAGE).not.toContain('size="standard"')
    for (const label of ['間かく', '送る曜日', '送る日', '集計する期間']) {
      const line = PAGE.split('\n').find((l) => l.includes(`aria-label="${label}"`))
      expect(line, label).toBeTruthy()
      expect(line).toContain('size="full"')
    }
  })

  it('4欄を横に並べる組み方は維持する（欄を消して幅を稼がない）', () => {
    expect(PAGE).toContain('md:grid-cols-4')
  })
})

/* 板 `H5UoIu`「知らせの決めごと」：3つ目の札の名まえは絵どおり「続いた日数」。 */
describe('定期レポート「知らせの決めごと」の札名', () => {
  it('成果0件の札は「続いた日数」と出す', () => {
    expect(PAGE).toContain("thresholdLabel: '続いた日数'")
  })
})
