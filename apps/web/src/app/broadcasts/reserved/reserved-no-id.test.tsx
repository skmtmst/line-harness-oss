// @vitest-environment happy-dom
/*
 * 全ルート監査 A2（2026-09-25）: `/broadcasts/reserved` を id なしで開くと
 * 「予約結果を表示できませんでした」になっていた。対象未指定は失敗では
 * ないので、予定へ戻して選び直させる。id ありでは予約内容が出る。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const params = vi.hoisted(() => ({ id: null as string | null }))
const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  preflight: vi.fn(),
  notificationSettings: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? params.id : null) }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'visual-qa-account', loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: {
    broadcasts: {
      get: (...args: unknown[]) => apiMocks.get(...args),
      preflight: (...args: unknown[]) => apiMocks.preflight(...args),
      notificationSettings: (...args: unknown[]) => apiMocks.notificationSettings(...args),
      testSend: vi.fn(),
      create: vi.fn(),
      cancelReservation: vi.fn(),
    },
    tags: { list: async () => ({ success: true, data: [] }) },
    scenarios: { list: async () => ({ success: true, data: [] }) },
  },
}))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  params.id = null
  apiMocks.get.mockReset()
  apiMocks.preflight.mockResolvedValue({ success: false, error: 'x' })
  apiMocks.notificationSettings.mockResolvedValue({ success: false, error: 'x' })
})
afterEach(cleanup)

const broadcast = {
  id: 'broadcast-0',
  title: '8月キャンペーンのお知らせ',
  messageType: 'image',
  messageContent: '8月キャンペーンのお知らせの本文です。',
  targetType: 'all',
  targetTagId: null,
  status: 'scheduled',
  scheduledAt: '2026-09-08T01:00:00.000Z',
  sentAt: null,
  totalCount: 0,
  successCount: 0,
  lineAccountId: 'visual-qa-account',
  version: 1,
  createdAt: '2026-08-16T00:00:00Z',
}

describe('broadcasts/reserved の対象未指定', () => {
  it('id なしでは取らず予定への戻りを出す', async () => {
    render(<Page />)
    await flush()
    expect(apiMocks.get).not.toHaveBeenCalled()
    expect(await screen.findByText('予約した配信が指定されていません')).toBeTruthy()
    expect(screen.getByRole('link', { name: '配信予定へ戻る' }).getAttribute('href')).toBe('/broadcasts')
  })

  it('id ありでは予約内容が出る', async () => {
    params.id = 'broadcast-0'
    apiMocks.get.mockResolvedValue({ success: true, data: broadcast })
    render(<Page />)
    await flush()
    expect(await screen.findByText('8月キャンペーンのお知らせ')).toBeTruthy()
  })
})
