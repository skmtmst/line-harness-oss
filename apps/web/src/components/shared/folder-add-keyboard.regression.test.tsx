// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { folders: { create } } }))
import FolderAddDialog from './folder-add-dialog'
beforeEach(() => { vi.resetAllMocks(); document.documentElement.dataset.theme = 'v8' })
afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })
function host(onClose = vi.fn()) {
  render(<FolderAddDialog kind="template" accountId="a-1" onClose={onClose} onAdded={() => {}} />)
  return onClose
}
it.each([{ isComposing: true }, { keyCode: 229 }])('WEB-C08: 名前と色は横並びのまま、IME %j のEnterは追加しない', (ime) => {
  host()
  const input = screen.getByRole('textbox', { name: 'フォルダ名' })
  expect(document.querySelector('[data-folder-name-color]')?.contains(input)).toBe(true)
  expect(document.querySelector('[data-folder-name-color]')?.contains(screen.getByRole('button', { name: 'フォルダの色：青' }))).toBe(true)
  fireEvent.change(input, { target: { value: '冬' } })
  fireEvent.keyDown(input, { key: 'Enter', ...ime })
  expect(create).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'フォルダを追加' })).toBeTruthy()
})
it('WEB-C08: Tabを窓の中で循環、Escで閉じ、保存中はEsc・背景・×・キャンセルで閉じない', async () => {
  let finish!: (value: unknown) => void
  create.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const close = host()
  const first = screen.getByRole('button', { name: '閉じる' })
  const input = screen.getByRole('textbox', { name: 'フォルダ名' })
  fireEvent.change(input, { target: { value: '冬' } })
  const last = screen.getByRole('button', { name: '追加する' })
  last.focus()
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(last)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(close).toHaveBeenCalledTimes(1)
  close.mockClear()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(create).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(input, { key: 'Escape' })
  fireEvent.click(first)
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  fireEvent.mouseDown(screen.getByRole('presentation'))
  expect(close).not.toHaveBeenCalled()
  expect((input as HTMLInputElement).disabled).toBe(true)
  await act(async () => { finish({ success: false, error: '通信が切れました' }) })
  expect(screen.getByRole('alert').textContent).toContain('通信')
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(close).toHaveBeenCalledTimes(1)
})
