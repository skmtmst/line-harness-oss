import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * TECH-02（INBOX-21 の残り）: 配信詳細の日時が端末の時間帯に
 * 依存していた。予約は日本時間の約束なので、表示も Asia/Tokyo で固定する。
 * timeZone を書かない toLocaleString が戻ると、タイ・米国などの端末で
 * 一覧・完了画面と違う時刻に見える。
 *
 * 旧詳細（`components/broadcasts/broadcast-detail.tsx`）を消したため、
 * 新しい詳細が使う日時部品（`app/broadcasts/detail/broadcast-insight-display.ts`
 * の `formatBroadcastDateTime`）を見張る。意図は変えない。
 */
const SOURCE = readFileSync(join(__dirname, '..', '..', 'app', 'broadcasts', 'detail', 'broadcast-insight-display.ts'), 'utf8')

describe('配信詳細の予約日時は日本時間で出す（TECH-02）', () => {
  it('詳細の日時は Asia/Tokyo で出す', () => {
    expect(SOURCE).toContain('formatBroadcastDateTime')
    expect(SOURCE).toContain("timeZone: 'Asia/Tokyo'")
  })
})
