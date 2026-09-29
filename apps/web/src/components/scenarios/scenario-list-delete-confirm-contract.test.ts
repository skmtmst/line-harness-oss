import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const LIST = fs.readFileSync(path.join(__dirname, 'scenario-list.tsx'), 'utf8')

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

describe('シナリオ一覧の削除確認', () => {
  it('ブラウザの confirm を使わない', () => {
    expect(code(LIST), 'ブラウザのconfirmへ戻っている').not.toMatch(/[^.\w]confirm\(/)
    expect(LIST).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
  })

  it('削除の本体が二度押しを止め、投げた先の失敗を受け、finally で戻す', () => {
    const body = slice(LIST, 'const runDelete = async', '\n  const dropOn =')
    expect(body, '処理中でも受け付けてしまう').toContain(
      'if (!deleteTarget || deleting || !targetStillListed) return',
    )
    // 投げっぱなしにしない。待たないと「処理中…」も失敗も出せない。
    expect(body, '削除の終わりを待っていない').toContain('await onDelete(deleteTarget.id)')
    expect(body, '失敗を握りつぶしている').toContain(
      "'このシナリオを削除できませんでした。状態を読み直してから、もう一度お試しください。',",
    )
    expect(body, 'finally で処理中を戻していない').toMatch(/finally \{\s*setDeleting\(false\)/)
    // 待てる形にするため、呼び出し側の型を広げてある。
    expect(LIST, 'onDelete を待てる型にしていない').toContain(
      'onDelete: (id: string) => void | Promise<void>',
    )
  })

  it('押した時点のシナリオを窓に固定し、一覧から外れたら選び直させる', () => {
    expect(LIST, '一覧に居るかを見ていない').toContain(
      'deleteTarget !== null && scenarios.some((s) => s.id === deleteTarget.id)',
    )
    const dialog = dialogWith(LIST, 'open={deleteTarget !== null}')
    expect(dialog, '一覧から外れても実行できてしまう').toContain(
      'onConfirm={targetStillListed ? () => void runDelete() : undefined}',
    )
    expect(dialog, '外れたことを窓の中で伝えていない').toContain(
      'このシナリオが一覧から外れました（LINEアカウントの切り替えなど）。',
    )
    // 一覧が空になっても窓を消さない。消えると押した確認の行方が分からない。
    expect(LIST, '空の一覧で窓ごと消えている').toContain('{confirmDialog}\n      </>')
  })

  it('取り消せない削除なので赤にし、何が消えるかを本文で読ませる', () => {
    const dialog = dialogWith(LIST, 'open={deleteTarget !== null}')
    expect(dialog, '赤にしていない').toContain('destructive')
    expect(dialog, '処理中を窓へ渡していない').toContain('busy={deleting}')
    expect(dialog, '失敗を窓の中に出していない').toContain('error={deleteError}')
    expect(dialog).toContain('各通の中身と、購読中の人の進み具合が一緒に消えます。')
    expect(dialog).toContain('すでに送ったメッセージは友だちの手元に残り、取り消せません。')
    // 使用先を数える口が無い。0件と書かず、数えていないことを断る。
    expect(dialog).toContain('回答フォーム・流入経路・計測リンクからの参照は数えられていません。')
    expect(dialog, '取れない数を0件として作っている').not.toContain('参照 0件')
  })
})
