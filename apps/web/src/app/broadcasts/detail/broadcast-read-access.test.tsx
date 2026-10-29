// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'

const fixture = vi.hoisted(() => ({ me: vi.fn(), recipients: vi.fn(), writes: vi.fn() }))
vi.mock('next/navigation', async () => ({
  ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useSearchParams: () => new URLSearchParams('id=read-broadcast'),
  usePathname: () => '/broadcasts/detail',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'read-account', loading: false }),
}))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    staff: { ...actual.api.staff, me: fixture.me },
    broadcasts: { ...actual.api.broadcasts,
      get: vi.fn(async () => ({ success: true, data: {
        id: 'read-broadcast', title: '集計確認用の配信', lineAccountId: 'read-account',
        status: 'draft', messageType: 'text', messageContent: '保存済みの本文',
        targetType: 'all', totalCount: 1, successCount: 0, version: 3,
      } })),
      getInsight: vi.fn(async () => ({ success: true, data: null })),
      recipients: fixture.recipients,
      testSend: fixture.writes, delete: fixture.writes, retryFailed: fixture.writes,
      approval: { ...actual.api.broadcasts.approval, get: vi.fn(async () => ({ success: false })) },
    },
  } }
})

import BroadcastDetailPage from './page'
import { forgetStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { querySupplementaryPageAction } from '@/test-utils/page-action'

const csvBlobs: Blob[] = []
const csv = () => screen.queryByRole('button', { name: 'CSVで書き出す' }) ?? querySupplementaryPageAction('CSVで書き出す')
const staff = (extra: Partial<StaffMember> = {}) => ({ role: 'staff', permissionKeys: [],
  permissionViewKeys: ['/broadcasts', 'broadcast.result.export'], ...extra })

beforeEach(() => {
  forgetStaffIdentity()
  forgetSessionSnapshot()
  vi.clearAllMocks()
  csvBlobs.length = 0
  document.documentElement.dataset.theme = 'v8'
  window.history.replaceState({}, '', '/broadcasts/detail?id=read-broadcast')
  fixture.me.mockResolvedValue({ success: true, data: staff() })
  fixture.recipients.mockResolvedValue({ success: true, data: {
    rows: [{ friendId: 'read-friend', displayName: '確認用の宛先', group: 'delivered', label: 'LINEが受け付けました' }],
    summary: { sent: 1, failedTemporary: 0, failedPermanent: 0, pending: 0, total: 1, retryableCount: 0 },
    aggregateOnly: false, aggregateReason: null, legacySuccessCount: null,
  }, pagination: { nextCursor: null } })
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { csvBlobs.push(blob as Blob); return 'blob:read-csv' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network request') }))
})
afterEach(() => {
  cleanup()
  forgetStaffIdentity()
  forgetSessionSnapshot()
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('配信詳細の読む操作とローカルCSV', () => {
  it.each(['owner', 'staff'])('read代理でも %s の既存の出力鍵による集計CSV・宛先・絞り込みを保つ', async role => {
    fixture.me.mockResolvedValue({ success: true, data: staff({ role: role as StaffMember['role'] }) })
    rememberSessionSnapshot({ impersonation: { id: 'read-proxy', tenantId: 'tenant', mode: 'read', piiRevealed: false, startedAt: '' }, unfamiliarAt: null, stepUpMethod: 'none' })
    render(<BroadcastDetailPage />)
    await waitFor(() => expect(csv()).toBeTruthy())
    fireEvent.click(csv()!)
    expect(csvBlobs).toHaveLength(1)
    expect(await csvBlobs[0].text()).toContain('集計確認用の配信')
    fireEvent.click(screen.getByRole('tab', { name: '宛先 1' }))
    await waitFor(() => expect(screen.getByText('確認用の宛先')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '宛先の絞り込み' }))
    fireEvent.click(within(screen.getByRole('option', { name: 'LINEが受け付けました' })).getByRole('button'))
    await waitFor(() => expect(fixture.recipients).toHaveBeenLastCalledWith('read-broadcast', { result: 'delivered', limit: 50 }))
    expect(fixture.writes).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    staff({ permissionViewKeys: ['/broadcasts'] }),
    staff({ role: 'viewer' }),
    staff({ role: 'owner', readOnly: true }),
    staff({ role: 'owner', roleBundle: 'view_only' }),
  ])('CSVの鍵を増やさない: %j', async identity => {
    fixture.me.mockResolvedValue({ success: true, data: identity })
    render(<BroadcastDetailPage />)
    await waitFor(() => expect(screen.getByText('まだ送っていません')).toBeTruthy())
    expect(csv()).toBeFalsy()
    expect(csvBlobs).toHaveLength(0)
    expect(fixture.writes).not.toHaveBeenCalled()
  })

  it('本人未知はCSV0、本人と出力鍵が確定すると同じ画面で集計を書き出せる', async () => {
    let answer!: (value: unknown) => void
    fixture.me.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    render(<BroadcastDetailPage />)
    await waitFor(() => expect(screen.getByText('まだ送っていません')).toBeTruthy())
    expect(csv()).toBeFalsy()
    expect(csvBlobs).toHaveLength(0)
    await act(async () => { answer({ success: true, data: staff() }) })
    fireEvent.click(csv()!)
    expect(csvBlobs).toHaveLength(1)
    expect(fixture.writes).not.toHaveBeenCalled()
  })
})
