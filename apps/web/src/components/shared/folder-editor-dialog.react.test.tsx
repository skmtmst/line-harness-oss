// @vitest-environment happy-dom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import FolderEditorDialog from './folder-editor-dialog'
import FolderAddDialog from './folder-add-dialog'
import { api } from '@/lib/api'

vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => 'v8' }))
vi.mock('@/lib/api', () => ({ api: { folders: { create: vi.fn(), update: vi.fn() } } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

function Host({ onCancel = vi.fn() }: { onCancel?: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string | null>(null)
  return <FolderEditorDialog open title="フォルダを追加" name={name} onNameChange={setName}
    color={color} onColorChange={setColor} colors={[{ value: '#3b82f6', name: '青' }, { value: '#ef4444', name: '赤' }]}
    allowClear onCancel={onCancel} />
}

it('名前と色を同じ行に置き、閉じた状態では色の並びも注記も出さない', async () => {
  await act(async () => { render(<Host />) })
  const row = document.querySelector('[data-folder-name-color]')!
  expect(row.contains(screen.getByRole('textbox', { name: 'フォルダ名' }))).toBe(true)
  expect(row.contains(screen.getByRole('button', { name: 'フォルダの色：色なし' }))).toBe(true)
  expect(screen.queryByRole('radiogroup')).toBeNull()
  expect(screen.queryByText(/色だけに頼らず/)).toBeNull()
})

it('色を選び、矢印キーで選択を変え、Escで色だけ閉じる。色なしにも戻せる', async () => {
  const onCancel = vi.fn()
  await act(async () => { render(<Host onCancel={onCancel} />) })
  fireEvent.click(screen.getByRole('button', { name: 'フォルダの色：色なし' }))
  fireEvent.click(screen.getByRole('radio', { name: '赤' }))
  const button = screen.getByRole('button', { name: 'フォルダの色：赤' })
  expect(screen.queryByRole('radiogroup')).toBeNull()
  fireEvent.click(button)
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: '赤' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Home' })
  expect(screen.getByRole('radio', { name: '色なし' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.keyDown(document.activeElement!, { key: 'Escape', isComposing: true })
  expect(screen.getByRole('radiogroup')).toBeTruthy()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('radiogroup')).toBeNull()
  expect(onCancel).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'フォルダを追加' })).toBeTruthy()
})

it('共通の追加窓はIME確定で送らず、名前・色・所属を送り、失敗時は入力を残して再試行できる', async () => {
  vi.mocked(api.folders.create).mockResolvedValueOnce({ success: false, error: '同じ名前のフォルダがあります' })
    .mockResolvedValueOnce({ success: true, data: { id: 'f-new' } } as never)
  const onAdded = vi.fn(), onClose = vi.fn()
  await act(async () => { render(<FolderAddDialog kind="template" accountId="a-1" onAdded={onAdded} onClose={onClose} />) })
  const input = screen.getByRole('textbox', { name: 'フォルダ名' })
  fireEvent.change(input, { target: { value: ' 購入 ' } })
  fireEvent.click(screen.getByRole('button', { name: 'フォルダの色：青' }))
  fireEvent.click(screen.getByRole('radio', { name: '赤' }))
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  expect(api.folders.create).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '追加する' })) })
  expect(api.folders.create).toHaveBeenCalledWith({ kind: 'template', name: '購入', color: '#EF4444', accountId: 'a-1' })
  expect(screen.getByRole('alert').textContent).toContain('同じ名前')
  expect((input as HTMLInputElement).value).toBe(' 購入 ')
  expect(screen.getByRole('button', { name: 'フォルダの色：赤' })).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '追加する' })) })
  expect(onAdded).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
})
