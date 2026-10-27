import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * 友だち詳細の情報欄・回答・履歴・準備中タブ（FRIEND-21〜27・31）の禁止の見張り。
 * 振る舞いは friend-detail-tabs-behavior.test.tsx（分類・ラベル・隠れた項目・回答・履歴の続き・準備中タブ）と
 * v8/friend-detail/use-friend-detail.test.tsx（保存待ちの追記）が描いて確かめる。狭い幅の畳み方は v8-screen-guard が見る。
 */
describe('友だち詳細の禁止の見張り', () => {
  it('FRIEND-27: 開発者向けの「口がまだありません」で行き止まりにしない', () => {
    expect(PAGE).not.toContain('を引く口がまだありません')
  })

  it('FRIEND-31: PC由来の固定高をスマートフォンへ持ち込まない', () => {
    expect(PAGE).not.toContain('style={{ minHeight: 1234 }}')
    expect(PAGE).not.toContain('min-height: 1234px')
  })
})
