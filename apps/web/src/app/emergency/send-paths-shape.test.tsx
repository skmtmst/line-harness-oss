// @vitest-environment happy-dom
/*
 * 全ルート監査 A1（2026-09-25）: `/emergency?tab=control` が
 * `capabilities is not iterable` で落ちていた。原因は台帳の口が
 * 形違い（`{items,…}`）で返っていたこと。画面側は配列でない応答を
 * 取得失敗として出し、落とさない。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  sendPaths: vi.fn(),
  history: vi.fn(),
  alerts: vi.fn(),
  accounts: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tab=control'),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/emergency',
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/components/shared/page-header', () => ({ default: () => null }))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {
    status?: number
    code?: string | null
  },
  api: {
    operations: {
      preview: (...args: unknown[]) => apiMocks.preview(...args),
      sendPaths: (...args: unknown[]) => apiMocks.sendPaths(...args),
      history: (...args: unknown[]) => apiMocks.history(...args),
      alerts: (...args: unknown[]) => apiMocks.alerts(...args),
      restorePreview: async () => ({ success: false, error: 'x' }),
      acknowledgeAlert: vi.fn(),
      retryAlertNotifications: vi.fn(),
      stepUp: vi.fn(),
      stop: vi.fn(),
      restore: vi.fn(),
      health: vi.fn(),
      runHealth: vi.fn(),
    },
    health: { accounts: (...args: unknown[]) => apiMocks.accounts(...args) },
  },
}))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  apiMocks.preview.mockResolvedValue({ success: false, error: '取れません' })
  apiMocks.history.mockResolvedValue({ success: true, data: { items: [] } })
  apiMocks.alerts.mockResolvedValue({ success: true, data: [] })
  apiMocks.accounts.mockResolvedValue({ success: true, data: [] })
})
afterEach(cleanup)

describe('emergency 台帳の形違い', () => {
  it('capabilities が配列でなくても落ちず取得失敗を出す', async () => {
    apiMocks.sendPaths.mockResolvedValue({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } })
    render(<Page />)
    await flush()
    expect(await screen.findByText('送信経路の台帳を取得できませんでした。停止の届く範囲が確認できないため、経路の網羅は保証できません。時間をおいて読み直してください。')).toBeTruthy()
  })

  it('本物の形なら経路の一覧を出す', async () => {
    apiMocks.sendPaths.mockResolvedValue({
      success: true,
      data: {
        evaluatedAt: '2026-09-07T10:00:00+09:00',
        capabilities: ['broadcast_dispatch'],
        problems: [],
        paths: [
          { id: 'broadcast-send', label: '一斉配信', kind: 'scheduled', capability: 'broadcast_dispatch', state: 'running', excludedReason: null, note: null },
        ],
      },
    })
    render(<Page />)
    await flush()
    expect(await screen.findByText('停止が届く送信経路')).toBeTruthy()
  })
})
