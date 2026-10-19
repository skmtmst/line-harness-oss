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
 * 6. 予約メニューは共通のつまみ・行操作で並べ替え、版つきの一括APIで保存する。
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
    const src = read('../v8/templates/list.tsx')
    // ★管理画面 `x63W5x`：取れていない間は「—」。読めたときはテンプレート総件数。
    expect(src).toContain("id: 'all', label: 'すべて'")
    expect(src).toContain('? tabItems.length : null')
    expect(src).not.toContain('`${templates.length} 件`')
    expect(src).not.toContain('total={`${folders.length} 件`}')
  })

  it('リッチメニューはグループ総件数（フォルダ数+1ではない）', () => {
    const src = read('rich-menus/page.tsx')
    expect(src).toContain('allCount={groupFacets?.total ?? groupTotal}')
    expect(src).not.toContain('total={`${groupFacets?.total ?? groupTotal} 件`}')
    expect(src).not.toContain('total={`${folders.length + 1}`}')
  })

  it('メディアはメディア総件数（フォルダ数+1ではない）', () => {
    const src = read('contents/page.tsx')
    /*
     * m18s: 見出しの総数は「すべて」の行と同じ数なので出さない（回答フォーム
     * #m18k と同じ形）。総件数の置き場所は「すべて」の行。絞り込み後の件数は
     * 一覧側の ListRange。旧 assertion（見出しに total）は ★管理画面 に書き換えた。
     * m26m/R587: 一覧が読めていない間（初回・失敗・別アカウント切替直後）は
     * 総数が不明なので出さない（null は数を出さない約束。偽ゼロにしない）。
     * 出どころは絞り込み前の総数（overallTotal ?? total）のまま変えない。
     */
    expect(src).not.toContain('total={`${total} 件`}')
    expect(src).toContain("id: '', label: 'すべて', count: listKnown && !loadFailed ? (overallTotal ?? total) : null }")
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
    const src = read("../v8/reminders/list.tsx")
    // 「すべて」の行は共通のフォルダの列（ManagedFolderPanel）が作る。件数は行が表す総数。
    expect(src).toMatch(/<ManagedFolderPanel[\s\S]*?allId=""[\s\S]*?allCount=\{reminderList\.total \?\? null\}/)
    const panel = src.match(/<ManagedFolderPanel[\s\S]*?>/)?.[0] ?? ''
    expect(panel).not.toMatch(/\stotal=/)
    expect(src).not.toContain('`${listTotal}件`')
  })
})

describe('Issue #709: 一覧表は1440pxの初期表示に操作列まで収める', () => {
  it('リッチメニュー一覧は最小幅を実効幅内に収める', () => {
    const src = read('rich-menus/page.tsx')
    expect(src).toContain('<DataTable')
    const css = read('../v8/rich-menus/list.module.css')
    expect(css).not.toMatch(/min-width:\s*\d+px/)
    expect(css).toContain('.colMenu { width: var(--tpl-rml-col-menu); }')
  })

  // フォームの列を固定pxの合計で判定しない。コピーの完了幅と3幅の実画面で測る。

})

describe('Issue #709: リッチメニューの状態表示は共有StatusBadgeに一本化', () => {
  it('共有StatusBadgeをimportし、ローカル札実装を持たない', () => {
    const src = read('rich-menus/page.tsx')
    expect(src).toContain('styles.pillScheduled')
    // 平文の公開予定表示は札へ集約したので、行内の直接表示は残さない。
    expect(src).toContain("g.status === 'published' ? styles.pillLive : styles.pillDraft")
    expect(src).toContain('`${shortDay(g.publishingAt)} 公開`')
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

describe('Issue #709残件: V8予約メニューの並べ替えを維持する', () => {
  it('共通の行操作から上へ・下へ動かせる', () => {
    const src = read('../v8/booking-menus/tabs/menus-tab.tsx')
    expect(src).toContain('useReorder({')
    expect(src).toContain('reorder.menuItems(menu.id')
    expect(src).toContain('<RowMenu')
    expect(src).toContain('onReorder: ({ id, ids }) => persistOrder(id, ids)')
  })

  it('つまみも実操作へつなぎ、閲覧のみ・検索中・保存中は動かせない', () => {
    const src = read('../v8/booking-menus/tabs/menus-tab.tsx')
    expect(src).toContain('<ReorderHandle')
    expect(src).toContain('reorder.handleProps(menu.id)')
    expect(src).toContain('reorder.rowProps(menu.id)')
    expect(src).toContain('disabledReason: reorderDisabledReason')
    expect(src).toContain('閲覧のみのため並び替えできません')
    expect(src).toContain('検索を外すと動かせます')
    expect(src).toContain('並び替えを保存しています')
  })

  it('既存の一括APIへ版と順位を送り、途中までの順位交換を防ぐ', () => {
    const src = read('../v8/booking-menus/tabs/menus-tab.tsx')
    expect(src).toContain('bookingApi.reorderMenus(accountId')
    expect(src).toContain('expectedVersion: menu.version')
    expect(src).toContain('sortOrder')
    expect(src).toContain('setOrderOverride(null)')
    expect(src).toContain('onReload()')
  })
})
