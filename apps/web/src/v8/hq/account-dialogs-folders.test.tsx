// @vitest-environment happy-dom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { AccountWithStats } from '@/contexts/account-context'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
const calls = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), move: vi.fn() }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, lineAccounts: { ...actual.api.lineAccounts, update: calls.update }, lineAccountFolders: { ...actual.api.lineAccountFolders, list: calls.list, move: calls.move } } }
})
import { AccountSettingsDialogV8 } from './account-dialogs'

afterEach(() => { cleanup(); vi.clearAllMocks() })
const account = { id: 'a', name: 'テスト', displayName: 'テスト', channelId: '1', folderId: 'f', isActive: true } as unknown as AccountWithStats
const props = { account, archived: false, onClose: vi.fn(), onSaved: vi.fn(), onArchive: vi.fn(), onEditRegistration: vi.fn() }
const folders = { success: true as const, data: { folders: [{ id: 'f', name: '関西', color: null, displayOrder: 0 }] } }

it('フォルダ取得中は保存を止め、取得後に元のフォルダを正しく表示する', async () => {
  let resolve!: (value: typeof folders) => void
  calls.list.mockReturnValueOnce(new Promise(r => { resolve = r }))
  render(<AccountSettingsDialogV8 {...props} />)
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('フォルダを読み込んでいます。')).toBeTruthy()
  expect(calls.move).not.toHaveBeenCalled()
  await act(async () => resolve(folders))
  expect(screen.getByText('関西')).toBeTruthy()
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false)
})

it('フォルダ取得に失敗したら保存を止め、再読込で復旧できる', async () => {
  calls.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(folders)
  render(<AccountSettingsDialogV8 {...props} />)
  const retry = await screen.findByRole('button', { name: 'もう一度読み込む' })
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(retry)
  expect(await screen.findByText('関西')).toBeTruthy()
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(false)
})

it('設定の名前を編集中は画面移動前に確認する', async () => {
  window.history.replaceState(null, '', '/hq')
  calls.list.mockResolvedValue(folders)
  render(<><AccountSettingsDialogV8 {...props} /><a href="/events">イベントへ</a></>)
  await screen.findByText('関西')
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '新しい名前' } })
  fireEvent.click(screen.getByRole('link', { name: 'イベントへ' }))
  expect(await screen.findByRole('dialog', { name: '保存していない変更があります' })).toBeTruthy()
})
it('名前だけ保存後にフォルダ移動が失敗しても、名前の更新を重ねずに再試行する', async () => {
  calls.list.mockResolvedValue({ success: true, data: { folders: [{ id: 'f', name: '関西', color: null, displayOrder: 0 }, { id: 'g', name: '関東', color: null, displayOrder: 1 }] } })
  calls.update.mockResolvedValue({ success: true, data: {} })
  calls.move.mockResolvedValueOnce({ success: false, error: 'offline' }).mockResolvedValueOnce({ success: true, data: {} })
  render(<AccountSettingsDialogV8 {...props} />)
  await screen.findByText('関西')
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '新しい名前' } })
  fireEvent.click(screen.getByRole('button', { name: 'フォルダ' }))
  fireEvent.click(within(screen.getByRole('option', { name: '関東' })).getByRole('button'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })) })
  expect(calls.update).toHaveBeenCalledTimes(1)
  expect(calls.move).toHaveBeenCalledTimes(1)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })) })
  expect(calls.update).toHaveBeenCalledTimes(1)
  expect(calls.move).toHaveBeenCalledTimes(2)
})
it('設定の入力中にアーカイブを選んだら破棄を確認してから次へ進む', async () => {
  calls.list.mockResolvedValue(folders)
  render(<AccountSettingsDialogV8 {...props} />)
  await screen.findByText('関西')
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '新しい名前' } })
  fireEvent.click(screen.getByRole('button', { name: 'アーカイブ' }))
  expect(props.onArchive).not.toHaveBeenCalled()
  const confirmation = await screen.findByRole('dialog', { name: '保存していない変更があります' })
  fireEvent.click(within(confirmation).getByRole('button', { name: '保存せずに移る' }))
  expect(props.onArchive).toHaveBeenCalledTimes(1)
})
