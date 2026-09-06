import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const OVERVIEW = fs.readFileSync(path.join(__dirname, 'nen-overview.tsx'), 'utf8')

describe('V6 NEN配信の運用者向け文言契約', () => {
  it('メニューと画面でNEN配信の名前をそろえる', () => {
    expect(PAGE).toContain('Header title="NEN配信"')
    expect(PAGE).toContain('title="NEN配信"')
    expect(PAGE).not.toContain('title="フォロー配信"')
  })

  it('使えないヘッダー操作を並べない', () => {
    expect(PAGE).not.toContain("['マニュアル', '並び替え', 'フォルダを追加']")
    expect(PAGE).not.toContain('title="準備中です"')
  })

  it('コラムの状態を内部値のまま表示しない', () => {
    expect(OVERVIEW).toContain("draft: '下書き'")
    expect(OVERVIEW).toContain("scheduled: '予約ずみ'")
    expect(OVERVIEW).toContain("queued: '配信待ち'")
    expect(OVERVIEW).toContain("sent: '出したもの'")
    expect(OVERVIEW).toContain('{columnStatusLabel[column.deliveryStatus]}')
    expect(OVERVIEW).not.toContain('{column.deliveryStatus}</span>')
  })
})
