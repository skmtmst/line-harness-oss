/*
 * Issue #709（監査6: 一覧構造の矛盾）の契約テスト。
 * 1. フォルダ帯の見出し件数は「フォルダの数」ではなく、その帯の行が表す
 *    項目（テンプレート・リッチメニュー・フォーム・メディア）の総件数と
 *    同じ母集団にする（行の合計と見出しが食い違わない）。
 * 2. 各一覧の表は 1440px の初期表示で操作列まで収まる幅にする
 *    （ページ側のフォルダ帯を引いた実効幅 ≈780〜820px に収める）。
 * 3. リッチメニューの状態表示は共有 StatusBadge に一本化し、
 *    「公開予定」も札として出す（平文との混在をやめる）。
 * 4. フォームの「フォルダを追加」は押せない理由を hover 限定の title
 *    ではなく常時表示の注記で伝える。
 * 5. 予約メニューにドラッグできない「⠿」の飾りを戻さない。
 * 6. 残件: 28の並び替えは操作列の「…」の中の上へ・下へで行い、注意書きに導線を書く。
 *    専用APIが無いため既存updateMenu（版つきPUT）でsort_orderを交換する。
 */
import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('Issue #709: フォルダ帯の見出し件数は行が表す項目の総件数', () => {
  /*
   * m13f：見出しの総数は「すべて」の行と重ねて出さない。総件数の置き場所は
   * 「すべて」の行へ移し、母集団の正しさ（フォルダ数ではない）はそちらで守る。
   */
  it('テンプレートはテンプレート総件数（フォルダ数ではない）', () => {
    const src = read('templates/page.tsx')
    // ★V7 `x63W5x`：取れていない間は「—」。読めたときはテンプレート総件数。
    expect(src).toContain("{ id: 'all', label: 'すべて'")
    expect(src).toContain('? templates.length : null')
    expect(src).not.toContain('`${templates.length} 件`')
    expect(src).not.toContain('total={`${folders.length} 件`}')
  })

  it('リッチメニューはグループ総件数（フォルダ数+1ではない）', () => {
    const src = read('rich-menus/page.tsx')
    expect(src).toContain("{ id: '', label: 'すべて', count: groupFacets?.total ?? groupTotal }")
    expect(src).not.toContain('total={`${groupFacets?.total ?? groupTotal} 件`}')
    expect(src).not.toContain('total={`${folders.length + 1}`}')
  })

  it('メディアはメディア総件数（フォルダ数+1ではない）', () => {
    const src = read('contents/page.tsx')
    /*
     * m18s: 見出しの総数は「すべて」の行と同じ数なので出さない（回答フォーム
     * #m18k と同じ形）。総件数の置き場所は「すべて」の行。絞り込み後の件数は
     * 一覧側の ListRange。旧 assertion（見出しに total）は ★V7 に書き換えた。
     * m26m/R587: 一覧が読めていない間（初回・失敗・別アカウント切替直後）は
     * 総数が不明なので出さない（null は数を出さない約束。偽ゼロにしない）。
     * 出どころは絞り込み前の総数（overallTotal ?? total）のまま変えない。
     */
    expect(src).not.toContain('total={`${total} 件`}')
    expect(src).toContain("{ id: '', label: 'すべて', count: listKnown && !loadFailed ? (overallTotal ?? total) : null }")
    expect(src).not.toContain('total={`${folders.length + 1}`}')
  })

  it('フォームはフォーム総件数を出す', () => {
    // 2026-10-06：入口（page.tsx）は新しい一覧（src/v8/forms/list）を読む。相対 import ではないので直に読む。
    const src = read('../v8/forms/list.tsx')
    // R12: 総数は「すべて」の行に出し、見出しには重ねて出さない。
    // R602補足: 未取得・読込中・取得失敗の総数は不明なので出さない
    // （null は数を出さない約束。偽ゼロにしない）。
    // 出どころは絞り込み前の総数（folderTotal）のまま変えない。
    expect(src).toContain("kind: 'all'")
    expect(src).toContain("id: 'all', label: 'すべて', count: loading || loadError ? null : folderTotal }")
    expect(src).not.toContain('`${folderTotal} 件`')
  })

  it('R12: リマインダは見出しの総数を「すべて」の行と重ねて出さない', () => {
    const src = read('reminders/list-v8.tsx')
    expect(src).toContain("kind: 'all'")
    expect(src).toContain("id: '', label: 'すべて', count: reminderList.total ?? null, color: 'var(--color-accent)' }")
    expect(src).not.toContain('`${listTotal}件`')
  })
})

describe('Issue #709: 一覧表は1440pxの初期表示に操作列まで収める', () => {
  it('リッチメニュー一覧は最小幅を実効幅内に収める', () => {
    const src = read('rich-menus/page.tsx')
    const minWidth = src.match(/min-w-\[(\d+)px\]/)
    expect(minWidth, 'min-w が付いている').toBeTruthy()
    expect(Number(minWidth![1])).toBeLessThanOrEqual(780)
  })

  it('フォーム一覧は最小幅を実効幅内に収める', () => {
    // 2026-10-06：新しい一覧（src/v8/forms/list）は共通の表（DataTable）に列の幅を渡す。
    // 表に最小幅を付けないので、1440 で操作列（「…」）まで横にはみ出さない。列の幅の合計で見張る。
    const src = read('../v8/forms/list.tsx')
    const css = read('../v8/forms/list.module.css')
    const globals = read('globals.css')
    expect(src).toContain('<DataTable>')
    expect(css).not.toMatch(/min-width:\s*\d+px/)
    const cols = ['dest', 'status', 'answers', 'url', 'menu'].map((name) => {
      const value = globals.match(new RegExp(`--tpl-fm-col-${name}:\\s*(\\d+)px`))
      expect(value, `--tpl-fm-col-${name}`).toBeTruthy()
      return Number(value![1])
    })
    // 1440 の表の幅は 988（板 1188 − フォルダの列 200）。名前の列に半分は残す。
    expect(cols.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(988 / 2 + 100)
  })
})

describe('Issue #709: リッチメニューの状態表示は共有StatusBadgeに一本化', () => {
  it('共有StatusBadgeをimportし、ローカル札実装を持たない', () => {
    const src = read('rich-menus/page.tsx')
    expect(src).toContain("import StatusBadge from '@/components/shared/status-badge'")
    // 平文の公開予定表示は札へ集約したので、行内の直接表示は残さない。
    expect(src).toContain('MenuStatusBadge group={g}')
    expect(src).not.toMatch(/function StatusBadge\(/)
  })
})

/*
 * R25 で箱を接続したため、「止まっている理由」の表明は外す。
 * 止めていないので理由も要らない。残すのは意図：押せない飾りの口を
 * 置かず（addFolderDisabled を戻さない）、消す前の注意は常時表示にする。
 */
describe('Issue #709: フォームのフォルダ追加は止まっている理由を常時表示する', () => {
  it('止めずにつなぐ。押せない飾りの口は置かない', () => {
    // 2026-10-06：入口（page.tsx）は新しい一覧（src/v8/forms/list）を読む。
    const src = read('../v8/forms/list.tsx')
    expect(src).toContain('onAddFolder=')
    expect(src).not.toContain('addFolderDisabled')
    expect(src).not.toContain('フォルダ保存先はまだ接続されていません')
    // 消す前の注意（中身は未分類に残る）は常時表示の文で伝える。
    expect(src).toContain('フォルダを消しても、中のフォームは未分類に残ります。')
  })
})

describe('Issue #709: 予約メニューに押せないドラッグ飾りを戻さない', () => {
  it('⠿ハンドルがない', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).not.toContain('⠿')
  })
})

describe('Issue #709残件: 28予約メニューは操作列の↑↓で並び替えできる', () => {
  it('行操作に上へ/下へボタンがある（掴めない飾りの代わり）', () => {
    const src = read('booking/menus/page.tsx')
    // ★V7 行の操作の決まり：4つ並べると1440pxで器からはみ出すため、
    // 上へ・下へは操作列の「…」の中へ集める。並び替え自体は残す。
    expect(src).toContain("id: 'move-up'")
    expect(src).toContain("label: '上へ'")
    expect(src).toContain("id: 'move-down'")
    expect(src).toContain("label: '下へ'")
    expect(src).toContain('moveMenu')
  })

  it('注意書きに↑↓の導線を書く', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).toContain('操作列の「…」から変えられます')
  })

  it('並び替えは既存updateMenu（版つきPUT）でsort_orderを交換し、新規APIを作らない', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).toContain('bookingApi.updateMenu')
    expect(src).toContain('sort_order: other.sort_order')
    expect(src).not.toContain('menus/order')
  })
})
