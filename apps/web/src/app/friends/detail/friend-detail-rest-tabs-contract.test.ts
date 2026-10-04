import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/*
 * 友だち詳細 `Q5F2QE` の残りタブ（概要・履歴・回答フォーム・情報欄のV8）。
 * 情報欄タブは #1236 の分。合流して4枚になった。
 * 4タブとも中身は見本どおりにそろっているので、V8だけ板IDを付ける。
 * v7 は変えない。
 */
describe('友だち詳細の残りタブ（Q5F2QE）', () => {
  it('V8の詳細全体に板IDを付け、4タブを切り替えられる', () => {
    expect(PAGE).toContain('data-friends-detail-design="v8" data-design-node="Q5F2QE"')
    for (const tab of ['timeline', 'history', 'forms', 'info']) {
      expect(PAGE).toContain(`tab === '${tab}'`)
    }
  })

  it('3タブの見せ場はそのまま', () => {
    expect(PAGE).toContain('進行中の配信・自動処理')
    expect(PAGE).toContain('さらに読み込む')
    expect(PAGE).toContain('フォームの回答はまだありません')
  })
})
