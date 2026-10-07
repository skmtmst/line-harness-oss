// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const update = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', accounts: [] }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner' }))
vi.mock('./shell', async importOriginal => {
  const actual = await importOriginal<typeof import('./shell')>()
  const deliverySummary = { total: 0, failed: 0, pending: 0, lastResult: null, canRetry: false }
  return { ...actual, useWebhookOverview: () => ({
    incoming: [{ id: 'in-1', name: '申込フォーム', hasSecret: true, isActive: true }], incomingStatus: 'ready',
    outgoing: [{ id: 'out-1', name: '予約台帳', url: 'https://example.test', hasSecret: true, isActive: true, eventTypes: ['booking_created'], deliverySummary }], outgoingStatus: 'ready',
    loadedAccountId: 'a', reload: async () => {}, summary: null,
  }) }
})
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) },
    webhooks: { ...actual.api.webhooks,
      incoming: { ...actual.api.webhooks.incoming, update,
        detail: async () => ({ success: true, data: { id: 'in-1', name: '申込フォーム', version: 1, identityMatching: { methods: [] }, actions: [], actionExecution: { state: 'not_configured', reason: null }, latestSample: null, templateFields: [], pendingUnmatched: 0 } }),
        unmatched: async () => ({ success: true, data: [] }),
      },
      outgoing: { ...actual.api.webhooks.outgoing, update },
    },
  } }
})
import Incoming from './incoming'
import Outgoing from './outgoing'
afterEach(cleanup)
it.each(['incoming', 'outgoing'] as const)('%sの合言葉の保存中は×・キャンセル・Escを止める', async kind => {
  let resolve!: (value: unknown) => void
  update.mockReset().mockImplementation(() => new Promise(r => { resolve = r }))
  render(kind === 'incoming' ? <Incoming /> : <Outgoing />)
  await act(async () => {})
  if (kind === 'incoming') fireEvent.click(screen.getByRole('button', { name: '合言葉を更新する' }))
  else {
    fireEvent.click(screen.getByRole('button', { name: '「予約台帳」の設定' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '鍵を作り直す' }))
  }
  fireEvent.change(screen.getByPlaceholderText('ランダムな英数字32文字以上'), { target: { value: 'x'.repeat(40) } })
  fireEvent.click(screen.getByRole('button', { name: '保存する', exact: true }))
  expect(update).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '閉じる' }).hasAttribute('disabled')).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => resolve({ success: true }))
})
