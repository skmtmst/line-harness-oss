import { readUiSource } from '../../../scripts/test-ui-source.mjs'
// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TemplateDeleteDialog from '@/v8/templates/delete-dialog'
import { DELETE_UNUSED_DESCRIPTION } from '@/v8/templates/words'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { templateDeleteDescription } from '@/v8/template-detail/model'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, '../../v8/templates/list.tsx'), 'utf8')

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

afterEach(cleanup)

describe('テンプレート一覧の削除確認', () => {
  it('ブラウザのconfirmを使わず、共通の確認窓へ移す', () => {
    expect(PAGE.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
      .not.toMatch(/[^.\w]confirm\(/)
  })

  // 二度押し・処理中の Esc・処理中の印を戻すことは templates-list-behavior.test.tsx の
  // 「削除の確認」で、削除を待たせて押して確かめる。

  it('削除の失敗を握りつぶさず、窓の中に運用の言葉で出す', () => {
    // 窓を閉じないこと・運用の言葉で出すことは templates-list-behavior.test.tsx で断らせて確かめる。
    const body = fnBody(PAGE, 'const confirmDelete = async ()')
    expect(body, '生のAPIエラーをそのまま出している').not.toMatch(/setDeleteError\(\s*(res\.error|String\(|e\b)/)
  })

  it('確認窓が取り消せない操作として出て、処理中は閉じられない', () => {
    const remove = vi.fn(), cancel = vi.fn()
    const { rerender } = render(React.createElement(TemplateDeleteDialog, {
      open: true, title: '「秋のご案内」を削除しますか？', description: DELETE_UNUSED_DESCRIPTION,
      busy: true, onConfirm: remove, onCancel: cancel,
    }))
    // 一覧の側の対象・実行中・失敗・取消の接続は templates-list-behavior.test.tsx で一覧から開いて確かめる。
    expect(screen.getByRole('alertdialog').textContent).toContain('秋のご案内')
    expect(screen.getByRole('alertdialog').textContent).toContain('すでに送ったメッセージは残ります')
    expect(screen.getByRole('alert').textContent).toContain('削除は元に戻せません')
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancel).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    rerender(React.createElement(TemplateDeleteDialog, {
      open: true, title: '「秋のご案内」を削除しますか？', description: DELETE_UNUSED_DESCRIPTION,
      error: '削除できませんでした', onConfirm: remove, onCancel: cancel,
    }))
    expect(screen.getAllByRole('alert').some(el => el.textContent?.includes('削除できませんでした'))).toBe(true)
    expect((screen.getByRole('button', { name: '削除する' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('button', { name: '削除する' }).getAttribute('data-dialog-action')).toBe('danger')
  })

  it('削除を押しただけでは消えず、窓を開くだけにする', () => {
    // 窓を開くだけで消さないことは v8/templates/list.test.tsx の「決まり2」で押して確かめる。
    const body = fnBody(PAGE, 'const handleDelete = (t:')
    expect(body, '押した時点で消しにいっている').not.toContain('api.templates.delete')
  })

  it('使用中は消さず、使用先と差し替え導線を確認窓に出す', () => {
    // 使用中の窓・使用先の行・説明は v8/templates/list.test.tsx・usage-destinations.test.tsx・
    // templates-list-behavior.test.tsx で一覧から開いて確かめる。
    // N-135: 「差し替える画面へ」ボタンが replacementDestinations[0] だけを
    // 開いていた退行を固定する。
    expect(PAGE, '1件目だけを開く導線に戻ってはいけない').not.toContain('replacementDestinations[0]')
  })
})

describe('テンプレート削除の本文', () => {
  it('使われているときは削除せず差し替えることを言う', () => {
    const text = templateDeleteDescription(3)
    expect(text).toContain('3箇所で使われています')
    expect(text).toContain('使用中は削除できません')
    expect(text).toContain('差し替えてください')
    expect(text).not.toContain('参照が外れ')
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
