import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 写真審査一覧（★V6 `Qu6Vk`）の骨格の見張り。
 *
 * `photo-review-contract.test.ts` は言葉と状態の分けかたを見ている。
 * こちらは**寸法と枠**を見る。分けているのは、直す理由が違うから。
 * 文言を変えたときに寸法の試験まで落ちると、どちらが壊れたのか分からない。
 */

const HERE = import.meta.dirname
const SHARED = join(HERE, '..', '..', 'components', 'shared')
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, 'photo-review.module.css'), 'utf8')

describe('V6 写真審査一覧（Qu6Vk）の骨格', () => {
  it('状態の切り替えはタブ帯（高さ44）で出す', () => {
    expect(PAGE).toContain("import { Tabs } from '@/components/shared/tabs'")
    expect(PAGE).toContain('<Tabs')
    // ボタン列で代用しない。押しボタンの帯は高さ40で、タブ帯の44にならない。
    expect(PAGE).not.toContain('rounded-control px-4 py-2.5')
    expect(readFileSync(join(SHARED, 'tabs.module.css'), 'utf8')).toContain('height: 44px;')
  })

  it('件数が取れていないときは — を出し、0件と読み替えない', () => {
    expect(PAGE).toContain("countsReady ? counts[value] : '—'")
    expect(PAGE).toContain('const countsReady = Boolean(selectedAccountId) && !loading && !loadError')
  })

  it('カードは r10、カードの中のまとまりは r8', () => {
    // 角丸は1系統になった。card=10px、control=8px。
    // 値そのものは design-token-contract.test.ts が固定している。
    expect(PAGE).toContain('rounded-card')
    expect(PAGE).toContain('rounded-control')
  })

  it('右カラムは390px', () => {
    expect(PAGE).toContain('data-design="Right"')
    expect(CSS).toContain('grid-template-columns: minmax(0, 1fr) 390px;')
    expect(CSS).toMatch(/\.sideCard\s*\{[^}]*border-radius: var\(--radius-card\);/)
  })

  it('自動で戻す条件は未接続として出し、数を作らない', () => {
    expect(PAGE).toContain('自動で戻す条件')
    expect(PAGE).toContain(
      'まだ繋がっていません。自動審査の口が接続されると表示されます。公開するかどうかは、いまも人が決めます。',
    )
    // 口が無いのに「自動で戻しました」と読める押し口・件数を置かない。
    expect(PAGE).not.toContain('自動で戻しました')
    expect(PAGE).not.toContain('自動審査を実行')
  })

  it('戻す理由の内訳は読み込めた写真から数え、取れないうちは — を出す', () => {
    expect(PAGE).toContain('戻す理由の内訳')
    expect(PAGE).toContain('const reasonCounts = useMemo(')
    expect(PAGE).toContain("if (text(photo.status) !== 'rejected') continue")
    expect(PAGE).toContain('{reasonCounts[reason.value]}件')
    // 読み込む前・失敗時に 0件 と書かない。
    expect(PAGE).toContain('countsReady ? (')
    expect(PAGE).toContain('読み込めませんでした')
    expect(PAGE).toContain('読み込んでいます')
  })

  it('つながる先は共通部品で出す', () => {
    expect(PAGE).toContain("import { FeatureLinkCard } from '@/components/shared/side-cards'")
    for (const href of ['/nen-campaigns', '/line-notifications', '/ec-commerce']) {
      expect(PAGE, `${href} への行き先がありません`).toContain(`href: '${href}'`)
    }
  })
})
