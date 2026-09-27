// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  tagsList: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush, replace: fixture.routerReplace }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    tags: { list: fixture.tagsList },
  },
  eventsApi: {},
}))

import EventWizard from './event-wizard'

beforeEach(() => {
  fixture.tagsList.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R161: イベントの書きかけがある間の離脱確認', () => {
  it('名前を入れてパンくずで一覧へ戻ると確認が出て、編集継続で入力が残る', async () => {
    render(<EventWizard accountId="account-1" eventId={null} step={1} />)
    const nameBox = await screen.findByPlaceholderText('例：第1回 定期便のはじめ方 説明会')
    fireEvent.change(nameBox, { target: { value: '夏の試食会' } })

    fireEvent.click(screen.getByRole('link', { name: 'イベント予約' }))
    await screen.findByText('保存していない変更があります')
    expect(fixture.routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    await waitFor(() => expect(screen.queryByText('保存していない変更があります')).toBeNull())
    expect((screen.getByPlaceholderText('例：第1回 定期便のはじめ方 説明会') as HTMLInputElement).value).toBe('夏の試食会')
  })

  it('破棄を選んだときだけ一覧へ進む', async () => {
    render(<EventWizard accountId="account-1" eventId={null} step={1} />)
    const nameBox = await screen.findByPlaceholderText('例：第1回 定期便のはじめ方 説明会')
    fireEvent.change(nameBox, { target: { value: '夏の試食会' } })

    fireEvent.click(screen.getByRole('link', { name: 'イベント予約' }))
    await screen.findByText('保存していない変更があります')

    fireEvent.click(screen.getByRole('button', { name: '保存せずに移動' }))
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/events'))
  })

  it('何も入れていなければ確認を出さない', async () => {
    render(<EventWizard accountId="account-1" eventId={null} step={1} />)
    await screen.findByPlaceholderText('例：第1回 定期便のはじめ方 説明会')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
