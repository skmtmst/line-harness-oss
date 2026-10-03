import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
// 削除の窓は v7・V8 の両方で使う共用部品へ移した（中身は同じ）。
const DIALOG = readFileSync(join(import.meta.dirname, '..', '_components', 'inflow-delete-dialog.tsx'), 'utf8')

/** 「つながる先」の箱だけを切り出す。ファイル全体を見ると別の Link に当たって素通りする。 */
function relatedBox(): string {
  const at = PAGE.indexOf('つながる先')
  if (at < 0) return ''
  const end = PAGE.indexOf('</section>', at)
  return PAGE.slice(at, end)
}

describe('流入リンク詳細の監査対応（R272・R273・R274）', () => {
  it('R272: つながる先の5項目は実際のリンクにする', () => {
    const box = relatedBox()
    expect(box, 'つながる先の箱が見つからない').not.toBe('')
    for (const href of ['/scenarios', '/friends', '/conversions?tab=affiliates', '/conversions', '/analytics']) {
      expect(box, `${href} へのリンクが無い`).toContain(`<Link href="${href}">`)
    }
    expect(box, 'リンクになっていない項目がある').not.toMatch(/<li>→ /)
  })

  it('R273: 詳細の頭に受付中・停止中の印を出す', () => {
    expect(PAGE).toContain("{route.isActive ? '受付中' : '停止中'}")
  })

  it('R274: 削除の操作を変えたら前の操作のエラーを消す', () => {
    const at = DIALOG.indexOf('どうしますか？')
    expect(at, '削除の操作選択が見つからない').not.toBe(-1)
    const block = DIALOG.slice(at, at + 2000)
    expect(block, '操作切替でエラーを消していない').toContain("setDeleteError('')")
  })
})
