import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/** 注意書きの中の `confirm(` に当てないため、コメントを外す。 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * **ファイル全体を `toContain` で見ない。**
 * 別の処理に同じ字があるだけで通ってしまう。本体とJSXだけを切り出す。
 */
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from)
  expect(a, `${from} が見つからない`).toBeGreaterThanOrEqual(0)
  const b = src.indexOf(to, a + from.length)
  expect(b, `${to} が見つからない`).toBeGreaterThan(a)
  return src.slice(a, b)
}

function dialogWith(src: string, marker: string): string {
  const blocks = src
    .split('<ConfirmDialog')
    .slice(1)
    .map((block) => `<ConfirmDialog${block.slice(0, block.indexOf('</ConfirmDialog>'))}`)
  const found = blocks.filter((block) => block.includes(marker))
  expect(found.length, `${marker} を持つ確認窓がちょうど1つではない`).toBe(1)
  return found[0]
}

describe('成果地点の削除確認', () => {
  it('ブラウザの confirm を使わない', () => {
    expect(code(PAGE), 'ブラウザのconfirmへ戻っている').not.toMatch(/[^.\w]confirm\(/)
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
  })

  it('削除の本体が二度押しを止め、返事を確かめ、finally で戻す', () => {
    const body = slice(PAGE, 'const runDelete = async', '\n  const countByPoint')
    expect(body, '処理中でも受け付けてしまう').toContain('if (!deleteTarget || deleting) return')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '失敗を握りつぶしている').toContain(
      "setDeleteError('この成果地点を削除できませんでした。状態を読み直してから、もう一度お試しください。')",
    )
    expect(body, '生のAPIエラーをそのまま出している').not.toContain('setDeleteError(res.error)')
    expect(body, 'finally で処理中を戻していない').toMatch(/finally \{\s*setDeleting\(false\)/)
  })

  it('取り消せない削除なので赤にし、設計の重ね画面を名乗る', () => {
    const dialog = dialogWith(PAGE, 'open={deleteTarget !== null}')
    expect(dialog, '赤にしていない').toContain('destructive')
    expect(dialog, '設計の重ね画面のNodeが無い').toContain('designNode="d8d3Mz"')
    expect(dialog, '処理中を窓へ渡していない').toContain('busy={deleting}')
    expect(dialog, '失敗を窓の中に出していない').toContain('error={deleteError}')
  })

  it('記録した成果も消えることと、数えられない参照を本文で断る', () => {
    const dialog = dialogWith(PAGE, 'open={deleteTarget !== null}')
    expect(dialog).toContain('この成果地点で記録した成果も一緒に消えます。')
    // 使用先を数える口が無い。0件と書かず、数えていないことを断る。
    expect(dialog).toContain(
      'オートメーション・アフィリエイト案件からの参照は数えられていません。',
    )
    expect(dialog, '取れない数を0件として作っている').not.toContain('参照 0件')
    // レポートが落ちているときは件数を作らず「読み込めませんでした」と出す。
    expect(dialog).toContain('読み込めませんでした')
  })
})
