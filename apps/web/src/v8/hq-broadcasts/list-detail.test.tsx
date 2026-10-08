// @vitest-environment happy-dom
/*
 * 統括の一括配信の一覧（U4Eep0）と送ったあとの詳細（M2tJM）を絵に合わせた所の動き。
 * 一覧：並び順（新しい順／古い順）・数の帯の平均の開封率（数えていない店があれば「—」）。
 * 詳細：送るまでの段の帯（予約しない配信は「予約済み」を省く・分かれ道の札）・配信した設定の「送り方」。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hq = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(),
  folders: vi.fn(async () => ({ success: true, data: [] })),
  approvalCandidates: vi.fn(async () => ({ success: true, data: [] })),
  approval: vi.fn(),
}))
const params = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('@/lib/hq-broadcasts-api', () => ({ hqBroadcastsApi: hq }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => params.value }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))

import HqBroadcastList from './list'
import HqBroadcastDetail, { deliveryWayText } from './detail'

const target = (accountId: string, status: string, success: number, opened: number | null) => ({
  accountId, accountName: accountId, audienceCount: success, remaining: 1000, connected: true, paused: false, blockedReasons: [], excluded: false,
  broadcastId: `b-${accountId}`, failureReasons: [], status, version: 1, successCount: success, totalCount: success,
  openedCount: opened, clickedCount: opened == null ? null : 0, reactionCount: 0, retryableCount: 0, stopped: false,
})
const run = (id: string, title: string, targets: ReturnType<typeof target>[], extra: Record<string, unknown> = {}) => ({
  id, title, status: 'scheduled', version: 1, scheduledAt: null,
  input: { title, messageType: 'text', messageContent: '本文', audience: { kind: 'all' }, accountIds: [], accountTagIds: [], excludedAccountIds: [], requestId: id, scheduledAt: null },
  targets, ...extra,
})

beforeEach(() => {
  params.value = new URLSearchParams()
})
afterEach(() => cleanup())

describe('統括の一括配信の一覧（U4Eep0）', () => {
  it('新しい順（口の順）と古い順を入れ替える', async () => {
    hq.list.mockResolvedValue({ data: [run('r2', '新しい配信', [target('a', 'sent', 100, 50)]), run('r1', '古い配信', [target('a', 'sent', 100, 50)])] })
    render(<HqBroadcastList />)
    await screen.findByText('新しい配信')
    const titles = () => screen.getAllByRole('link').map((el) => el.textContent).filter((text) => text?.endsWith('配信'))
    expect(titles()).toEqual(['新しい配信', '古い配信'])
    fireEvent.click(screen.getByRole('button', { name: /並び順：新しい順/ }))
    expect(titles()).toEqual(['古い配信', '新しい配信'])
    expect(screen.getByRole('button', { name: /並び順：古い順/ })).toBeTruthy()
  })

  it('平均の開封率は送った配信の開いた人÷届いた人。数えていない店があれば「—」', async () => {
    hq.list.mockResolvedValue({ data: [run('r1', 'A', [target('a', 'sent', 100, 50), target('b', 'sent', 100, 20)])] })
    render(<HqBroadcastList />)
    await screen.findByText('A')
    expect(screen.getByText('平均の開封率')).toBeTruthy()
    expect(screen.getByText('35')).toBeTruthy()
    cleanup()
    hq.list.mockResolvedValue({ data: [run('r1', 'B', [target('a', 'sent', 100, 50), target('b', 'sent', 100, null)])] })
    render(<HqBroadcastList />)
    await screen.findByText('B')
    expect(screen.getByText('まだ数えていません')).toBeTruthy()
  })
})

describe('統括の一括配信の詳細（M2tJM）', () => {
  it('送ったあとは 下書き・送信中・送信済み の帯（予約しない配信は予約済みを省く）と、一部の店が失敗した札', async () => {
    params.value = new URLSearchParams('id=r1')
    hq.get.mockResolvedValue({ data: run('r1', '送った配信', [target('a', 'sent', 100, 50), target('b', 'failed', 0, 0)]) })
    render(<HqBroadcastDetail />)
    const rail = await screen.findByRole('list', { name: '配信の状態' })
    const labels = within(rail).getAllByRole('listitem').map((item) => item.textContent)
    expect(labels).toEqual(['下書き', '送信中', '送信済み', '失敗あり'])
    expect(within(rail).getByText('送信済み').getAttribute('aria-current')).toBe('step')
    await waitFor(() => expect(screen.getByText('すぐに全員へ（分けて送らない）')).toBeTruthy())
  })

  it('予約した配信は予約済みの段を出す', async () => {
    params.value = new URLSearchParams('id=r2')
    hq.get.mockResolvedValue({ data: run('r2', '予約した配信', [target('a', 'scheduled', 0, null)], { scheduledAt: '2026-01-15T02:00:00.000Z' }) })
    render(<HqBroadcastDetail />)
    const rail = await screen.findByRole('list', { name: '配信の状態' })
    expect(within(rail).getByText('予約済み').getAttribute('aria-current')).toBe('step')
  })

  it('送り方：分けて送る分数があればその分数', () => {
    expect(deliveryWayText({ stealthSpreadMinutes: 30 }, true)).toBe('30分かけて分けて送る')
    expect(deliveryWayText({}, false)).toBe('すぐに全員へ')
  })
})
