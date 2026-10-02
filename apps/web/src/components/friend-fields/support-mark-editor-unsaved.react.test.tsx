// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  routerPush: vi.fn(),
  marksList: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1' }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    supportMarks: { list: fixture.marksList },
  },
}))

import SupportMarkEditor from './support-mark-editor'

beforeEach(() => {
  fixture.marksList.mockResolvedValue({ success: true, data: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('R176: 対応マークの書きかけがある間の離脱確認', () => {
  it('名前を変えて一覧へ移ると確認が出て、編集継続で内容が残る', async () => {
    render(<SupportMarkEditor />)
    const nameBox = await screen.findByPlaceholderText('例：要確認')
    fireEvent.change(nameBox, { target: { value: '要対応' } })

    fireEvent.click(screen.getByRole('link', { name: '対応マークへ' }))
    await screen.findByText('保存していない変更があります')
    expect(fixture.routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))
    await waitFor(() => expect(screen.queryByText('保存していない変更があります')).toBeNull())
    expect((screen.getByPlaceholderText('例：要確認') as HTMLInputElement).value).toBe('要対応')
  })

  it('破棄を選んだときだけ一覧へ進む', async () => {
    render(<SupportMarkEditor />)
    const nameBox = await screen.findByPlaceholderText('例：要確認')
    fireEvent.change(nameBox, { target: { value: '要対応' } })

    fireEvent.click(screen.getByRole('link', { name: '対応マークへ' }))
    await screen.findByText('保存していない変更があります')

    fireEvent.click(screen.getByRole('button', { name: '保存せずに移る' }))
    await waitFor(() => expect(fixture.routerPush).toHaveBeenCalledWith('/tags?tab=marks'))
  })

  it('触っていなければ確認を出さない', async () => {
    render(<SupportMarkEditor />)
    await screen.findByPlaceholderText('例：要確認')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
