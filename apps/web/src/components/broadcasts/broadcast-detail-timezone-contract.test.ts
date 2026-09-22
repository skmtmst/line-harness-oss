import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * TECH-02（INBOX-21 の残り）: 配信詳細の「予約日時」が端末の時間帯に
 * 依存していた。予約は日本時間の約束なので、表示も Asia/Tokyo で固定する。
 * timeZone を書かない toLocaleString が戻ると、タイ・米国などの端末で
 * 一覧・完了画面と違う時刻に見える。
 */
const SOURCE = readFileSync(join(__dirname, 'broadcast-detail.tsx'), 'utf8')

describe('配信詳細の予約日時は日本時間で出す（TECH-02）', () => {
  it('scheduledAt の表示に Asia/Tokyo を指定している', () => {
    const row = SOURCE.match(/予約日時[\s\S]*?scheduledAt[\s\S]*?dd>/)
    expect(row, '予約日時の行が見つからない').not.toBeNull()
    expect(row![0]).toContain("timeZone: 'Asia/Tokyo'")
  })
})
