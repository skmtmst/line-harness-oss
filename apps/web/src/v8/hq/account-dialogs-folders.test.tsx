// @vitest-environment happy-dom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AccountWithStats } from '@/contexts/account-context'

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
