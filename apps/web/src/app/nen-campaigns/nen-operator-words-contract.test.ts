import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const OVERVIEW = fs.readFileSync(path.join(__dirname, '../../v8/nen-campaigns/list.tsx'), 'utf8')

describe('V8 NEN配信の運用者向け文言契約', () => {
  it('メニューと画面でNEN配信の名前をそろえる', () => {
    expect(PAGE).toContain("usePageTitle('NEN配信')")
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('title="フォロー配信"')
  })

  it('使えないヘッダー操作を並べない', () => {
    expect(PAGE).not.toContain("['マニュアル', '並び替え', 'フォルダを追加する']")
    expect(PAGE).not.toContain('title="準備中です"')
  })

  it("コラムの状態を内部値のまま表示しない", () => {
    for (const label of ['送っていない', '予約中', '配信待ち', '送信済み']) expect(OVERVIEW).toContain(label)
    expect(OVERVIEW).toContain('columnBadge(column, metric?.sent ?? null)')
    expect(OVERVIEW).not.toContain('{column.deliveryStatus}</span>')
  })

  it('「ポイント」の語を出さない（然の用語はマイル）', () => {
    expect(OVERVIEW).not.toContain('ポイント')
    expect(PAGE).not.toContain('ポイント')
  })
})
