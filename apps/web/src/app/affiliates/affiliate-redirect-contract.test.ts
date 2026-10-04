import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DIALOGS = readFileSync(new URL('./action-dialogs.tsx', import.meta.url), 'utf8')

describe('アーカイブ確認の「ここを開く」 (#1058・R291)', () => {
  it('対象紹介者の明細へ直接つなぐ（案件一覧・成果地点へ迷い込ませない）', () => {
    // R291: 発行ずみの紹介リンクは対象紹介者の内訳、承認待ちは対象紹介者で
    // 絞った成果承認タブへ向く。行き先は直接書く。
    expect(DIALOGS).toContain('tab=affiliates&affiliate=')
    expect(DIALOGS).toContain('tab=approvals&affiliate=')
    expect(DIALOGS).not.toContain('href="/conversions?tab=offers">ここを開く')
    expect(DIALOGS).not.toContain('href="/conversions">ここを開く')
    // 旧URL経由にすると /affiliate-offers → /affiliates → /conversions と
    // 2回リダイレクトを踏む。行き先は直接書く。
    expect(DIALOGS).not.toContain('href="/affiliate-offers"')
  })
})
