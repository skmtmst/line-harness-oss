// @vitest-environment happy-dom
/*
 * 監査 WEB317：予約の取消が成功したら、成功の知らせを出す。
 * 応答は下書き（scheduledAt なし）なので、「予約待ちではありません」の画面に戻さない。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({ cancelReservation: vi.fn(), id: 'bc-1', accountId: 'acc-1', getCount: 0 }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? apiMocks.id : null) }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: apiMocks.accountId, loading: false, accounts: [] }),
}))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn(), usePageCrumbs: vi.fn() }))

const scheduled = {
  id: 'bc-1', title: '秋のお知らせ', messageType: 'text', messageContent: '本文', targetType: 'all',
  targetTagId: null, status: 'scheduled', scheduledAt: '2026-10-20T01:00:00.000Z', sentAt: null,
  totalCount: 0, successCount: 0, lineAccountId: 'acc-1', version: 1, createdAt: '2026-10-01T00:00:00Z',
}

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    data: unknown
    constructor(status: number, _message?: string, _code?: string, data?: unknown) { super(`API error: ${status}`); this.status = status; this.data = data }
  }
  return {
    ApiError,
    api: {
      broadcasts: {
        get: async (id: string) => { apiMocks.getCount++; return { success: true, data: id === 'bc-1' ? scheduled : { ...scheduled, id, title: '別の配信', ...(id === 'bc-no-version' ? { version: undefined } : {}) } } },
        preflight: async () => ({ success: false, error: 'x' }),
        notificationSettings: async () => ({ success: false, error: 'x' }),
        testSend: vi.fn(),
        create: vi.fn(),
        cancelReservation: (...args: unknown[]) => apiMocks.cancelReservation(...args),
      },
      tags: { list: async () => ({ success: true, data: [] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
      staff: { me: async () => ({ success: true, data: { role: 'owner' } }) },
    },
  }
})

import Page from './page'

afterEach(() => { cleanup(); apiMocks.id = 'bc-1'; apiMocks.accountId = 'acc-1'; apiMocks.getCount = 0; apiMocks.cancelReservation.mockReset() })

describe('予約の取消の成功（WEB317）', () => {
  it('取り消したら成功を知らせ、「予約状態を確認できませんでした」にしない', async () => {
    apiMocks.cancelReservation.mockResolvedValue({ success: true, data: { ...scheduled, status: 'draft', scheduledAt: null } })
    render(<Page />)
    const open = await screen.findByRole('button', { name: '予約を取り消す…' })
    await act(async () => { open.click() })
    const confirm = screen.getAllByRole('button').find((button) => button.textContent?.trim() === '予約を取り消す')
    expect(confirm).toBeTruthy()
    await act(async () => { confirm!.click() })
    await waitFor(() => expect(screen.getByText('予約を取り消しました。内容は下書きとして残っています。')).toBeTruthy())
    expect(apiMocks.cancelReservation).toHaveBeenCalledWith('bc-1', 1)
    expect(screen.queryByText('予約状態を確認できませんでした')).toBeNull()
  })
  it('別の予約を開いたら古い確認窓を閉じ、別の予約を取り消さない', async () => {
    apiMocks.id = 'bc-1'
    apiMocks.cancelReservation.mockReset()
    const view = render(<Page />)
    const open = await screen.findByRole('button', { name: '予約を取り消す…' })
    await act(async () => { open.click() })
    expect(screen.getByRole('dialog')).toBeTruthy()
    apiMocks.id = 'bc-2'
    view.rerender(<Page />)
    await screen.findAllByText('別の配信')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(apiMocks.cancelReservation).not.toHaveBeenCalled()
    apiMocks.id = 'bc-1'
  })

  it('他の人の変更で409になったら再実行を止め、読み直してから選び直す', async () => {
    const { ApiError } = await import('@/lib/api')
    apiMocks.cancelReservation.mockRejectedValueOnce(new ApiError(409))
    render(<Page />)
    const open = await screen.findByRole('button', { name: '予約を取り消す…' })
    await act(async () => { open.click() })
    const dialog = screen.getByRole('dialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent?.trim() === '予約を取り消す')!
    await act(async () => { confirm.click() })
    expect(await screen.findByText('ほかの人が予約を変えました。読み直してから、もう一度選んでください')).toBeTruthy()
    expect(dialog.querySelector('[data-save-conflict]')).not.toBeNull()
    expect(Array.from(dialog.querySelectorAll('button')).some(button => button.textContent?.trim() === '予約を取り消す')).toBe(false)
    await act(async () => { screen.getByRole('button', { name: '最新を読み込んで続ける' }).click() })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(apiMocks.cancelReservation).toHaveBeenCalledTimes(1)
  })

  it('版が分からない予約は取り消さず、読み直しを案内する', async () => {
    apiMocks.id = 'bc-no-version'
    render(<Page />)
    const open = await screen.findByRole('button', { name: '予約を取り消す…' })
    await act(async () => { open.click() })
    expect(screen.getByText('予約の版を確認できません。読み直してから、もう一度選んでください')).toBeTruthy()
    expect(screen.getByRole('button', { name: '最新を読み込んで続ける' })).toBeTruthy()
    expect(apiMocks.cancelReservation).not.toHaveBeenCalled()
  })

  it('同じ予約でアカウントを切り替えて戻すと、古い確認では実行できない', async () => {
    const view = render(<Page />)
    const open = await screen.findByRole('button', { name: '予約を取り消す…' })
    await act(async () => { open.click() })
    expect(screen.getByRole('dialog')).toBeTruthy()
    apiMocks.accountId = 'acc-2'
    view.rerender(<Page />)
    await screen.findByText('選択中のアカウントの配信ではありません')
    apiMocks.accountId = 'acc-1'
    view.rerender(<Page />)
    await screen.findByRole('button', { name: '予約を取り消す…' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(apiMocks.cancelReservation).not.toHaveBeenCalled()
  })

  it.each([
    ['sending', '送信が始まったため取り消せません。読み直してください'],
    ['sent', '送信が始まったため取り消せません。読み直してください'],
    ['draft', 'すでに取り消されています。読み直してください'],
    ['scheduled', 'ほかの人が予約を変えました。読み直してから、もう一度選んでください'],
  ])('409で現在の状態が%sなら、状態に合う案内を出す', async (status, message) => {
    const { ApiError } = await import('@/lib/api')
    apiMocks.cancelReservation.mockRejectedValueOnce(new ApiError(409, '', 'VERSION_CONFLICT', { status }))
    render(<Page />)
    const open = await screen.findByRole('button', { name: '予約を取り消す…' })
    await act(async () => { open.click() })
    const dialog = screen.getByRole('dialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent?.trim() === '予約を取り消す')!
    await act(async () => { confirm.click() })
    expect(await screen.findByText(message)).toBeTruthy()
    const readsBeforeClose = apiMocks.getCount
    await act(async () => { dialog.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!.click() })
    await waitFor(() => expect(apiMocks.getCount).toBeGreaterThan(readsBeforeClose))
    await screen.findByRole('button', { name: '予約を取り消す…' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(apiMocks.cancelReservation).toHaveBeenCalledTimes(1)
  })

})
