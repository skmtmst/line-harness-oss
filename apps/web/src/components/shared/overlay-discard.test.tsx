// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Dialog from './dialog'
import Drawer from './drawer'
afterEach(cleanup)
beforeEach(() => { document.documentElement.dataset.theme = 'v8' })
it.each(['dialog', 'drawer'])('決まり1：%sの入力はEsc・外・閉じるで黙って消えない', (kind) => {
  const close = vi.fn()
  render(kind === 'dialog' ? <Dialog open dirty title="編集" onCancel={close} /> : <Drawer open dirty title="編集" onClose={close} />)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  const confirmation = screen.getByRole('dialog', { name: '入力を破棄しますか？' })
  fireEvent.click(within(confirmation).getByRole('button', { name: '編集を続ける' }))
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog', { name: /^編集/ })).getByRole('button', { name: '閉じる' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '入力を破棄しますか？' })).getByRole('button', { name: '破棄する' }))
  expect(close).toHaveBeenCalledTimes(1)
})
