// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  fieldsList: vi.fn(),
  foldersList: vi.fn(),
}))

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
  api: {
    friendFields: { list: fixture.fieldsList },
    folders: { list: fixture.foldersList },
  },
}))

import EditFriendFieldPage from './page'

const FIELD = {
  id: 'f-1',
  folderId: null,
  name: '愛犬のお名前',
  fieldKey: 'pet_name',
  type: 'text',
  options: null,
  defaultValue: '',
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

beforeEach(() => {
  fixture.fieldsList.mockResolvedValue({ success: true, data: [FIELD] })
  fixture.foldersList.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R176: 情報欄の編集の書きかけがある間の離脱確認', () => {
  it('名称を変えて一覧へ移ると確認が出て、編集継続で内容が残る', async () => {
    render(<EditFriendFieldPage />)
    const nameBox = await screen.findByLabelText(/項目名/)
    fireEvent.change(nameBox, { target: { value: '愛犬の名前' } })

    fireEvent.click(screen.getByRole('link', { name: '友だち情報欄へ' }))
    await screen.findByText('保存していない変更があります')
    expect(fixture.routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    await waitFor(() => expect(screen.queryByText('保存していない変更があります')).toBeNull())
    expect((screen.getByLabelText(/項目名/) as HTMLInputElement).value).toBe('愛犬の名前')
  })

  it('破棄を選んだときだけ一覧へ進む', async () => {
    render(<EditFriendFieldPage />)
    const nameBox = await screen.findByLabelText(/項目名/)
    fireEvent.change(nameBox, { target: { value: '愛犬の名前' } })

    fireEvent.click(screen.getByRole('link', { name: '友だち情報欄へ' }))
    await screen.findByText('保存していない変更があります')

    fireEvent.click(screen.getByRole('button', { name: '保存せずに移動' }))
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/tags?tab=fields'))
  })

  it('変えていなければ確認を出さない', async () => {
    render(<EditFriendFieldPage />)
    await screen.findByLabelText(/項目名/)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
