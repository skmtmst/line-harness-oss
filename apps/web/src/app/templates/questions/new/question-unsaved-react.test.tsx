// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  foldersList: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => undefined, usePageTitle: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/',
  useRouter: () => ({ push: fixture.routerPush }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/lib/api', () => ({
  api: { staff: { me: () => Promise.resolve({ success: true, data: { role: globalThis.localStorage?.getItem?.('lh_staff_role') ?? 'owner' } }) },
    templates: {},
    folders: { list: fixture.foldersList },
    tags: { list: async () => ({ success: true, data: [] }) },
    friendFields: { list: async () => ({ success: true, data: [] }) },
    scenarios: { list: async () => ({ success: true, data: [] }) },
  },
}))
vi.mock('@/lib/staff-capability', () => ({ isOwnerOrAdmin: () => true }))

import QuestionTemplatePage from './page'

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  fixture.foldersList.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R136: 質問の書きかけがある間の離脱確認', () => {
  it('質問文を変えて「シナリオで使う」を押すと確認が出て、編集継続で内容が残る', async () => {
    render(<>
      <QuestionTemplatePage />
    </>)
    const nameBox = await screen.findByPlaceholderText('例：継続の意思をうかがう')
    fireEvent.change(nameBox, { target: { value: '継続の意思' } })
    fireEvent.change(screen.getByPlaceholderText('来月も定期便を続けますか？'), { target: { value: '続けますか？' } })

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await screen.findByText('保存していない変更があります')
    expect(fixture.routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    await waitFor(() => expect(screen.queryByText('保存していない変更があります')).toBeNull())
    expect((screen.getByPlaceholderText('来月も定期便を続けますか？') as HTMLInputElement).value).toBe('続けますか？')
  })

  it('破棄を選んだときだけ一覧へ進む', async () => {
    render(<QuestionTemplatePage />)
    const nameBox = await screen.findByPlaceholderText('例：継続の意思をうかがう')
    fireEvent.change(nameBox, { target: { value: '継続の意思' } })

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await screen.findByText('保存していない変更があります')

    fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/templates'))
  })

  it('何も変えていなければ確認を出さない', async () => {
    render(<QuestionTemplatePage />)
    await screen.findByPlaceholderText('例：継続の意思をうかがう')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
