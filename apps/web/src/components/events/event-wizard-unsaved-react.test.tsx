// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  tagsList: vi.fn(),
}))

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: fixture.routerPush, replace: fixture.routerReplace }),
}))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, tags: { list: fixture.tagsList }, staff: { ...actual.api.staff, me: vi.fn().mockResolvedValue({ success: true, data: { id: 'me', role: 'owner', isActive: true } }) } } }
})

import EventsCreate from '@/v8/events/create'

beforeEach(() => {
  fixture.tagsList.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R161: イベントの書きかけがある間の離脱確認', () => {
  it('名前を入れてパンくずで一覧へ戻ると確認が出て、編集継続で入力が残る', async () => {
    render(<EventsCreate />)
    const nameBox = await screen.findByPlaceholderText('秋のしつけ教室（第1回）')
    fireEvent.change(nameBox, { target: { value: '夏の試食会' } })

    fireEvent.click(screen.getByRole('link', { name: 'キャンセル' }))
    await screen.findByText('保存していない変更があります')
    expect(fixture.routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    await waitFor(() => expect(screen.queryByText('保存していない変更があります')).toBeNull())
    expect((screen.getByPlaceholderText('秋のしつけ教室（第1回）') as HTMLInputElement).value).toBe('夏の試食会')
  })

  it('破棄を選んだときだけ一覧へ進む', async () => {
    render(<EventsCreate />)
    const nameBox = await screen.findByPlaceholderText('秋のしつけ教室（第1回）')
    fireEvent.change(nameBox, { target: { value: '夏の試食会' } })

    fireEvent.click(screen.getByRole('link', { name: 'キャンセル' }))
    await screen.findByText('保存していない変更があります')

    fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/events'))
  })

  it('何も入れていなければ確認を出さない', async () => {
    render(<EventsCreate />)
    await screen.findByPlaceholderText('秋のしつけ教室（第1回）')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
