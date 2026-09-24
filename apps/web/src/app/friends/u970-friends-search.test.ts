import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
const DIALOG = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'components', 'friends', 'advanced-search-dialog.tsx'),
  'utf8',
)
/* #984 LAY-14: 主タブの定義は friends-tabs.ts が正本（UID移行側も同じ一覧を使う）。 */
const TABS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'friends-tabs.ts'), 'utf8')

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
    // タグ名の選択は候補つき入力（Combobox）へ移した。読み上げ名は同じで、欄は全幅のまま。
    expect(DIALOG).toContain('aria-label="タグ名を選ぶ"')
    expect(PAGE).toContain('input[aria-label="タグ名を選ぶ"] { flex: 1 1 100%; }')
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
 * U028/U033 後日談: かつて画面側の scoped style でタブ行を折り返していたが、
 * 共通タブは MergedTabs → ScrollableTabs（横スクロール）＋≤767px の
 * 共通狭幅対応（tabs.module.css）へ育った。画面側の折り返し上書きは
 * スクロールと衝突し、タブラベルが語の途中で割れて右側操作と重なる
 * 実害になったため撤去した。狭い幅では共通部品の横スクロールに任せる。
 */
describe('タブと右側操作の重なり（共通の横スクロールへ寄せる）', () => {
  it('画面側でタブ行を折り返す上書きを残さない', () => {
    expect(PAGE).toContain('data-design="V6Tabs" data-design-node="JB0Ki"')
    expect(PAGE).not.toContain('data-tabs-row')
    expect(PAGE).not.toContain('nav:has(> span)')
    expect(PAGE).toContain('<MergedTabs')
  })

  it('タブと右側操作そのものは残す', () => {
    expect(TABS).toContain("{ key: 'duplicates', label: '重複検出'")
    expect(TABS).toContain("{ key: 'merged', label: '統合ユーザー'")
    expect(PAGE).toContain('表示中をCSVで書き出す')
  })

  it('UID移行は主タブの1項目だけで、アクションへ重複して置かない', () => {
    expect(TABS).toContain("{ key: 'uid-migration', label: 'UID移行', href: '/accounts?tab=migration' }")
    // タブ化前の名残のリンクを右端へ置くと、タブと2重に見えて狭い幅で
    // さらに重なりやすくなる。行き先はタブの1本に絞る。
    // （ページ内のコメントには経緯の説明として文字列が残るため、
    //  JSX要素としてのリンクだけを対象にする）
    expect(PAGE).not.toContain('href="/accounts?tab=migration"')
    expect(PAGE).not.toContain('>UID移行<')
  })
})
