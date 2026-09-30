// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  fieldsList: vi.fn(),
  fieldsUpdate: vi.fn(),
  foldersList: vi.fn(),
}))

const { TestApiError } = vi.hoisted(() => {
  class TestApiError extends Error {
    status: number
    code?: string
    data?: unknown
    constructor(status: number, message: string, code?: string, data?: unknown) {
      super(message)
      this.status = status
      this.code = code
      this.data = data
    }
  }
  return { TestApiError }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
  useSearchParams: () => new URLSearchParams('id=f-1'),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', selectedAccount: { id: 'account-1', name: '本店' } }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: null, enabled: () => true }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: TestApiError,
  api: {
    friendFields: { list: fixture.fieldsList, update: fixture.fieldsUpdate },
    folders: { list: fixture.foldersList },
    featureSettings: {
      visibility: () => Promise.resolve({ success: true, data: { features: {} } }),
    },
  },
}))

import EditFriendFieldPage from './page'

const FIELD = {
  id: 'f-1',
  folderId: 'folder-1',
  name: 'メモ',
  fieldKey: 'memo',
  type: 'text',
  options: null,
  defaultValue: null,
  source: 'manual',
  ecFieldPath: null,
  ecIsMaster: false,
  isPersonal: false,
  isStarred: true,
  displayOrder: 0,
  createdAt: '2026-09-01T00:00:00+09:00',
  updatedAt: '2026-09-01T00:00:00+09:00',
  version: 3,
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '保存する' }) as HTMLButtonElement
}

function nameBox(): HTMLInputElement {
  return screen.getByLabelText(/項目名/) as HTMLInputElement
}

beforeEach(() => {
  fixture.fieldsList.mockResolvedValue({ success: true, data: [FIELD] })
  fixture.foldersList.mockResolvedValue({
    success: true,
    data: [{ id: 'folder-1', name: '基本', kind: 'friend_field' }],
  })
  fixture.fieldsUpdate.mockResolvedValue({ success: true, data: { id: 'f-1' } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R516 フォルダ取得失敗を隠さず、未分類と誤表示しない', () => {
  it('失敗中は選択欄を出さず、その場で読み直せる', async () => {
    fixture.foldersList.mockRejectedValueOnce(new Error('network down'))
    render(<EditFriendFieldPage />)
    await screen.findByText('所属を読み込めませんでした。今の所属は変わらず保存されます。')
    // 未分類だけの選択欄は出さない（所属IDは入力に残る）。
    expect(screen.queryByLabelText('友だち情報欄のフォルダ')).toBeNull()
    expect(nameBox().value).toBe('メモ')

    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => expect(screen.queryByLabelText('友だち情報欄のフォルダ')).not.toBeNull())
  })

  it('失敗中も保存は元の所属のまま送る', async () => {
    fixture.foldersList.mockRejectedValueOnce(new Error('network down'))
    render(<EditFriendFieldPage />)
    await screen.findByText('所属を読み込めませんでした。今の所属は変わらず保存されます。')
    fireEvent.change(nameBox(), { target: { value: 'メモB' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(fixture.fieldsUpdate).toHaveBeenCalledTimes(1))
    expect(fixture.fieldsUpdate).toHaveBeenCalledWith(
      'f-1', 'account-1', expect.objectContaining({ name: 'メモB', folderId: 'folder-1' }),
    )
  })
})

describe('R517 応答消失後の再試行で保存済みか別人かを分ける', () => {
  it('送った内容が保存済みなら保存済みと案内する', async () => {
    render(<EditFriendFieldPage />)
    await waitFor(() => expect(nameBox().value).toBe('メモ'))
    fireEvent.change(nameBox(), { target: { value: 'メモA' } })

    fixture.fieldsUpdate.mockRejectedValueOnce(
      new TestApiError(409, 'ほかの変更が先に保存されました', 'VERSION_CONFLICT'),
    )
    // 1回目の保存は成功し、応答だけ失った想定。最新は送った内容と同じ。
    fixture.fieldsList.mockResolvedValueOnce({
      success: true,
      data: [{ ...FIELD, name: 'メモA', version: 4 }],
    })
    fireEvent.click(saveButton())
    await screen.findByText('保存されています。入力した内容は最新の保存内容と同じです。')
    expect(nameBox().value).toBe('メモA')
    expect(fixture.fieldsUpdate).toHaveBeenCalledWith(
      'f-1', 'account-1', expect.objectContaining({ version: 3 }),
    )

    fireEvent.click(screen.getByRole('button', { name: '一覧で確認する' }))
    expect(fixture.routerPush).toHaveBeenCalledWith('/tags?tab=fields&highlight=f-1')
  })

  it('別人の変更なら差分を見せて取り込める', async () => {
    render(<EditFriendFieldPage />)
    await waitFor(() => expect(nameBox().value).toBe('メモ'))
    fireEvent.change(nameBox(), { target: { value: 'メモA' } })

    fixture.fieldsUpdate.mockRejectedValueOnce(
      new TestApiError(409, 'ほかの変更が先に保存されました', 'VERSION_CONFLICT'),
    )
    // ほかの担当者が名前を変えて保存した想定。
    fixture.fieldsList.mockResolvedValueOnce({
      success: true,
      data: [{ ...FIELD, name: 'Bの名前', version: 4 }],
    })
    fireEvent.click(saveButton())
    await screen.findByText('ほかの担当者が先に変更しました。最新の内容を確認してから保存し直してください。')
    // 入力は残り、最新の名前が見える（パンくずと注意書きの両方に出る）。
    expect(nameBox().value).toBe('メモA')
    expect(screen.getAllByText(/Bの名前/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '最新の内容を取り込む' }))
    expect(nameBox().value).toBe('Bの名前')

    fixture.fieldsUpdate.mockResolvedValueOnce({ success: true, data: { id: 'f-1' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(fixture.fieldsUpdate).toHaveBeenCalledTimes(2))
    // 最新の版（4）で送り直す。
    expect(fixture.fieldsUpdate).toHaveBeenLastCalledWith(
      'f-1', 'account-1', expect.objectContaining({ version: 4 }),
    )
  })
})
