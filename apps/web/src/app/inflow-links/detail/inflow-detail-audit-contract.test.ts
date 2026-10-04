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
  it('R272: つながる先は実データの件数と設定を出す', () => {
    const box = relatedBox()
    expect(box, 'つながる先の箱が見つからない').not.toBe('')
    expect(box).toContain('コンバージョン')
    expect(box).toContain('formatNumber(funnel.cv_count)')
    expect(box).toContain('シナリオ配信')
    expect(box).toContain('マイル')
  })

  it('R273: 止まっている経路は受付の再開と分かる', () => {
    expect(PAGE).toContain('受付を再開する')
    expect(PAGE).toContain("openDelete('stop')")
    expect(PAGE).toContain('止める')
  })

  it('R274: 削除の操作を変えたら前の操作のエラーを消す', () => {
    const at = DIALOG.indexOf('どうしますか？')
    expect(at, '削除の操作選択が見つからない').not.toBe(-1)
    const block = DIALOG.slice(at, at + 2000)
    expect(block, '操作切替でエラーを消していない').toContain("setDeleteError('')")
  })
})
