// @vitest-environment happy-dom
/*
 * V8 サクサク感（お知らせ）：顧客タブの読み込み中は表の形の骨組みが出て
 * 「読み込み中」の文字は無い。
 */
import React, { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { EcNotificationSetting } from '@/lib/api'

const fixture = vi.hoisted(() => ({
  tab: 'customer',
  settings: vi.fn(),
  overview: vi.fn(),
  operatorList: vi.fn(),
  definitions: vi.fn(),
  metrics: vi.fn(),
  quota: vi.fn(),
  sendCounts: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/line-notifications',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/layout/merged-tabs', () => ({
  default: () => null,
  useMergedTab: () => fixture.tab,
}))
vi.mock('@/v8/settings/line-notifications/runs-tab', () => ({ default: () => null }))
vi.mock('@/v8/settings/line-notifications/operator-tab', () => ({ default: () => null }))

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number) {
      super(`API error ${status}`)
      this.status = status
    }
  }
  return {
    ApiError,
    fetchApi: fixture.quota,
    api: {
      ecCommerce: {
        settings: fixture.settings,
        overview: fixture.overview,
        testSend: vi.fn(),
      },
      accountSettings: { getTestRecipients: vi.fn() },
      // ★V8 の画面は役割（/api/staff/me）で変える操作を出し分ける。
      staff: { me: vi.fn(async () => ({ success: true, data: { role: 'owner' } })) },
      lineNotifications: {
        operatorRules: { list: fixture.operatorList },
        definitions: fixture.definitions,
        metrics: fixture.metrics,
        sendCounts: fixture.sendCounts,
        updateDraft: vi.fn(),
        publishDefinition: vi.fn(),
        stopDefinition: vi.fn(),
        createDefinition: vi.fn(),
      },
    },
  }
})

vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => null, useStaffRole: () => 'owner', canManageRole: (role: string) => role === 'owner' || role === 'admin' }))

import LineNotificationsPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  fixture.tab = 'customer'
  fixture.operatorList.mockResolvedValue({ success: true, data: { summary: { total: 0 }, items: [] } })
  fixture.settings.mockResolvedValue({ success: true, data: [] })
  fixture.overview.mockResolvedValue({ success: true, data: { last24h: 0, failed: 0, byType: [] } })
  fixture.metrics.mockResolvedValue({ success: true, data: { items: [] } })
  fixture.sendCounts.mockResolvedValue({ success: true, data: { items: [] } })
  fixture.quota.mockResolvedValue({
    success: true,
    data: { quota: { state: 'available', total: 500, used: 10, remaining: 490, asOf: '2026-09-15T00:00:00Z' } },
  })
  vi.stubGlobal('React', React)
  // ★V8 の画面は白い板の中に「設定の中のメニュー」を置き、手元の役割（localStorage）を読む。
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
})

/** 偽の時計を 50ms ずつ進めながら、満たすまで（最大2秒ぶん）確かめる。本物の時間は待たない。 */
async function until(check: () => void) {
  for (let i = 0; i < 40; i += 1) {
    try { check(); return } catch { /* もう少し進める */ }
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
  }
  check()
}

it('顧客タブの読み込み中は骨組みが出て「読み込み中」の文字は無い', async () => {
  document.documentElement.dataset.theme = 'v8'
  // 顧客の定義だけ返さず、読み込み中のままにする。
  fixture.definitions.mockReturnValue(new Promise(() => {}))
  // 待ちは偽の時計で進める（本物の時間を待たない）。骨組みの 0.3 秒は読み始めから数えるので、描く前に替える。
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  const { container } = render(<LineNotificationsPage />)
  await until(() => {
    expect(container.querySelector('[aria-label="顧客へのお知らせを読み込んでいます"]')).not.toBeNull()
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(600) })
  await until(() => {
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0)
  })
  expect(screen.queryByText(/読み込んでいます/)).toBeNull()
  delete document.documentElement.dataset.theme
})

it.each([
  ['customer', 'これは「お知らせ」であって「売り込みの配信」ではありません。お客さまが配信を止めていても、取引に必要な連絡は届きます。'],
  ['operator', 'この画面の宛先はお店の人だけです。お客様へ送るものは「顧客へのお知らせ」で設定します。'],
  ['failures', '送れなかった理由や再試行の予定を確かめます。ブロックなどの対象外と、再試行が必要な失敗を分けて確認してください。'],
])('%sの常設説明は帯に出さず題の「？」1つで開ける', async (tab, explanation) => {
  fixture.tab = tab
  render(<LineNotificationsPage />)
  expect(screen.queryByRole('button', { name: 'LINE通知の説明' })).toBeNull()
  expect(screen.queryByText(explanation)).toBeNull()
  const help = screen.getByRole('button', { name: 'この画面の説明' })
  await act(async () => { help.click() })
  const note = document.getElementById(help.getAttribute('aria-describedby') ?? '')!
  expect(note.getAttribute('role')).toBe('note')
  expect(within(note).getByText(explanation)).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByText(explanation)).toBeNull()
})

it('未設定の絞り込み件数と行の状態が一致し、任意の前後文が空でも出す・停止の状態を保つ', async () => {
  const setting = (eventType: string, title: string | null, isEnabled: boolean): EcNotificationSetting => ({
    eventType, title, isEnabled, label: eventType, introText: '', outroText: '',
    category: 'order', buttonLabel: '', buttonUrl: '', imageUrl: '', displayOrder: 0,
    fixedFields: [], fixedPreview: '', updatedAt: '2026-10-29T00:00:00Z',
  })
  fixture.settings.mockResolvedValue({ success: true, data: [
    setting('ec.order.confirmed', '注文を受け付けました', true),
    setting('ec.order.shipped', '発送しました', false),
    setting('ec.order.cancelled', '　', true),
    setting('ec.order.payment_received', null, false),
  ] })
  fixture.definitions.mockResolvedValue({ success: true, data: [] })
  render(<LineNotificationsPage />)
  const filters = screen.getByRole('group', { name: 'お知らせの絞り込み' })
  const incomplete = await within(filters).findByRole('button', { name: '文面が未設定 2' })
  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('row')).toHaveLength(5)
  const warnings = within(table).getAllByTitle('要確認：文面が未設定')
  expect(warnings).toHaveLength(2)
  for (const warning of warnings) expect(warning.getAttribute('aria-description')).toBe('要確認：文面が未設定')
  expect(table.querySelectorAll('[data-tone="caution"][aria-hidden="true"]')).toHaveLength(2)
  expect(within(table).getAllByText('出している')).toHaveLength(2)
  expect(within(table).getAllByText('停止中')).toHaveLength(2)
  fireEvent.click(incomplete)
  expect(within(table).getAllByRole('row')).toHaveLength(3)
  expect(within(table).getAllByTitle('要確認：文面が未設定')).toHaveLength(2)
  expect(within(table).getAllByText('出している')).toHaveLength(1)
  expect(within(table).getAllByText('停止中')).toHaveLength(1)
  fireEvent.click(within(filters).getByRole('button', { name: 'すべて 4' }))
  expect(within(table).getAllByRole('row')).toHaveLength(5)
})
