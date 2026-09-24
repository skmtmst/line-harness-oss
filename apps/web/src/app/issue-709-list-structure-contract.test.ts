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
 * 6. 残件: 28の並び替えは操作列の↑↓で行い、注意書きに導線を書く。
 *    専用APIが無いため既存updateMenu（版つきPUT）でsort_orderを交換する。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('Issue #709: フォルダ帯の見出し件数は行が表す項目の総件数', () => {
  it('テンプレートはテンプレート総件数（フォルダ数ではない）', () => {
    const src = read('templates/page.tsx')
    expect(src).toContain('total={`${templates.length} 件`}')
    expect(src).not.toContain('total={`${folders.length} 件`}')
  })

  it('リッチメニューはグループ総件数（フォルダ数+1ではない）', () => {
    const src = read('rich-menus/page.tsx')
    expect(src).toContain('total={`${groupFacets?.total ?? groupTotal} 件`}')
    expect(src).not.toContain('total={`${folders.length + 1}`}')
  })

  it('メディアはメディア総件数（フォルダ数+1ではない）', () => {
    const src = read('contents/page.tsx')
    expect(src).toContain('total={`${total} 件`}')
    expect(src).not.toContain('total={`${folders.length + 1}`}')
  })

  it('フォームはフォーム総件数を出す', () => {
    const src = read('form-submissions/page.tsx')
    expect(src).toContain('`${folderTotal} 件`')
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
    const src = read('form-submissions/page.tsx')
    const minWidth = src.match(/min-w-\[(\d+)px\]/)
    expect(minWidth, 'min-w が付いている').toBeTruthy()
    expect(Number(minWidth![1])).toBeLessThanOrEqual(800)
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

describe('Issue #709: フォームのフォルダ追加は止まっている理由を常時表示する', () => {
  it('hover限定のtitleだけでなくaddFolderNoteで説明する', () => {
    const src = read('form-submissions/page.tsx')
    expect(src).toContain('addFolderNote={')
    expect(src).toContain('フォルダ保存先はまだ接続されていません')
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
    expect(src).toContain('を上へ')
    expect(src).toContain('を下へ')
    expect(src).toContain('moveMenu')
  })

  it('注意書きに↑↓の導線を書く', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).toContain('操作列の↑↓で変えられます')
  })

  it('並び替えは既存updateMenu（版つきPUT）でsort_orderを交換し、新規APIを作らない', () => {
    const src = read('booking/menus/page.tsx')
    expect(src).toContain('bookingApi.updateMenu')
    expect(src).toContain('sort_order: other.sort_order')
    expect(src).not.toContain('menus/order')
  })
})
