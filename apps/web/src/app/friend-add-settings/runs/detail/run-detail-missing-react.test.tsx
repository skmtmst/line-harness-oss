// @vitest-environment happy-dom
/*
 * 実行詳細を開けないときに「再読み込み」だけを出さない。
 * 対象未指定・アカウント未選択・見つからない・取得の失敗を描き分け、
 * 戻り先は一覧から受け取った絞り込みとページ位置を残す。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ accountId: 'account-1' as string | null, params: 'id=run-1', runDetail: vi.fn() }))
vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => 'owner' }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.params) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.accountId, loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => {}, usePageTitle: () => undefined }))
vi.mock('@/lib/api', () => ({ api: { friendAddRules: { runDetail: state.runDetail, retryRun: vi.fn() } } }))

const { default: FriendAddRunDetailPage } = await import('./page')

const LIST_QUERY = 'kind=first_time&status=failed&pages=cur-8'

beforeEach(() => {
  state.accountId = 'account-1'
  state.params = 'id=run-1'
  state.runDetail.mockReset()
})
afterEach(cleanup)

it('記録が指定されていないときは取りに行かず、絞り込みを残した一覧へ戻す', async () => {
  state.params = LIST_QUERY
  render(<FriendAddRunDetailPage />)
  await screen.findByText('見る実行詳細が指定されていません')
  const back = screen.getByRole('link', { name: /実行履歴の一覧へ戻る/ })
  expect(back.getAttribute('href')).toBe(`/friend-add-settings/runs?${LIST_QUERY}`)
  expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).toBeNull()
  expect(state.runDetail).not.toHaveBeenCalled()
})

it('アカウントを選んでいないときは、選ぶよう案内して取りに行かない', async () => {
  state.accountId = null
  render(<FriendAddRunDetailPage />)
  await screen.findByText('LINEアカウントを選んでください')
  expect(state.runDetail).not.toHaveBeenCalled()
})

it('見つからない記録は、読み直しではなく一覧へ戻る道を出す', async () => {
  state.params = `id=run-1&${LIST_QUERY}`
  state.runDetail.mockRejectedValue({ status: 404, message: 'not found' })
  render(<FriendAddRunDetailPage />)
  await screen.findByText('この実行詳細は見つかりません')
  expect(screen.getByRole('link', { name: /実行履歴の一覧へ戻る/ }).getAttribute('href')).toBe(`/friend-add-settings/runs?${LIST_QUERY}`)
  expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).toBeNull()
})

it('取得の失敗は読み直しの口を出し、押すと同じ記録を取り直す', async () => {
  state.runDetail.mockRejectedValue({ status: 500, message: 'boom' })
  render(<FriendAddRunDetailPage />)
  await screen.findByRole('button', { name: /もう一度読み込む/ })
  expect(screen.getByRole('alert').getAttribute('data-target-missing')).toBe('error')
  expect(screen.queryByText('この実行詳細は見つかりません')).toBeNull()
  expect(state.runDetail).toHaveBeenCalledTimes(1)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ })) })
  expect(state.runDetail).toHaveBeenCalledTimes(2)
  expect(state.runDetail).toHaveBeenLastCalledWith('account-1', 'run-1')
})
