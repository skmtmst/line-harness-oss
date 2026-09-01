import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

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
    expect(PAGE).toContain("draft: '下書き'")
    expect(PAGE).toContain("scheduled: '予約ずみ'")
    expect(PAGE).toContain("queued: '配信待ち'")
    expect(PAGE).toContain("sent: '出したもの'")
    expect(PAGE).toContain("{columnDeliveryStatusLabel[column.deliveryStatus] ?? '—'}")
    expect(PAGE).not.toContain('{column.deliveryStatus}</span>')
  })
})
