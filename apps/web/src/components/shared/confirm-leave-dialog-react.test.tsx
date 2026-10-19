// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ConfirmDialog from './confirm-dialog'

afterEach(cleanup)

function primaryClass(button: HTMLElement): string {
  return button.className
}

describe('未保存の離脱確認の向き（★V7）', () => {
  it('主の緑は「編集を続ける」、枠線は「保存せずに移る」、印は付けない', () => {
    render(<ConfirmDialog
      primaryAction="cancel"
      open
      title="保存していない変更があります"
      description="このまま移動すると、入力した内容は消えます。"
      confirmLabel="保存せずに移る"
      cancelLabel="編集を続ける"
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />)
    const stay = screen.getByRole('button', { name: '編集を続ける' })
    const leave = screen.getByRole('button', { name: '保存せずに移る' })
    // 主の緑は残る方。離れる方は枠線（主でも危険色でもない）。
    expect(primaryClass(stay)).toMatch(/primary/)
    expect(primaryClass(leave)).not.toMatch(/primary/)
    expect(primaryClass(leave)).not.toMatch(/danger/)
    // 緑のチェックは「完了・成功」の意味なので、未済の窓には出さない。
    expect(document.querySelector('svg.lucide-circle-check')).toBeNull()
  })

  it('開いた直後の標的は「編集を続ける」で、×は残ると同じ動き', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog
      primaryAction="cancel"
      open
      title="保存していない変更があります"
      description="このまま移動すると、入力した内容は消えます。"
      confirmLabel="保存せずに移る"
      cancelLabel="編集を続ける"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '編集を続ける' })))

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('従来の確認窓（主が実行）は緑の印と実行主のまま変えない', () => {
    render(<ConfirmDialog
      open
      title="テスト送信しますか？"
      description="1通だけ送ります。"
      confirmLabel="テストを送る"
      cancelLabel="キャンセル"
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />)
    const go = screen.getByRole('button', { name: 'テストを送る' })
    expect(primaryClass(go)).toMatch(/primary/)
    expect(document.querySelector('svg.lucide-circle-check')).not.toBeNull()
  })
})
