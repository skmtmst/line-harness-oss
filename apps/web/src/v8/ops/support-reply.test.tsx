// @vitest-environment happy-dom
/*
 * 監査 WEB217/218/219：運営のお問い合わせ。
 * - 217：「送って解決にする」は解決へ進めることを口へ伝える
 * - 218：50件ちょうど返ったら「続きを読み込む」で足せる
 * - 219：優先度を変えても、書きかけの返信をサーバーの下書きで置き換えない
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {} }),
  usePathname: () => '/ops/support',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

const net = vi.hoisted(() => ({ tickets: vi.fn(), reply: vi.fn(), update: vi.fn(), ticket: vi.fn() }))
const ticket = vi.hoisted(() => (i: number) => ({
  id: `t${i}`, ticketNo: i, ticketLabel: `#${i}`, tenantId: 'ten', tenantName: '契約先A', tenantPlanKey: null, tenantPlanStatus: 'active',
  tenantStatus: 'active', staffId: null, staffName: '担当', staffRole: null, staffEmailRegistered: true, kind: 'usage', kindLabel: '使い方',
  subject: `件名${i}`, subjectAuto: false, body: '本文', attachments: [], stage: 'new', stageLabel: '新規', priority: 'medium',
  priorityLabel: '中', channel: 'admin', channelLabel: '管理画面', assigneeStaffId: null, replyCount: 0, firstRepliedAt: null,
  lastMessageAt: '2026-10-01T00:00:00Z', resolvedAt: null, closedAt: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      ops: {
        ...actual.api.ops,
        support: {
          ...actual.api.ops.support,
          summary: async () => ({ success: true, data: { byStage: { all: 51, new: 51, in_progress: 0, waiting: 0, resolved: 0, closed: 0 }, kpis: { untouched: 0, untouchedFromLine: 0, avgFirstReplyMinutes: null, prevAvgFirstReplyMinutes: null, resolutionRate: null, prevResolutionRate: null, avgResolutionMinutes: null, prevAvgResolutionMinutes: null } } }),
          tickets: (...args: unknown[]) => net.tickets(...args),
          ticket: (...args: unknown[]) => net.ticket(...args),
          reply: (...args: unknown[]) => net.reply(...args),
          update: (...args: unknown[]) => net.update(...args),
        },
        knowledge: { ...actual.api.ops.knowledge },
      },
    },
  }
})
vi.mock('./use-ops-read-only', () => ({ useOpsReadOnly: () => false }))

import OpsSupportV8 from './support'

beforeEach(() => {
  net.tickets.mockImplementation(async (params: { offset?: number }) => ({ success: true, data: (params.offset ?? 0) === 0 ? Array.from({ length: 50 }, (_, i) => ticket(i + 1)) : [ticket(51)] }))
  net.ticket.mockImplementation(async (id: string) => ({ success: true, data: { ticket: { ...ticket(Number(id.slice(1))), id }, messages: [], draft: { body: 'サーバーの下書き', aiGenerated: false, generatedAt: null, updatedAt: '' }, knowledge: null, tenant: { accountCount: 1, staffCount: 1, staffWithLine: 0, pastTickets: 0, pastOpen: 0 }, ai: { available: false } } }))
  net.update.mockResolvedValue({ success: true, data: { ...ticket(1), priority: 'high', priorityLabel: '高' } })
  net.reply.mockResolvedValue({ success: true, data: { ticket: ticket(1), message: {}, mailSent: true, mailSkippedReason: null } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('218：50件ちょうどなら「続きを読み込む」で51件目を足す', async () => {
  render(<OpsSupportV8 />)
  const more = await screen.findByRole('button', { name: '続きを読み込む' })
  await act(async () => { more.click() })
  await waitFor(() => expect(screen.getByText('件名51')).toBeTruthy())
  expect(net.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }))
})

test('219：優先度を変えても書きかけの返信を残す・217：送ると解決へ進める', async () => {
  render(<OpsSupportV8 />)
  const box = await screen.findByLabelText('返信') as HTMLTextAreaElement
  await waitFor(() => expect(box.value).toBe('サーバーの下書き'))
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, '書きかけの返事')
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { screen.getByRole('button', { name: /優先度を変える/ }).click() })
  const high = [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent?.includes('高')) as HTMLElement
  await act(async () => { (high.querySelector('button') ?? high).click() })
  await waitFor(() => expect(net.update).toHaveBeenCalled())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect((screen.getByLabelText('返信') as HTMLTextAreaElement).value).toBe('書きかけの返事')
  const open = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '返信する') as HTMLButtonElement
  await act(async () => { open.click() })
  const send = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('送って解決にする')) as HTMLButtonElement
  await act(async () => { send.click() })
  await waitFor(() => expect(net.reply).toHaveBeenCalledWith('t1', expect.objectContaining({ body: '書きかけの返事', nextStage: 'resolved' })))
})
