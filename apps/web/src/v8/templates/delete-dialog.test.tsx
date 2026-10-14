// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import TemplateDeleteDialog from './delete-dialog'

afterEach(cleanup)

it('アカウントが変わった削除は理由を読み、選び直すまで送らない', () => {
  const remove = vi.fn(), cancel = vi.fn()
  const { rerender } = render(<TemplateDeleteDialog open title="文を削除しますか？" description="配信には残ります。"
    confirmDisabled onConfirm={remove} onCancel={cancel} />)
  const button = screen.getByRole('button', { name: '削除する' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.title).toContain('アカウントが切り替わりました')
  fireEvent.click(button)
  expect(remove).not.toHaveBeenCalled()
  rerender(<TemplateDeleteDialog open title="文を削除しますか？" description="配信には残ります。"
    onConfirm={remove} onCancel={cancel} />)
  expect(button.disabled).toBe(false)
  expect(button.title).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(cancel).toHaveBeenCalledOnce()
  expect(remove).not.toHaveBeenCalled()
})

it('削除の実行中は連打と終了を止め、失敗後も対象と注意を残す', async () => {
  let fail!: (error: Error) => void
  const remove = vi.fn(() => new Promise<void>((_, reject) => { fail = reject })), cancel = vi.fn()
  render(<TemplateDeleteDialog open title="秋の文を削除しますか？" description="配信には残ります。"
    onConfirm={remove} onCancel={cancel} />)
  expect(screen.getByRole('alert').textContent).toContain('削除は元に戻せません。')
  fireEvent.click(screen.getByRole('button', { name: '削除する' }))
  fireEvent.click(screen.getByRole('button', { name: '処理中…' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(remove).toHaveBeenCalledOnce()
  expect(cancel).not.toHaveBeenCalled()
  await act(async () => { fail(new Error('offline')); await Promise.resolve() })
  expect(screen.getByRole('heading', { name: /秋の文.*削除しますか？/ })).toBeTruthy()
  expect(screen.getAllByRole('alert').some(el => el.textContent?.includes('実行できませんでした'))).toBe(true)
  expect((screen.getByRole('button', { name: '削除する' }) as HTMLButtonElement).disabled).toBe(false)
})
