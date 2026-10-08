// @vitest-environment happy-dom
/*
 * V8 リマインダの詳細（src/v8/reminders/detail.tsx）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * 一時停止は確かめの窓（RwVo5）を通す・最近の実行は送った物だけ・閲覧のみには押せない操作を置かない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const state = vi.hoisted(() => ({
  role: 'owner' as string,
  tab: '' as string,
  updates: [] as Array<Record<string, unknown>>,
  plannedTotal: 2,
  onlyPlanned: false,
}))

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    React.createElement('a', { href, className }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/reminders/detail',
  useSearchParams: () => new URLSearchParams(`id=reminder-1${state.tab ? `&tab=${state.tab}` : ''}`),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: { id: 'account-a', name: '本店' }, accounts: [], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => state.role }
})

const soon = () => new Date(Date.now() + 3_600_000).toISOString()

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  const run = (id: string, domainStatus: string, friendName: string) => ({
    id, friendId: `f-${id}`, friendName, stepNumber: 1, domainStatus, scheduledAt: soon(), startedAt: null, completedAt: null,
    nextRetryAt: null, attemptCount: 1, lineRequestId: null, lastErrorMessage: null, canRetry: false,
  })
  return {
    ApiError,
    fetchApi: vi.fn(async () => ({ success: true, data: {} })),
    api: {
      reminders: {
        runs: vi.fn(async (_id: string, params?: { status?: string }) => ({
          success: true,
          data: {
            reminder: { id: 'reminder-1', name: '予約前日のご案内', isActive: true, lifecycleStatus: 'published', stopConditions: null, hasPublishedVersion: true },
            summary: { sent: 3, scheduled: 2, stopped: 0, errors: 2, targetCount: 186, nextScheduledAt: soon(), sentThisMonth: 386, scheduledNext7Days: 124 },
            steps: [{ id: 'st1', stepNumber: 1, offsetMinutes: -1440, messageType: 'text', messageContent: '明日のご案内です。', sent: 212, openRate: null, errors: 1 }],
            items: params?.status === 'planned'
              ? [run('p1', 'planned', '佐藤 花子'), run('p2', 'planned', '高橋 美咲')]
              : state.onlyPlanned
                ? [run('r3', 'planned', '予定の人')]
                : [run('r1', 'succeeded', '佐藤 花子'), run('r2', 'permanent_failed', '鈴木 一郎'), run('r3', 'planned', '予定の人')],
            pagination: { total: params?.status === 'planned' ? state.plannedTotal : state.onlyPlanned ? 40 : 2, limit: 100, offset: 0 },
          },
        })),
        get: vi.fn(async () => ({ success: true, data: { id: 'reminder-1', name: '予約前日のご案内', isActive: true, triggerType: 'booking', deliveryMode: 'time', createdAt: '', updatedAt: '2026-09-28T01:00:00Z', steps: [{ id: 'st1', reminderId: 'reminder-1', offsetMinutes: 0, offsetDays: -1, sendAtTime: '18:00', messageType: 'text', messageContent: '', createdAt: '' }] } })),
        update: vi.fn(async (_id: string, body: Record<string, unknown>) => {
          state.updates.push(body)
          return { success: true, data: null }
        }),
        registrants: {
          list: vi.fn(async () => ({
            success: true,
            data: [
              { id: 'e1', friendId: 'f1', friendName: '山田 太郎', targetDate: '2026-10-02T05:00:00Z', status: 'active', reminderVersionId: null, sourceKind: 'form', createdAt: '', updatedAt: '', cancelledAt: null, lockVersion: 1 },
              { id: 'e2', friendId: 'f2', friendName: '鈴木 一郎', targetDate: '2026-10-03T01:00:00Z', status: 'cancelled', reminderVersionId: null, sourceKind: 'form', createdAt: '', updatedAt: '', cancelledAt: '', lockVersion: 1 },
            ],
          })),
        },
      },
    },
  }
})

import ReminderDetailV8Page from './detail'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  state.role = 'owner'
  state.tab = ''
  state.updates = []
  state.plannedTotal = 2
  state.onlyPlanned = false
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  document.documentElement.removeAttribute('data-theme')
})

async function render() {
  await act(async () => { root.render(<ReminderDetailV8Page />) })
  for (let i = 0; i < 4; i += 1) await act(async () => {})
}

const buttons = () => [...document.querySelectorAll('button, a')].map((el) => el.textContent?.trim() ?? '')
const buttonByText = (text: string) =>
  [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === text) as HTMLButtonElement | undefined

describe('V8 リマインダの詳細', () => {
  it('概要（rbAig）：最近の実行は送った・送れなかった物だけ（予定は配信予定タブ）', async () => {
    await render()
    expect(host.querySelector('[data-design-node="rbAig"]')).toBeTruthy()
    const recent = host.querySelector('[aria-label="最近の実行"]')
    expect(recent?.textContent).toContain('佐藤 花子')
    expect(recent?.textContent).toContain('鈴木 一郎')
    expect(recent?.textContent).not.toContain('予定の人')
    expect(host.textContent).toContain('1日前 18:00')
  })

  it('一時停止は確かめの窓（RwVo5）を通し、今後24時間の予定数を言ってから止める', async () => {
    await render()
    await act(async () => { buttonByText('一時停止する')!.click() })
    const dialog = document.querySelector('[data-design-node="RwVo5"]')
    expect(dialog?.textContent).toContain('「予約前日のご案内」を一時停止する')
    expect(dialog?.textContent).toContain('今後24時間で送る予定の 2通 が送られなくなります。')
    expect(state.updates).toHaveLength(0)
    const confirm = [...dialog!.querySelectorAll('button')].find((el) => el.textContent?.trim() === '一時停止する') as HTMLButtonElement
    await act(async () => { confirm.click() })
    await act(async () => {})
    expect(state.updates).toEqual([{ isActive: false }])
    expect(document.querySelector('[data-design-node="RwVo5"]')).toBeNull()
  })

  it('閲覧のみ：一時停止・編集・複製・削除を置かず、書き出しだけ残す', async () => {
    state.role = 'viewer'
    await render()
    expect(buttons()).not.toContain('一時停止する')
    expect(buttons()).not.toContain('編集する')
    const more = [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label')?.includes('その他の操作')) as HTMLButtonElement
    await act(async () => { more.click() })
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())
    expect(items).toEqual(['実行結果をCSVで書き出す'])
  })

  it('登録者（loVfW）：閲覧のみには取り消す・再開するを置かない。管理者には出す', async () => {
    state.tab = 'registrants'
    await render()
    expect(host.querySelector('[data-design-node="loVfW"]')).toBeTruthy()
    expect(buttons()).toContain('取り消す')
    expect(buttons()).toContain('再開する')
    act(() => { root.unmount() })
    root = createRoot(host)
    state.role = 'viewer'
    await render()
    expect(host.textContent).toContain('山田 太郎')
    expect(buttons()).not.toContain('取り消す')
    expect(buttons()).not.toContain('再開する')
  })

  it('WEB084：予定を読み切れていないとき、一時停止の窓で今後24時間の数を言い切らない', async () => {
    state.plannedTotal = 340
    await render()
    await act(async () => { buttonByText('一時停止する')!.click() })
    const dialog = document.querySelector('[data-design-node="RwVo5"]')
    expect(dialog?.textContent).toContain('今後24時間の分は数え切れませんでした')
    expect(dialog?.textContent).not.toContain('今後24時間で送る予定の 2通')
  })

  it('WEB084：先頭が予定ばかりで実行が見えないときは「まだありません」と言わない', async () => {
    state.onlyPlanned = true
    await render()
    const section = host.querySelector('[aria-labelledby="rm-detail-recent"]')
    expect(section?.textContent).toContain('最近の実行をここでは読み切れませんでした')
    expect(section?.textContent).not.toContain('まだ実行した通知はありません')
  })
})
