import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
const DIALOG = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'components', 'friends', 'advanced-search-dialog.tsx'),
  'utf8',
)

/*
 * U011-U013: 詳細検索（絞り込み条件を設定）が狭い幅で潰れていた。
 * 共通部品・ダイアログ本体の形は変えず、画面側の `data-friends-advanced-search`
 * ラッパーに効く scoped style で、パネルの内幅672px（左右余白込み720px）
 * 未満のときだけ縦に組み直す。
 */
describe('U011-U013 詳細検索の狭幅対応', () => {
  it('パネルをコンテナにして、内幅672px未満でだけ組み換える', () => {
    expect(PAGE).toContain('data-friends-advanced-search')
    expect(PAGE).toContain('container-type: inline-size')
    expect(PAGE).toContain('@container (max-width: 720px)')
  })

  it('U011: 項目・比較方法・値を各1行・全幅にする', () => {
    expect(PAGE).toContain('section.grid { grid-template-columns: minmax(0, 1fr); }')
    expect(PAGE).toContain('section.grid > * { grid-column: 1 / -1; }')
    expect(PAGE).toContain('flex: 1 1 100%')
    /*
     * #984 U011再: 「項目・比較方法・値」の縦3段化はダイアログ自身が持つ。
     * 画面側の scoped style では `div:has(> input[list=...])` を書いていたが、
     * 入力は label の子なので実DOMに当たらず、狭い幅でも潰れたままだった。
     * パネルを @container にして、パネル幅 @3xl(768px) 未満で縦に積む。
     */
    expect(DIALOG).toContain('@container')
    expect(DIALOG).toContain('list="friend-field-names"')
    expect(DIALOG).toContain('flex flex-col items-stretch gap-2 @3xl:flex-row @3xl:items-end')
    expect(DIALOG).toContain('min-w-0 @3xl:flex-1')
    expect(DIALOG).toContain('w-full border px-3 py-2 text-sm @3xl:w-auto')
  })

  it('U012: タグ選択を全幅にし、選択済みタグは折り返して全文読める', () => {
    expect(PAGE).toContain('select[aria-label="タグ名を選ぶ"] { flex: 1 1 100%; }')
    expect(PAGE).toContain('span.rounded-pill:has(> button)')
    expect(PAGE).toContain('overflow-wrap: anywhere')
  })

  it('U013: フッターを補助操作の行と確定操作（キャンセル＋適用）の行に分ける', () => {
    expect(PAGE).toContain('> div:last-child::before')
    expect(PAGE).toContain('flex-basis: 100%')
    expect(PAGE).toContain('> button.ml-auto { order: 2; }')
    expect(PAGE).toContain('> :last-child { order: 3; }')
    // 確定操作そのものは残す。
    expect(PAGE).toContain('AdvancedSearchDialog')
  })
})

/*
 * U028/U033: 390pxではタブの並びが右端の「CSVで書き出す」「UID移行」に
 * 重なってラベルを隠していた（友だち一覧・重複検出・統合ユーザーの全タブ）。
 * 共通タブ（components/shared/tabs・layout/merged-tabs）は所有外なので、
 * 画面側の印＋scoped styleで「収まらない幅だけ折り返す」にする。
 */
describe('U028/U033 タブと右側操作の重なり', () => {
  it('タブ行に折り返しの印と上書きがある', () => {
    expect(PAGE).toContain('data-design="V6Tabs" data-design-node="JB0Ki" data-tabs-row')
    expect(PAGE).toContain('[data-tabs-row] nav:has(> span) { height: auto; flex-wrap: wrap;')
    expect(PAGE).toContain('[data-tabs-row] nav:has(> span) > span + span { margin-left: auto; }')
  })

  it('タブと右側操作そのものは残す', () => {
    expect(PAGE).toContain("{ key: 'duplicates', label: '重複検出' }")
    expect(PAGE).toContain("{ key: 'merged', label: '統合ユーザー' }")
    expect(PAGE).toContain('表示中をCSVで書き出す')
    expect(PAGE).toContain('UID移行')
  })
})
