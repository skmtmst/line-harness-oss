import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/*
 * #972 U039: 390pxでは対象の切替タブが右へはみ出し、一覧の表見出しが
 * 重なって読めなかった。タブは折り返し、表は枠の内側で横へ動かす。
 */
describe('U039 友だち追加時の配信の表見出し', () => {
  it('対象の切替タブは収まらないとき折り返す', () => {
    expect(PAGE).toContain('data-design="FirstTime" data-tabs-row')
    expect(PAGE).toContain('[data-tabs-row] nav:has(> span)')
  })

  it('一覧の表は枠の内側で横へ動かせる', () => {
    expect(PAGE).toContain('data-scroll-table')
    expect(PAGE).toContain('[data-scroll-table] > div { overflow-x: auto; }')
    /*
     * #636: 最小幅は 720px。860px だと1440px時点の枠の実幅834pxを
     * 超え、常時26pxの横スクロールが出ていた。720pxなら1440pxに
     * 収まり、狭い幅では従来どおり枠の内側だけが横へ動く。
     */
    expect(PAGE).toContain('[data-scroll-table] table { min-width: 720px; }')
    expect(PAGE).not.toContain('min-width: 860px')
  })

  it('lg未満でもページ全体が横にはみ出さない（#636）', () => {
    // 暗黙の単列トラックは表のmax-contentへ広がるため、明示的に枠幅へ留める。
    expect(PAGE).toContain('grid grid-cols-[minmax(0,1fr)] items-start gap-4')
    // grid の子は min-w-0 で縮め、逃がす先を表の枠内スクロールに閉じる。
    expect(PAGE).toMatch(/<section data-design="Rule"[^>]*className="min-w-0"/)
  })

  it('表の見出しと編集への行き先は変えていない', () => {
    // #640: 見出しには省略時の全文確認用に title が付く。文言と行き先は同じ。
    expect(PAGE).toMatch(/<Th[^>]*>設定名<\/Th>/)
    expect(PAGE).toMatch(/<Th[^>]*>状態<\/Th>/)
    expect(PAGE).toContain('view=edit&id=')
  })
})
