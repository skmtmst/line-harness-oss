import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const FIXTURES = readFileSync(
  join(HERE, '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'fixtures.mjs'),
  'utf8',
)

/**
 * 点検 #490 中5・中6 の再発防止。
 *
 * 中5: 保存検索の形が画面（titleQuery/statusFilter/dateFrom/dateTo/
 * folderFilter）と fixture（statuses/openRateMax）で違い、保存表示を
 * 選んでも何も変わらなかった。
 * 中6: モックの代表者行に画像・要約が無く、画面の参照（pictureUrl/
 * summary）とずれていた。
 */
describe('一斉配信の保存検索と対象プレビュー（点検 #490 中5・中6）', () => {
  it('旧形式の保存検索（statuses）を新形式に読み替える', () => {
    expect(PAGE).toContain('legacyStatuses')
    expect(PAGE).toContain("legacyStatuses.includes('scheduled')")
  })

  it('fixtureの保存検索は保存側と同じ形にする', () => {
    expect(FIXTURES).toContain(
      "filters: { titleQuery: '', statusFilter: 'scheduled', dateFrom: '', dateTo: '', folderFilter: '' }",
    )
    // 「予約中のみ」の旧形を残さない（受信箱など他機能の `statuses` は別。
    // 「開封率が低い」の扱いは票 #553 で司令塔の判断待ち）。
    expect(FIXTURES).not.toContain("filters: { statuses: ['scheduled'] }")
  })

  it('fixtureの代表者行は画面と口の実形（pictureUrl/summary）にする', () => {
    expect(FIXTURES).toContain('pictureUrl: null, summary:')
  })
})
