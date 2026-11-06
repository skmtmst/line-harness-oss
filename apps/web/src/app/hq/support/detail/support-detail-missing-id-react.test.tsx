// @vitest-environment happy-dom
/*
 * /hq/support/detail を id なしで開いても「読み込んでいます…」のまま待たせない。
 * id が無いと分かったら案内と一覧へ戻る口を出し、詳細は取りに行かない。id があるときだけ取りに行く。
 */
import { setImmediate } from 'node:timers'
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ query: '', detail: vi.fn(), list: vi.fn(), context: vi.fn(), tenant: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(fixture.query),
  usePathname: () => '/hq/support/detail',
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/shell/page-chrome', async (original) => ({
  ...await original<typeof import('@/components/shell/page-chrome')>(), usePageTitle: () => undefined, usePageCrumbs: () => undefined,
}))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      hqSupport: { ...actual.api.hqSupport, detail: fixture.detail, list: fixture.list, context: fixture.context },
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { id: 's', email: 'a@example.com', name: '担当', role: 'staff' } }) },
      tenants: { ...actual.api.tenants, me: fixture.tenant },
    },
  }
})

import * as staffIdentity from '@/lib/staff-role'
import HqSupportDetailV8 from '@/v8/hq/support-detail'

beforeEach(() => {
  vi.clearAllMocks()
  fixture.query = ''
  fixture.context.mockResolvedValue({ success: true, data: { accounts: [] } })
  fixture.tenant.mockResolvedValue({ success: true, data: { name: '本部' } })
  fixture.list.mockResolvedValue({ success: true, data: [] })
  fixture.detail.mockResolvedValue({ success: true, data: {
    id: 'req-a', subject: '請求書について', status: 'open', kind: 'question', kindLabel: null, ticketLabel: '#req-a', lineAccountId: null,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', stageLabel: '', messages: [], canFollowUp: true,
  } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('問い合わせ詳細の id なし', () => {
  it.each(['', 'id=', 'id=%20%20'])('対象が未指定のときは案内と一覧へのリンクを出し、対象APIを呼ばない（%s）', async (query) => {
    fixture.query = query
    const staff = vi.spyOn(staffIdentity, 'loadStaffIdentity')
    render(<HqSupportDetailV8 />)
    await screen.findByText('開くお問い合わせが指定されていません')
    expect(screen.getByRole('link', { name: '問い合わせの一覧へ戻る' }).getAttribute('href')).toBe('/hq/support')
    await act(() => new Promise<void>(resolve => setImmediate(resolve)))
    expect(fixture.detail).not.toHaveBeenCalled()
    expect(fixture.list).not.toHaveBeenCalled()
    expect(fixture.context).not.toHaveBeenCalled()
    expect(fixture.tenant).not.toHaveBeenCalled()
    expect(staff).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: '送信者' })).toBeNull()
    expect(screen.queryByText('これまでの問い合わせ')).toBeNull()
  })

  it('id があるときだけ、その id の詳細を1回だけ取りに行く', async () => {
    fixture.query = 'id=req-a'
    const staff = vi.spyOn(staffIdentity, 'loadStaffIdentity')
    render(<HqSupportDetailV8 />)
    await screen.findAllByText('請求書について')
    await act(() => new Promise<void>(resolve => setImmediate(resolve)))
    expect(staff.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(fixture.detail).toHaveBeenCalledTimes(1)
    expect(fixture.detail).toHaveBeenCalledWith('req-a')
    expect(fixture.list).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('開くお問い合わせが指定されていません')).toBeNull()
  })
})
