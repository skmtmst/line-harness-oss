import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Dialog from './dialog'

/*
 * UI-25: ポップアップの「閉じる」は右上の×ボタンに統一する。
 * - すべてのDialogに aria-label="閉じる" の×ボタンが出る
 * - 実行ボタンが無い参照窓にはフッターの「キャンセル」を出さない
 * - 実行・取消のある確認窓では「キャンセル」は残る（取り消しの意味を持つため）
 */
describe('UI-25 ダイアログの閉じ方は右上の×に統一', () => {
  it('標準・確認・危険操作のどれにも右上の×ボタンが出る', () => {
    const html = renderToStaticMarkup(<div>
      <Dialog open modal={false} title="お知らせ" onCancel={vi.fn()} />
      <Dialog open modal={false} title="保存しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />
      <Dialog open modal={false} tone="destructive" title="削除しますか？" onCancel={vi.fn()} onConfirm={vi.fn()} />
    </div>)
    expect(html.match(/aria-label="閉じる"/g)).toHaveLength(3)
  })

  it('実行ボタンの無い参照窓はフッターの「キャンセル」を出さない', () => {
    const html = renderToStaticMarkup(
      <Dialog open modal={false} title="お知らせ" onCancel={vi.fn()}><p>本文</p></Dialog>,
    )
    expect(html).toContain('aria-label="閉じる"')
    expect(html).not.toContain('>キャンセル<')
  })

  it('確認窓では「キャンセル」と実行ボタンを残し、×も出る', () => {
    const html = renderToStaticMarkup(
      <Dialog open modal={false} title="保存しますか？" confirmLabel="保存する" onCancel={vi.fn()} onConfirm={vi.fn()} />,
    )
    expect(html).toContain('aria-label="閉じる"')
    expect(html).toContain('>キャンセル<')
    expect(html).toContain('保存する')
  })

  it('×ボタンはbusy中は押せない', () => {
    const html = renderToStaticMarkup(
      <Dialog open modal={false} title="保存しますか？" busy onCancel={vi.fn()} onConfirm={vi.fn()} />,
    )
    expect(html).toMatch(/aria-label="閉じる"[^>]*disabled/)
  })
})
