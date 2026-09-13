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
    expect(PAGE.indexOf('<Tabs')).toBeLessThan(PAGE.indexOf('data-design="KPIs"'))
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

  it('AIは確認順の補助に限り、人の判断を自動化しない', () => {
    expect(PAGE).toContain('確認順を決める条件')
    expect(PAGE).toContain('自動で見つけた注意候補の総数です。通す・戻す・公開する判断は、必ず人が行います。')
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
    for (const href of ['/chats', '/friends', '/ec-commerce', '/contents', '/templates']) {
      expect(PAGE, `${href} への行き先がありません`).toContain(`href: '${href}'`)
    }
  })

  it('1920pxでは設計どおり4列で並べ、右390pxを残す', () => {
    expect(PAGE).toContain('mx-auto flex max-w-full flex-col gap-4 p-4 sm:p-6')
    expect(PAGE).toContain('grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-4')
    expect(CSS).toContain('grid-template-columns: minmax(0, 1fr) 390px;')
  })

  it('選択した審査待ち写真だけを一括審査APIへ送る', () => {
    expect(PAGE).toContain('枚を選択中')
    expect(PAGE).toContain('togglePhotoSelection')
    expect(PAGE).toContain('まとめて通す')
    expect(PAGE).toContain('まとめて戻す')
    expect(PAGE).toContain('api.nenMembers.bulkReviewPhotos')
    expect(PAGE).toContain('selectedPendingPhotos.map')
    expect(PAGE).toContain('selectedPhotosAreLowRisk')
    expect(PAGE).toContain('setBulkApproveOpen(true)')
    expect(PAGE).toContain("onConfirm={() => void bulkReview('approve')}")
    expect(PAGE).toContain('setBulkReturnOpen(true)')
    expect(PAGE).toContain('crypto.randomUUID()')
    expect(PAGE).toContain('合計 {selectedPendingPhotos.length * 5}ポイント')
    expect(PAGE).toContain('公開しない')
  })
})
