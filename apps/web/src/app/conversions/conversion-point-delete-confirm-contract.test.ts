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

  it('停止の本体が二度押しを止め、返事を確かめ、finally で戻す', () => {
    const body = slice(PAGE, 'const runStop = async', '\n  const countByPoint')
    expect(body, '処理中でも受け付けてしまう').toContain('if (!stopTarget || stopping) return')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '失敗を握りつぶしている').toContain(
      "setStopError('この成果地点の計測を止められませんでした。状態を読み直してから、もう一度お試しください。')",
    )
    expect(body, '生のAPIエラーをそのまま出している').not.toContain('setStopError(res.error)')
    expect(body, 'finally で処理中を戻していない').toMatch(/finally \{\s*setStopping\(false\)/)
  })

  it('安全な計測停止を既定にし、設計の重ね画面を名乗る', () => {
    const dialog = dialogWith(PAGE, 'open={stopTarget !== null}')
    expect(dialog, '物理削除の赤い確認に戻っている').not.toContain('destructive')
    expect(dialog, '設計の重ね画面のNodeが無い').toContain('designNode="d8d3Mz"')
    expect(dialog, '処理中を窓へ渡していない').toContain('busy={stopping}')
    expect(dialog, '失敗を窓の中に出していない').toContain('error={stopError}')
    expect(dialog).toContain('confirmLabel="数えるのをやめる"')
  })

  it('過去記録を残し、数えられない参照と3つの選択肢を本文で断る', () => {
    const dialog = dialogWith(PAGE, 'open={stopTarget !== null}')
    expect(dialog).toContain('の記録と金額は、そのまま残ります。')
    // 使用先を数える口が無い。0件と書かず、数えていないことを断る。
    expect(dialog).toContain('— 利用先の取得は未接続')
    expect(dialog, '取れない数を0件として作っている').not.toContain('利用先 0件')
    for (const choice of ['数えるのをやめる（おすすめ）', '別の成果地点に差し替えてから削除する', 'このまま削除する']) {
      expect(dialog).toContain(choice)
    }
    // レポートが落ちているときは件数を作らず「読み込めませんでした」と出す。
    expect(dialog).toContain('成果件数を読み込めていません。0件とは扱いません。')
  })
})
