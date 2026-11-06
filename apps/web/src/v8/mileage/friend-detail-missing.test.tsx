// @vitest-environment happy-dom
/*
 * 友だちのマイル明細を開けないときに「再読み込み」だけを出さない。
 * 対象未指定・アカウント未選択・見つからない（一覧へ戻す）と、取得の失敗（読み直す）を分ける。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
  return { params: 'id=f1', accountId: 'acc' as string | null, getFriend: vi.fn() }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {} }),
  useSearchParams: () => new URLSearchParams(state.params),
  usePathname: () => '/mileage/friend',
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.accountId, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: {
        ...actual.api.friends,
        get: state.getFriend,
        mileage: async () => ({ success: true, data: { summary: { available: 0, pending: 0, lifetimeEarned: 0, spent: 0 }, history: [], insights: null } }),
      },
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { role: 'staff' } }) },
      mileage: {
        ...actual.api.mileage,
        friendsV6: async () => ({ success: true, data: { balanceSource: 'musubo', items: [] } }),
        history: async () => ({ success: false, error: 'x' }),
      },
    },
  }
})

import { ApiError } from '@/lib/api'
import FriendDetailV8 from './friend-detail'

beforeEach(() => {
  state.params = 'id=f1'
  state.accountId = 'acc'
  state.getFriend.mockReset()
  state.getFriend.mockResolvedValue({ success: true, data: { id: 'f1', displayName: '田中', createdAt: '2026-01-01T00:00:00Z' } })
})
afterEach(cleanup)

it('友だちが指定されていないときは取りに行かず、友だち一覧へ戻す', async () => {
  state.params = ''
  render(<FriendDetailV8 />)
  await screen.findByText('マイル明細を見る友だちが指定されていません')
  expect(screen.getByRole('link', { name: /友だち一覧へ戻る/ }).getAttribute('href')).toBe('/friends')
  expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).toBeNull()
  expect(state.getFriend).not.toHaveBeenCalled()
})

it('アカウントを選んでいないときは、選ぶよう案内して取りに行かない', async () => {
  state.accountId = null
  render(<FriendDetailV8 />)
  await screen.findByText('LINEアカウントを選択してください')
  expect(state.getFriend).not.toHaveBeenCalled()
})

it('見つからない友だちは、アカウントを確かめるよう言って一覧へ戻す', async () => {
  state.getFriend.mockRejectedValue(new ApiError(404, 'not found'))
  render(<FriendDetailV8 />)
  await screen.findByText('友だちが選択中のLINEアカウントにいるか確認して、一覧から選び直してください。')
  expect(screen.getByRole('link', { name: /友だち一覧へ戻る/ }).getAttribute('href')).toBe('/friends')
  expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).toBeNull()
})

it('取得の失敗は読み直しの口を出し、押すと取り直して明細へ戻る', async () => {
  state.getFriend.mockRejectedValueOnce(new ApiError(500, 'boom'))
  render(<FriendDetailV8 />)
  await screen.findByRole('button', { name: /もう一度読み込む/ })
  expect(screen.queryByRole('link', { name: /友だち一覧へ戻る/ })).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ })) })
  expect(state.getFriend).toHaveBeenCalledTimes(2)
  expect(state.getFriend).toHaveBeenLastCalledWith('f1')
  expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).toBeNull()
})
