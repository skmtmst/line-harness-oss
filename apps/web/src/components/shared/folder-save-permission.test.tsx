// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Folder } from '@line-crm/shared'
const create = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ api: { folders: { create, update } } }))
const editor = vi.hoisted(() => ({ confirm: null as null | (() => void) }))
vi.mock('./folder-editor-dialog', async importOriginal => {
  const actual = await importOriginal<typeof import('./folder-editor-dialog')>()
  const Original = actual.default
  return { ...actual, default: (props: React.ComponentProps<typeof Original>) => { editor.confirm = props.onConfirm ?? null; return <Original {...props} /> } }
})
import FolderAddDialog from './folder-add-dialog'
import FolderEditorDialog from './folder-editor-dialog'
beforeEach(() => { vi.resetAllMocks(); editor.confirm = null })
afterEach(cleanup)
it.each([false, true])('保持したフォルダ%sの保存は現在の権限を確かめ、窓と入力を残して書込0', editing => {
  let allowed = true
  const close = vi.fn(), added = vi.fn()
  render(<FolderAddDialog kind="broadcast" folder={editing ? { id: 'f', name: '前の名前', color: null } as Folder : undefined} accountId="a" canSaveNow={() => allowed} onClose={close} onAdded={added} />)
  const dialog = screen.getByRole('dialog')
  const input = screen.getByRole('textbox', { name: 'フォルダ名' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '新しい名前' } })
  allowed = false
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByRole('alert').textContent).toContain('権限が変わったため、フォルダの保存を中止しました。')
  expect(input.value).toBe('新しい名前'); expect(screen.getByRole('dialog')).toBe(dialog)
  fireEvent.click(screen.getByRole('button', { name: editing ? '保存する' : '追加する' }))
  expect(editor.confirm).toBeTypeOf('function')
  act(() => editor.confirm?.())
  expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled(); expect(added).not.toHaveBeenCalled()
})
it('理由がある確定は灰色の焦点可能な口で、理由を示し保存しない', () => {
  render(<FolderAddDialog kind="broadcast" accountId="a" canSaveNow={() => false} confirmLockedReason="この操作はオーナーか管理者だけができます。" onClose={vi.fn()} onAdded={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'フォルダ名' }), { target: { value: '分類' } })
  const confirm = screen.getByRole('button', { name: '追加する' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(false); expect(confirm.getAttribute('aria-disabled')).toBe('true')
  fireEvent.focus(confirm); expect(screen.getByRole('tooltip').textContent).toContain('オーナーか管理者')
  fireEvent.click(confirm); expect(create).not.toHaveBeenCalled()
})
it.each([false, true])('新しい口を省略した%sでは従来どおり保存して閉じる', async editing => {
  create.mockResolvedValue({ success: true, data: { id: 'new' } }); update.mockResolvedValue({ success: true, data: { id: 'f' } })
  const close = vi.fn(), added = vi.fn()
  render(<FolderAddDialog kind="broadcast" accountId="a" folder={editing ? { id: 'f', name: '元の分類', color: null } as Folder : undefined} onClose={close} onAdded={added} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'フォルダ名' }), { target: { value: '新しい名前' } })
  const confirm = screen.getByRole('button', { name: editing ? '保存する' : '追加する' })
  expect(confirm.hasAttribute('data-permission-locked')).toBe(false)
  fireEvent.click(confirm)
  await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  expect(editing ? update : create).toHaveBeenCalledTimes(1)
  expect(added).toHaveBeenCalledTimes(1)
})

it.each([false, true])('理由だけを渡したフォルダ%sはEnterでも確定でも保存しない', editing => {
  render(<FolderAddDialog kind="broadcast" accountId="a" folder={editing ? { id: 'f', name: '分類', color: null } as Folder : undefined} confirmLockedReason="閲覧のみのため変更できません。" onClose={vi.fn()} onAdded={vi.fn()} />)
  const input = screen.getByRole('textbox', { name: 'フォルダ名' })
  fireEvent.change(input, { target: { value: '残す名前' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: editing ? '保存する' : '追加する' }))
  expect(editor.confirm).toBeTypeOf('function')
  act(() => editor.confirm?.())
  expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled()
})
it('FolderEditorを直接使う時も理由付きのEnterはonConfirmを呼ばない', () => {
  const save = vi.fn()
  render(<FolderEditorDialog open title="フォルダを追加" name="分類" onNameChange={vi.fn()} color={null} onColorChange={vi.fn()} onCancel={vi.fn()} onConfirm={save} confirmLockedReason="閲覧のみのため変更できません。" />)
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'フォルダ名' }), { key: 'Enter' })
  expect(save).not.toHaveBeenCalled()
})
it('本人確認中は理由なしnative disabledで、Enterでも保存せず偽の権限変更文を出さない', () => {
  render(<FolderAddDialog kind="broadcast" accountId="a" confirmDisabled canSaveNow={() => false} onClose={vi.fn()} onAdded={vi.fn()} />)
  const input = screen.getByRole('textbox', { name: 'フォルダ名' })
  fireEvent.change(input, { target: { value: '分類' } })
  const confirm = screen.getByRole('button', { name: '追加する' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  expect(confirm.hasAttribute('data-permission-locked')).toBe(false)
  fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.click(confirm)
  expect(editor.confirm).toBeTypeOf('function')
  act(() => editor.confirm?.())
  expect(screen.queryByRole('alert')).toBeNull()
  expect(create).not.toHaveBeenCalled()
})
