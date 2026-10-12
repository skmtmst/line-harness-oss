import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, '../../../v8/events/bookings.tsx'), 'utf8')

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

describe('イベント予約の運営キャンセル確認', () => {
  it('ブラウザの confirm を使わない', () => {
    expect(code(PAGE), 'ブラウザのconfirmへ戻っている').not.toMatch(/[^.\w]confirm\(/)
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
  })

  it('キャンセルの本体が二度押しを止め、返事を確かめ、finally で戻す', () => {
    const body = slice(PAGE, 'async function runAdminCancel', '\n  async function markStatus')
    expect(body, '処理中でも受け付けてしまう').toContain(
      'if (!cancelApplicant || cancelling) return',
    )
    expect(body, '返事を確かめていない').toContain("if (!res?.ok) throw new Error('cancel_not_applied')")
    expect(body, '失敗を握りつぶしている').toContain('setCancelError(')
    expect(body, '生のAPIエラーをそのまま出している').not.toMatch(/setCancelError\(\s*(e|err|caught)\b/)
    expect(body, 'finally で現在の処理中だけを戻していない').toMatch(/finally \{\s*if \(request.isCurrent\(\)\) setCancelling\(false\)/)
  })

  it('押した時点のアカウントを窓に固定する', () => {
    expect(PAGE, 'アカウントを窓に持っていない').toContain(
      'setCancelApplicant({ applicant: row, accountId: selectedAccountId })',
    )
    expect(PAGE, '切り替わりを見ていない').toContain(
      'if (cancelApplicant.accountId !== selectedAccountId) return',
    )
    const body = slice(PAGE, 'async function runAdminCancel', '\n  async function markStatus')
    expect(body, '押した時点のアカウントではなく、いまの選択で投げている').toContain(
      'cancelApplicant.accountId,',
    )
    const dialog = dialogWith(PAGE, 'open={cancelApplicant !== null}')
    expect(dialog, '前の窓の実行ロックを次へ持ち越している').toContain('key={`cancel:${operationScope}`}')
    expect(PAGE, '切り替わった窓が残っている').toContain('setCancelApplicant(null)')
  })

  it('通知が飛んで戻せないので赤にし、何が起きるかを本文で読ませる', () => {
    const dialog = dialogWith(PAGE, 'open={cancelApplicant !== null}')
    expect(dialog, '赤にしていない').toContain('destructive')
    expect(dialog, '処理中を窓へ渡していない').toContain('busy={cancelling}')
    expect(dialog, '失敗を窓の中に出していない').toContain('error={cancelError}')
    expect(dialog).toContain('友だちへLINEでお知らせが届き')
    expect(dialog).toContain('この操作は元に戻せません。')
    expect(dialog).toContain('この予約の通知予定も停止し、送信済みの記録は残ります。')
    expect(dialog, '誰の予約なのかを出していない').toContain('cancelApplicant?.applicant.displayName')
  })
})
