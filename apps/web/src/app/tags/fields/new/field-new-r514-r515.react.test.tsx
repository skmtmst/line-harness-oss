// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  fieldsList: vi.fn(),
  fieldsCreate: vi.fn(),
  foldersList: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1' }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready' as const, features: null, enabled: () => true }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    friendFields: { list: fixture.fieldsList, create: fixture.fieldsCreate },
    folders: { list: fixture.foldersList },
    featureSettings: {
      visibility: () => Promise.resolve({ success: true, data: { features: {} } }),
    },
  },
  describeSaveFailure: () => '保存できませんでした。接続を確かめて、もう一度お試しください。',
}))

import NewFriendFieldPage from './page'

function createButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '項目を作る' }) as HTMLButtonElement
}

beforeEach(() => {
  fixture.fieldsList.mockResolvedValue({ success: true, data: [] })
  fixture.foldersList.mockResolvedValue({ success: true, data: [] })
  fixture.fieldsCreate.mockResolvedValue({ success: true, data: { id: 'ff-9' } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R514 既存項目の取得失敗を隠さず、読み直すまで保存しない', () => {
  it('失敗中は作成ボタンを押せず、再試行の成功で入力を残したまま進める', async () => {
    fixture.fieldsList.mockRejectedValueOnce(new Error('network down'))
    render(<NewFriendFieldPage />)
    await screen.findByText('既存の項目を読み込めませんでした')
    expect(createButton().disabled).toBe(true)
    expect(fixture.fieldsCreate).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('例：愛犬のお名前'), { target: { value: '試す名前' } })
    fireEvent.change(screen.getByPlaceholderText('pet_name'), { target: { value: 'trial_name' } })

    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => expect(createButton().disabled).toBe(false))
    expect((screen.getByPlaceholderText('例：愛犬のお名前') as HTMLInputElement).value).toBe('試す名前')
    expect((screen.getByPlaceholderText('pet_name') as HTMLInputElement).value).toBe('trial_name')
    expect(fixture.fieldsCreate).not.toHaveBeenCalled()

    fireEvent.click(createButton())
    await waitFor(() => expect(fixture.fieldsCreate).toHaveBeenCalledTimes(1))
    expect(fixture.routerPush).toHaveBeenCalledWith('/tags?tab=fields&highlight=ff-9')
  })

  it('フォルダの取得失敗は隠さず、その場で読み直せる', async () => {
    fixture.foldersList.mockRejectedValueOnce(new Error('network down'))
    render(<NewFriendFieldPage />)
    await screen.findByText(/フォルダを読み込めませんでした/)
    // 既存項目は読めているので保存はできる（未分類に入ることを明示している）。
    expect(createButton().disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() => expect(screen.queryByText(/フォルダを読み込めませんでした/)).toBeNull())
  })
})

describe('R515 応答消失後の再試行は同じ要求キーで送る', () => {
  it('入力を変えない再試行は同じキーになる', async () => {
    render(<NewFriendFieldPage />)
    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.change(screen.getByPlaceholderText('例：愛犬のお名前'), { target: { value: '試す名前' } })
    fireEvent.change(screen.getByPlaceholderText('pet_name'), { target: { value: 'trial_name' } })

    fixture.fieldsCreate.mockRejectedValueOnce(new Error('response lost'))
    fireEvent.click(createButton())
    await screen.findByText('保存できませんでした。接続を確かめて、もう一度お試しください。')
    expect(fixture.fieldsCreate).toHaveBeenCalledTimes(1)
    const firstKey = fixture.fieldsCreate.mock.calls[0][2] as string
    expect(typeof firstKey).toBe('string')
    expect(firstKey.length).toBeGreaterThan(0)

    fixture.fieldsCreate.mockResolvedValueOnce({ success: true, data: { id: 'ff-9' } })
    fireEvent.click(createButton())
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/tags?tab=fields&highlight=ff-9'))
    const secondKey = fixture.fieldsCreate.mock.calls[1][2] as string
    expect(secondKey).toBe(firstKey)
  })
})
