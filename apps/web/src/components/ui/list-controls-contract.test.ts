import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 監査6 #668: 一覧のフィルターバーを「検索 → 絞り込み → 並び順 → 表示件数」
 * の1形へそろえる。
 *
 * 以前は「並び順」「表示」「絞り込み」の前置きラベルの有無が画面ごとに違い、
 * 「保存した検索」は押せるボタン・選び口・押せない札が混在し、
 * 共通情報の並び順は幅が足りず選択中の語が切れていた。
 *
 * 並び順・表示件数を持つ画面は SortSelect / PageSizeSelect を呼び、
 * ツールバーの並び順をソース上の位置で縛る。
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** 並び替えを持つ一覧（SortSelect を呼ぶ画面）。 */
const SORT_SELECT_USERS: Array<[string, string]> = [
  ['リマインダ', '../../app/reminders/page.tsx'],
  ['自動応答', '../../app/auto-replies/page.tsx'],
  ['ウェビナー', '../../app/webinars/page.tsx'],
  ['共通情報', '../../app/contents/vars/page.tsx'],
]

/** 表示件数を持つ一覧（PageSizeSelect を呼ぶ画面）。 */
const PAGE_SIZE_SELECT_USERS: Array<[string, string]> = [
  ['リマインダ', '../../app/reminders/page.tsx'],
  ['自動応答', '../../app/auto-replies/page.tsx'],
  ['ウェビナー', '../../app/webinars/page.tsx'],
  ['共通情報', '../../app/contents/vars/page.tsx'],
  ['友だち一覧', '../friends/friend-list-table.tsx'],
]

/** 「検索 → 絞り込み → 並び順 → 表示件数」の順で並ぶ画面。 */
const TOOLBAR_ORDER: Array<[string, string, string[]]> = [
  ['リマインダ', '../../app/reminders/page.tsx', ['type="search"', '>よく使う絞り込み<', '<SortSelect', '<PageSizeSelect']],
  ['自動応答', '../../app/auto-replies/page.tsx', ['type="search"', '>よく使う絞り込み<', '<SortSelect', '<PageSizeSelect']],
  ['ウェビナー', '../../app/webinars/page.tsx', ['type="search"', '>よく使う絞り込み<', '<SortSelect', '<PageSizeSelect']],
  ['共通情報', '../../app/contents/vars/page.tsx', ['data-search-row', '>よく使う絞り込み<', '<SortSelect', '<PageSizeSelect']],
]

/** 固定の絞り込みチップの前置きは「よく使う絞り込み」の1形（DETAIL-20 の語）。 */
const FILTER_LABEL_USERS: Array<[string, string]> = [
  ['シナリオ', '../../app/scenarios/page.tsx'],
  ['自動応答', '../../app/auto-replies/page.tsx'],
  ['ウェビナー', '../../app/webinars/page.tsx'],
  ['リッチメニュー', '../../app/rich-menus/page.tsx'],
  ['共通情報', '../../app/contents/vars/page.tsx'],
  ['リマインダ', '../../app/reminders/page.tsx'],
]

describe('フィルターバー統一（監査6 #668）', () => {
  it.each(SORT_SELECT_USERS.map(([name, path]) => ({ name, path })))(
    '$name の並び順は SortSelect',
    ({ path }) => {
      const source = read(path)
      expect(source, `${path} に SortSelect がない`).toContain('SortSelect')
      // 部品の外で素の SelectField を「並び順」用に置かない
      expect(source, `${path} に素の並び順セレクトが残っている`).not.toMatch(
        /SelectField[^)]*aria-label="並び順"/,
      )
    },
  )

  it.each(PAGE_SIZE_SELECT_USERS.map(([name, path]) => ({ name, path })))(
    '$name の表示件数は PageSizeSelect',
    ({ path }) => {
      const source = read(path)
      expect(source, `${path} に PageSizeSelect がない`).toContain('PageSizeSelect')
      expect(source, `${path} に素の表示件数セレクトが残っている`).not.toMatch(
        /SelectField[^)]*aria-label="表示件数"/,
      )
    },
  )

  it.each(TOOLBAR_ORDER.map(([name, path, markers]) => ({ name, path, markers })))(
    '$name は「検索 → 絞り込み → 並び順 → 表示件数」の順',
    ({ path, markers }) => {
      const source = read(path)
      let previous = -1
      for (const marker of markers) {
        const index = source.indexOf(marker)
        expect(index, `${path} に ${marker} がない`).toBeGreaterThan(-1)
        expect(index, `${path} で ${marker} が前の項目より先にある`).toBeGreaterThan(previous)
        previous = index
      }
    },
  )

  it.each(FILTER_LABEL_USERS.map(([name, path]) => ({ name, path })))(
    '$name の絞り込みチップの前置きは「よく使う絞り込み」',
    ({ path }) => {
      const source = read(path)
      expect(source, `${path} に「よく使う絞り込み」の前置きがない`).toContain('>よく使う絞り込み<')
      // 旧い前置き（よく使う単体 / 保存した条件 / 保存した検索）は残さない
      expect(source).not.toContain('>よく使う<')
      expect(source).not.toContain('>保存した条件<')
      expect(source).not.toMatch(/<span[^>]*>保存した検索<\/span>/)
    },
  )

  it('テンプレート一覧に押せない「保存した検索」の札を置かない', () => {
    const source = read('../../app/templates/page.tsx')
    expect(source).not.toMatch(/<span[^>]*>保存した検索<\/span>/)
  })

  it('マイレージのランク別人数は押せるチップの形にしない', () => {
    const source = read('../../app/mileage/page.tsx')
    // 内訳は字だけの行。固定の並びは「並び順：」の前置きで固定値だと分かる形。
    expect(source).toContain('並び順：残高が多い順')
    expect(source).not.toMatch(/rounded-full[^`]*rank\.rankName/)
  })

  it('チャットの担当者ラベルはドロップダウン内の1つだけ', () => {
    const source = read('../../app/chats/page.tsx')
    expect(source).toContain('OperatorDropdown')
    expect(source).not.toContain('>担当者</span>')
  })
})
