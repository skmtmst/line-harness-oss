import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { templateDeleteDescription } from './template-delete-message'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * 名前で見つけた関数の本体だけを切り出す。
 *
 * ファイル全体を `toContain` で見ると、**別の処理に同じ字が有るだけ**で
 * 通ってしまう。実際、二度押しの止めを消しても「他の関数に `deleting` が
 * 有る」だけで緑になった。見張りたい処理の中だけを見る。
 */
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

/** `<ConfirmDialog` から閉じまでを切り出す。 */
function dialog(src: string, end: string): string {
  const from = src.indexOf('<ConfirmDialog')
  if (from < 0) throw new Error('<ConfirmDialog が見つかりません')
  const to = src.indexOf(end, from)
  if (to < 0) throw new Error(`${end} が見つかりません`)
  return src.slice(from, to + end.length)
}

describe('テンプレート一覧の削除確認', () => {
  it('ブラウザのconfirmを使わず、共通の確認窓へ移す', () => {
    expect(PAGE).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(PAGE.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
      .not.toMatch(/[^.\w]confirm\(/)
  })

  // 2026-09-02: development (#433) が「使用中は消さず使用先へ送る」を足し、
  // 覚えの名前が deleteTarget → pendingDelete、押した先が
  // handleDelete → confirmDelete になった。**見張る中身は変えていない。**
  it('削除の処理が二度押しを受け付けない', () => {
    const body = fnBody(PAGE, 'const confirmDelete = async ()')
    expect(body, '押している間の二度押しを止めていない').toContain('if (!pendingDelete || deleting) return')
    expect(body, '処理中の印を立てていない').toContain('setDeleting(true)')
    expect(body, '処理中の印を必ず戻していない').toMatch(/finally\s*\{[\s\S]*setDeleting\(false\)/)
  })

  it('削除の失敗を握りつぶさず、窓の中に運用の言葉で出す', () => {
    const body = fnBody(PAGE, 'const confirmDelete = async ()')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '失敗を窓に出していない').toContain(
      "setDeleteError('このテンプレートを削除できませんでした。状態を読み直してから、もう一度お試しください。')",
    )
    expect(body, '生のAPIエラーをそのまま出している').not.toMatch(/setDeleteError\(\s*(res\.error|String\(|e\b)/)
    expect(body, '成功していないのに閉じている').toMatch(
      /throw new Error\(res\.error\)[\s\S]*setPendingDelete\(null\)/,
    )
  })

  it('確認窓が取り消せない操作として出て、処理中は閉じられない', () => {
    const jsx = dialog(PAGE, '/>')
    expect(jsx, '対象の名前を読ませていない').toContain('pendingDelete?.name')
    expect(jsx, '何が起きるかを本文で読ませていない').toContain('templateDeleteDescription(pendingDelete?.usageCount ?? 0)')
    expect(jsx, '取り消せない操作の色になっていない').toContain('destructive')
    expect(jsx).toContain('confirmLabel="削除する"')
    expect(jsx, '処理中でも押せてしまう').toContain('busy={deleting}')
    expect(jsx, '失敗が窓の中に出ない').toContain('error={deleteError}')
    expect(jsx, '処理中に閉じられてしまう').toContain('if (deleting) return')
  })

  it('削除を押しただけでは消えず、窓を開くだけにする', () => {
    const body = fnBody(PAGE, 'const handleDelete = (template:')
    expect(body, '押した時点で消しにいっている').not.toContain('api.templates.delete')
    expect(body, '窓を開いていない').toContain('setPendingDelete({ id, name, usageCount })')
  })

  // development (#433) が足した「使用中は消さない」も一緒に見張る。
  it('使用中は消さず、使用先へ送る', () => {
    const body = fnBody(PAGE, 'const handleDelete = (template:')
    expect(body, '使用中でも窓を開いてしまう').toMatch(
      /if \(usageCount > 0\)[\s\S]*setDrawerId\(id\)[\s\S]*return/,
    )
    expect(PAGE, '使用中の行から使用先へ行けない').toContain('使用先を見る')
  })
})

describe('テンプレート削除の本文', () => {
  it('使われている数と、参照が外れることを言う', () => {
    const text = templateDeleteDescription(3)
    expect(text).toContain('3箇所で使われています')
    expect(text).toContain('参照が外れ')
    expect(text).toContain('この操作は取り消せません')
  })

  it('0箇所のときは「N箇所で使われています」と言わない', () => {
    const text = templateDeleteDescription(0)
    expect(text).not.toContain('箇所で使われています')
    expect(text).toContain('どこからも使われていない')
    expect(text).toContain('この操作は取り消せません')
  })

  it('どちらの場合も、送った分が残ることを言う', () => {
    for (const count of [0, 1, 12]) {
      expect(templateDeleteDescription(count)).toContain('すでに送ったメッセージは残ります')
    }
  })
})
