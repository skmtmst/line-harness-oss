// @vitest-environment happy-dom
/*
 * 読み込めない・対象が無い画面で「再読み込み」だけを繰り返さない。
 * 自動応答を作る画面（公開の確認もここ）を、見つからない・取得の失敗の状態で描いて、
 * 一覧へ戻る道と、読み直しの口を押して確かめる。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
  return { getDraft: vi.fn() }
})
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams('id=rule-1&step=priority') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1', accounts: [{ id: 'account-1' }] }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => false, status: 'ready' }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/components/auto-replies/inline-action-list', () => ({ default: () => null, useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }) }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      autoReplies: { getDraft: net.getDraft, get: async () => ({ success: true, data: { isActive: true, lifecycleStatus: 'published' } }), list: async () => ({ success: true, data: [] }) },
      templates: { list: async () => ({ success: true, data: [] }) },
      folders: { list: async () => ({ success: true, data: [] }) },
    },
  }
})

import { ApiError } from '@/lib/api'
import Page from '../../../v8/auto-replies/edit/wizard'

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

it('見つからない自動応答は、読み直しではなく一覧へ戻る道を出す', async () => {
  net.getDraft.mockResolvedValue({ success: false, error: 'not found' })
  render(<Page />)
  await screen.findByText('この自動応答は見つかりません')
  expect(screen.getByRole('link', { name: /自動応答の一覧へ戻る/ }).getAttribute('href')).toBe('/auto-replies')
  expect(screen.queryByRole('button', { name: /もう一度読み込む/ })).toBeNull()
})

it('404 で返った自動応答も、見つからないとして一覧へ戻す', async () => {
  net.getDraft.mockRejectedValue(new ApiError(404, 'not found'))
  render(<Page />)
  await screen.findByText('この自動応答は見つかりません')
  expect(screen.getByRole('link', { name: /自動応答の一覧へ戻る/ }).getAttribute('href')).toBe('/auto-replies')
})

it('取得の失敗は見つからないと言わず、読み直しの口で同じ下書きを取り直す', async () => {
  net.getDraft.mockRejectedValue(new ApiError(500, 'boom'))
  render(<Page />)
  await screen.findByRole('button', { name: /もう一度読み込む/ })
  expect(screen.queryByText('この自動応答は見つかりません')).toBeNull()
  expect(net.getDraft).toHaveBeenCalledTimes(1)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ })) })
  expect(net.getDraft).toHaveBeenCalledTimes(2)
  expect(net.getDraft).toHaveBeenLastCalledWith('rule-1')
})
