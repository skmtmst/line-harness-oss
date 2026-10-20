// @vitest-environment happy-dom
/*
 * WEB-117：現役の画面が自分で取るので、入口では二重に取らない。
 * 旧の設定や印が残っていても現役へ固定する。
 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ list: vi.fn(), templates: vi.fn(), commonActions: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/automations',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/use-manual-href', () => ({ useManualHref: () => null }))
vi.mock('@/components/automations/use-automation-permission', () => ({ useCanManageAutomations: () => true }))
vi.mock('@/v8/automations/list', () => ({ default: () => <p>V8 の一覧</p> }))
vi.mock('@/v8/automations/templates', () => ({ default: () => <p>V8 の見本</p> }))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      automations: { ...actual.api.automations, list: calls.list, templates: calls.templates },
      commonActions: { ...actual.api.commonActions, list: calls.commonActions },
    },
  }
})

import AutomationsPage from './page'

beforeEach(() => {
  calls.list.mockReset().mockResolvedValue({ success: true, data: [], summary: null })
  calls.templates.mockReset().mockResolvedValue({ success: true, data: [] })
  calls.commonActions.mockReset().mockResolvedValue({ success: true, data: [] })
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  delete document.documentElement.dataset.theme
})

// 検証環境と同じ「既定が v8」の環境（最初の描画から v8）。
it('V8 の見た目では 管理画面 の画面の一覧・見本・共通アクションを取らない', async () => {
  vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', 'v8')
  document.documentElement.dataset.theme = 'v8'
  const { container } = render(<AutomationsPage />)
  await act(async () => { await Promise.resolve() })
  expect(container.textContent).toContain('V8 の一覧')
  expect(calls.list).not.toHaveBeenCalled()
  expect(calls.templates).not.toHaveBeenCalled()
  expect(calls.commonActions).not.toHaveBeenCalled()
})

it('旧の印が残っていても現役へ固定し、別の一覧を取得しない', async () => {
  vi.stubEnv('NEXT_PUBLIC_ADMIN_THEME', '')
  document.documentElement.dataset.theme = 'v7'
  const { container } = render(<AutomationsPage />)
  await act(async () => { await Promise.resolve() })
  expect(container.textContent).toContain('V8 の一覧')
  expect(calls.list).not.toHaveBeenCalled()
  expect(calls.templates).not.toHaveBeenCalled()
  expect(calls.commonActions).not.toHaveBeenCalled()
})
