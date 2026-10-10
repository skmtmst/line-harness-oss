import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
const DIALOG = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'components', 'friends', 'advanced-search-dialog.tsx'),
  'utf8',
)
/* #984 LAY-14: 主タブの定義は friends-tabs.ts が正本（UID移行側も同じ一覧を使う）。 */
const NAV = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'friends-nav-v8.tsx'), 'utf8')
const TABS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'friends-tabs.ts'), 'utf8')

/*
 * U011-U013: 詳細検索（絞り込み条件を設定）が狭い幅で潰れていた。
 * 共通部品・ダイアログ本体の形は変えず、画面側の `data-friends-advanced-search`
 * ラッパーに効く scoped style で、パネルの内幅672px（左右余白込み720px）
 * 未満のときだけ縦に組み直す。
 */


/*
 * U028/U033 後日談: かつて画面側の scoped style でタブ行を折り返していたが、
 * 共通タブは MergedTabs → ScrollableTabs（横スクロール）＋≤767px の
 * 共通狭幅対応（tabs.module.css）へ育った。画面側の折り返し上書きは
 * スクロールと衝突し、タブラベルが語の途中で割れて右側操作と重なる
 * 実害になったため撤去した。狭い幅では共通部品の横スクロールに任せる。
 */
describe('タブと右側操作の重なり（共通の横スクロールへ寄せる）', () => {


  it('タブと右側操作そのものは残す', () => {
    expect(TABS).toContain("{ key: 'duplicates', label: '重複検出'")
    expect(TABS).toContain("{ key: 'merged', label: '統合ユーザー'")
    expect(NAV).toContain('表示中をCSVで書き出す')
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
