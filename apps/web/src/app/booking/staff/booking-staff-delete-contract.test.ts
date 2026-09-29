import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/** 名前で見つけた関数の本体だけを切り出す。ファイル全体を見ると素通しになる。 */
function fnBody(src: string, decl: string): string {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error(`${decl} が見つかりません`)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`${decl} の本体が閉じていません`)
}

/** n番目（0始まり）の `<ConfirmDialog ... />` を切り出す。 */
function dialog(src: string, index: number): string {
  let from = -1
  for (let i = 0; i <= index; i++) from = src.indexOf('<ConfirmDialog', from + 1)
  if (from < 0) throw new Error(`${index + 1}つ目の <ConfirmDialog が見つかりません`)
  const to = src.indexOf('/>', from)
  if (to < 0) throw new Error('確認窓が閉じていません')
  return src.slice(from, to + 2)
}

describe('予約スタッフの削除 (#1058)', () => {
  it('削除に失敗したら未処理拒否にせず、窓の中に理由を出す', () => {
    const body = fnBody(PAGE, 'async function remove(id: string)')
    expect(body, '失敗を受けていない').toContain('} catch {')
    expect(body, '失敗を窓に出していない').toContain(
      "setRemoveError('このスタッフを削除できませんでした。状態を読み直してから、もう一度お試しください。')",
    )
    expect(body, '生のAPIエラーをそのまま出している')
      .not.toMatch(/setRemoveError\(\s*(e\.|err\.|String\(|res\.error)/)
    expect(body, '処理中の印を必ず戻していない').toMatch(/finally\s*\{[\s\S]*setDeleting\(false\)/)
  })

  it('失敗のあとに確認窓が消えない（成功したときだけ閉じる）', () => {
    const body = fnBody(PAGE, 'async function remove(id: string)')
    // setRemoveTarget(null) は削除成功の通路上にだけあること
    expect(body.indexOf('setRemoveTarget(null)')).toBeLessThan(body.indexOf('catch'))
    expect(body).toContain('await bookingApi.deleteStaff(selectedAccountId, id)')
  })

  it('確認窓は失敗文を受け取り、処理中は閉じられない', () => {
    const jsx = dialog(PAGE, 0)
    expect(jsx, '失敗が窓の中に出ない').toContain('error={removeError}')
    expect(jsx).toContain('busy={deleting}')
    expect(jsx, '処理中に閉じられてしまう').toContain('if (deleting) return')
    expect(jsx).toContain('destructive')
  })

  it('窓を開き直したとき前の失敗文が残らない', () => {
    expect(PAGE).toContain("setRemoveError(''); setRemoveTarget(s)")
  })
})
