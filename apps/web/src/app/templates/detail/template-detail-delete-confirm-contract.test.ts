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

function dialog(src: string): string {
  const from = src.indexOf('<ConfirmDialog')
  if (from < 0) throw new Error('<ConfirmDialog が見つかりません')
  const to = src.indexOf('</ConfirmDialog>', from)
  if (to < 0) throw new Error('</ConfirmDialog> が見つかりません')
  return src.slice(from, to)
}

describe('テンプレート詳細の削除確認', () => {
  it('ブラウザのconfirmを使わず、共通の確認窓へ移す', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
      .not.toMatch(/[^.\w]confirm\(/)
  })

  it('削除の処理が二度押しを受け付けない', () => {
    const body = fnBody(PAGE, 'const remove = async ()')
    expect(body, '押している間の二度押しを止めていない').toContain('if (deleting) return')
    expect(body).toContain('setDeleting(true)')
    expect(body, '処理中の印を必ず戻していない').toMatch(/finally\s*\{[\s\S]*setDeleting\(false\)/)
  })

  it('削除の失敗を握りつぶさず、一覧へ飛ばさない', () => {
    const body = fnBody(PAGE, 'const remove = async ()')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '失敗を窓に出していない').toContain(
      "setDeleteError('このテンプレートを削除できませんでした。状態を読み直してから、もう一度お試しください。')",
    )
    expect(body, '生のAPIエラーをそのまま出している').not.toMatch(/setDeleteError\(\s*(res\.error|String\(|e\b)/)
    expect(body, '失敗しても一覧へ飛んでしまう').toMatch(
      /throw new Error\(res\.error\)[\s\S]*router\.push\('\/templates'\)/,
    )
  })

  it('確認窓が取り消せない操作として出て、処理中は閉じられない', () => {
    const jsx = dialog(PAGE)
    expect(jsx, '対象の名前を読ませていない').toContain('template?.name')
    expect(jsx).toContain('templateDeleteDescription(usageCount)')
    expect(jsx).toContain('destructive')
    expect(jsx).toContain('confirmLabel="削除する"')
    expect(jsx, '処理中でも押せてしまう').toContain('busy={deleting}')
    expect(jsx, '失敗が窓の中に出ない').toContain('error={deleteError}')
    expect(jsx, '処理中に閉じられてしまう').toContain('if (deleting) return')
  })

  it('数えられていない参照があることを窓の中で断る', () => {
    const jsx = dialog(PAGE)
    expect(jsx, '数えきれていないことを言わずに0か所と見せている').toContain(
      '一斉配信・リマインダからの参照は、まだ数えられません。',
    )
  })

  it('削除ボタンは窓を開くだけで、押した時点では消さない', () => {
    expect(PAGE).toContain("onClick={() => { setDeleteError(''); setConfirmOpen(true) }}")
  })
})
