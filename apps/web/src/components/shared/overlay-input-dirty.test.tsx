// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import Dialog from './dialog'
import Drawer from './drawer'
afterEach(cleanup)
test.each([Dialog, Drawer])('入力がある窓はdirtyの渡し忘れでも閉じる前に確認する', (Overlay) => {
  const close = vi.fn()
  render(Overlay === Dialog ? <Dialog open title="編集" onCancel={close}><input aria-label="名前" defaultValue="元の名前" /></Dialog> : <Drawer open title="編集" onClose={close}><input aria-label="名前" defaultValue="元の名前" /></Drawer>)
  fireEvent.change(screen.getByRole('textbox', { name: '名前' }), { target: { value: '編集中' } })
  fireEvent.click(screen.getByRole('button', { name: '閉じる', exact: true }))
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '入力を破棄しますか？' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('編集中')
  fireEvent.click(screen.getByRole('button', { name: '閉じる', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '破棄する' }))
  expect(close).toHaveBeenCalledTimes(1)
})
test('元の入力へ戻したときは確認を挟まない', () => {
  const close = vi.fn()
  render(<Dialog open title="編集" onCancel={close}><input aria-label="名前" defaultValue="元の名前" /></Dialog>)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: '変更' } })
  fireEvent.change(input, { target: { value: '元の名前' } })
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(close).toHaveBeenCalledTimes(1)
})

test('本文の編集欄も入力を破棄する前に確認する', () => {
  const close = vi.fn()
  render(<Dialog open title="本文" onCancel={close}><div contentEditable role="textbox" aria-label="本文" suppressContentEditableWarning>元の本文</div></Dialog>)
  const input = screen.getByRole('textbox')
  input.textContent = '変更した本文'
  fireEvent.input(input)
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '入力を破棄しますか？' })).toBeTruthy()
})
