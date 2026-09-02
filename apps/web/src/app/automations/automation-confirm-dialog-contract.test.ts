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
 *
 * 別の処理に同じ字があるだけで通ってしまう（実際に一度素通りした）。
 * 見たい関数の本体と確認窓のJSXだけを切り出してから確かめる。
 */
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from)
  expect(a, `${from} が見つからない`).toBeGreaterThanOrEqual(0)
  const b = src.indexOf(to, a + from.length)
  expect(b, `${to} が見つからない`).toBeGreaterThan(a)
  return src.slice(a, b)
}

/** `<ConfirmDialog …>…</ConfirmDialog>` を1つずつに切り分け、目印で選ぶ。 */
function dialogWith(src: string, marker: string): string {
  const blocks = src
    .split('<ConfirmDialog')
    .slice(1)
    .map((block) => `<ConfirmDialog${block.slice(0, block.indexOf('</ConfirmDialog>'))}`)
  const found = blocks.filter((block) => block.includes(marker))
  expect(found.length, `${marker} を持つ確認窓がちょうど1つではない`).toBe(1)
  return found[0]
}

describe('オートメーションの確認窓', () => {
  it('ブラウザの confirm を使わない', () => {
    expect(code(PAGE), 'ブラウザのconfirmへ戻っている').not.toMatch(/[^.\w]confirm\(/)
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
  })

  it('実行の本体が二度押しを止め、返事を確かめ、finally で戻す', () => {
    const body = slice(PAGE, 'const runPending = async', '\n  return (')
    expect(body, '処理中でも受け付けてしまう').toContain('if (!pending || working || accountChanged) return')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '失敗を握りつぶしている').toContain('setActionError(')
    expect(body, '生のAPIエラーをそのまま出している').not.toContain('setActionError(res.error)')
    expect(body, 'finally で処理中を戻していない').toMatch(/finally \{\s*setWorking\(false\)/)
  })

  it('押した時点のアカウントを窓に固定する', () => {
    expect(PAGE, 'アカウントを窓に持っていない').toContain(
      "setPending({ kind: 'delete', automation: target, accountId: selectedAccountId })",
    )
    expect(PAGE, '切り替わりを見ていない').toContain(
      'const accountChanged = pending !== null && pending.accountId !== selectedAccountId',
    )
    const dialog = dialogWith(PAGE, 'open={pending !== null}')
    expect(dialog, '切り替わっても実行できてしまう').toContain(
      'onConfirm={accountChanged ? undefined : () => void runPending()}',
    )
    expect(dialog, '切り替わったことを窓の中で伝えていない').toContain(
      '押したあとにLINEアカウントが切り替わりました。',
    )
  })

  it('取り消せない削除だけを赤にする', () => {
    const dialog = dialogWith(PAGE, 'open={pending !== null}')
    expect(dialog, '戻せる稼働の切り替えまで赤になっている').toContain(
      "destructive={pending?.kind === 'delete'}",
    )
    expect(dialog, '処理中を窓へ渡していない').toContain('busy={working}')
    expect(dialog, '失敗を窓の中に出していない').toContain('error={actionError}')
  })

  it('何が消え・何が残るかを本文で読ませる', () => {
    const dialog = dialogWith(PAGE, 'open={pending !== null}')
    expect(dialog).toContain('すでに動いたぶん（付けたタグ・送ったメッセージ）はそのまま残り、取り消せません。')
    expect(dialog).toContain('ルールの設定は残るので、あとから動かし直せます。')
    // 実行の記録を持っていない。0回と書かずに、数えていないことを断る。
    expect(dialog).toContain('このルールが何回動いたかは記録していないため、ここには出せません。')
    // 注意書きの中の「0回」を拾わないよう、コメントを外してから見る。
    expect(code(dialog), '取れない数を0回として作っている').not.toContain('0回')
  })
})
