import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * #973 U045: 友だち追加時の実行結果（/friend-add-settings/runs）で、
 * 名前・結果・詳細・時刻を1行に並べたカードの右端が切れていた。
 */
describe('友だち追加の実行結果カード（#973 U045）', () => {
  it('1行目は名前と結果、2行目は時刻と詳細に分ける', () => {
    // 各行の先頭が2段構成になっている（flex 行 + 続く時刻・詳細の行）。
    expect(PAGE).toContain('min-w-0 py-3')
    const rows = PAGE.match(/min-w-0 py-3[\s\S]{0,2500}?formatJstDateTime\(item\.receivedAt\)/g)
    expect(rows, '時刻を含む2段目が見つからない').not.toBeNull()
    expect(rows!.length).toBeGreaterThanOrEqual(1)
  })

  it('時刻に固定幅を課さず、日時まで読める', () => {
    // かつての `w-12`（時:分だけ）は狭い行で右端を切る元だった。
    expect(PAGE).not.toContain('w-12 shrink-0')
    expect(PAGE).toContain('formatJstDateTime(item.receivedAt)')
  })

  it('詳細への導線は2段目に残る', () => {
    const detailRow = PAGE.match(/formatJstDateTime\(item\.receivedAt\)[\s\S]{0,600}?\/friend-add-settings\/runs\/detail/)
    expect(detailRow, '時刻と同じ段に詳細リンクが無い').not.toBeNull()
  })
})
