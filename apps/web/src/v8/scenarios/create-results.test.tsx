// @vitest-environment happy-dom
/*
 * ★V8 シナリオを作る①（create.tsx・dnzqC）と配信結果（results.tsx・X4STXS）の動きの試験。
 * BEHAVIOR.md の主な動きを守る：
 * - 作る①：はじめは「時刻で指定」を選び、見本も方式に合わせて切り替わる。既存の下書きは保存済みの方式。
 *   閲覧のみには保存の操作を置かず帯を出す。「この方式で保存する」で作って1通目へ進む。
 * - 配信結果：購読の状態の札（途中・送れずに止まった・読み終えた）と「何通目まで」。
 *   「…」は配信中・止まっている行だけ、閲覧のみには置かない。配信失敗の行だけ「失敗を再送」。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

let search = ''
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
let role = 'owner'
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role }
})

const scenario = {
  id: 'sc-1', name: '新規登録7日間フォロー', description: null, triggerType: 'friend_add', triggerTagId: null,
  isActive: true, deliveryMode: 'elapsed', allowConcurrent: true, displayOrder: 0, folderId: null,
  lineAccountId: 'account-a', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  steps: [
    { id: 'st-1', scenarioId: 'sc-1', stepOrder: 1, delayMinutes: 0, offsetDays: 0, deliveryTime: '10:00' },
    { id: 'st-2', scenarioId: 'sc-1', stepOrder: 2, delayMinutes: 0, offsetDays: 1, deliveryTime: '20:00' },
  ],
}
const stats = { enrolledTotal: 10, activeNow: 3, completed: 5, paused: 1, steps: [{ stepOrder: 1, reachedCount: 10, reachRate: 1 }, { stepOrder: 2, reachedCount: 8, reachRate: 0.8 }] }
const metric = (value: number | null) => ({ value, state: value === null ? 'unavailable' : 'available', reason: null })
const sub = (id: string, friendName: string, status: string, currentStepOrder: number, pauseReason: string | null = null) => ({
  id, friendId: `f-${id}`, friendName, status, currentStepOrder, startedAt: '2026-09-01T00:00:00.000Z',
  nextDeliveryAt: status === 'active' ? '2026-10-04T01:00:00.000Z' : null, pauseReason, updatedAt: '2026-09-01T00:00:00.000Z',
})
const runs = {
  summary: { active: 2, paused: 2, completed: 5, delivering: 0 },
  subscriptions: [
    sub('s1', '高橋 直人', 'active', 3),
    sub('s2', '中村 彩', 'paused', 2, 'delivery_failed'),
    sub('s3', '山田 花子', 'paused', 1, 'manual'),
    sub('s4', 'Kyohei Yamamoto', 'completed', 4),
  ],
  pagination: { total: 4, limit: 50, cursor: '', nextCursor: null },
  testSends: [], quota: { limit: null, used: null, remaining: null, state: 'unavailable', reason: null, asOf: '' },
  concurrentBroadcasts: [], scenarioClickTotal: 0,
  steps: [
    { id: 'st-1', stepOrder: 1, delivered: 10, opened: metric(null), clicked: metric(4), failed: metric(1) },
    { id: 'st-2', stepOrder: 2, delivered: 8, opened: metric(null), clicked: metric(null), failed: metric(0) },
  ],
}

const create = vi.fn()
vi.mock('@/components/scenarios/scenario-reference-data', () => ({
  scenarioReferenceData: {
    scenario: () => Promise.resolve({ success: true, data: scenario }),
    stats: () => Promise.resolve({ success: true, data: stats }),
    invalidateScenario: () => {},
  },
}))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    api: {
      ...api,
      folders: { ...api.folders, list: () => Promise.resolve({ success: true, data: [] }) },
      scenarios: {
        ...api.scenarios,
        create: (...args: unknown[]) => create(...args),
        runs: () => Promise.resolve({ success: true, data: runs }),
      },
    },
  }
})

import ScenarioCreateV8 from './create'
import ScenarioResultsV8 from './results'

beforeEach(() => {
  role = 'owner'
  search = ''
  push.mockReset()
  create.mockReset()
  document.documentElement.dataset.theme = 'v8'
})
afterEach(() => cleanup())

describe('作る①（dnzqC）', () => {
  test('はじめは「時刻で指定」を選び、見本は方式を替えると切り替わる', async () => {
    render(<ScenarioCreateV8 />)
    const absolute = screen.getByRole('radio', { name: /時刻で指定/ }) as HTMLInputElement
    expect(absolute.checked).toBe(true)
    expect(screen.getByText('時刻で指定は、2人とも同じ時刻に届きます')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /経過時間で指定/ }))
    expect(screen.getByText(/経過時間で指定は、始めた時刻が2時間遅い分/)).toBeTruthy()
    expect(screen.getByText('1通目 4/1 17:00')).toBeTruthy()
  })

  test('既存の下書きは保存済みの方式を選び、下書きの帯を出す', async () => {
    search = 'id=sc-1'
    render(<ScenarioCreateV8 />)
    await screen.findByText('「新規登録7日間フォロー」の下書きを作りました。続けて配信方式を選んでください。')
    expect((screen.getByRole('radio', { name: /経過時間で指定/ }) as HTMLInputElement).checked).toBe(true)
  })

  test('この方式で保存する：名前と選んだ方式で作り、1通目へ進む', async () => {
    create.mockResolvedValue({ success: true, data: { id: 'new-1' } })
    render(<ScenarioCreateV8 />)
    fireEvent.change(screen.getByRole('textbox', { name: 'シナリオ名' }), { target: { value: '春のフォロー' } })
    fireEvent.click(screen.getByRole('button', { name: /この方式で保存する/ }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/scenarios/first-step?id=new-1'))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: '春のフォロー', deliveryMode: 'absolute_time' }))
  })

  test('閲覧のみには保存の操作を置かず、帯を出す', () => {
    role = 'staff'
    render(<ScenarioCreateV8 />)
    expect(screen.queryByRole('button', { name: /この方式で保存する/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /あとで決める/ })).toBeNull()
    expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy()
  })
})

describe('配信結果（X4STXS）', () => {
  test('状態の札・何通目まで・次に届く', async () => {
    search = 'id=sc-1'
    render(<ScenarioResultsV8 />)
    await screen.findByText('高橋 直人')
    expect(screen.getByText('送れずに止まった')).toBeTruthy()
    expect(screen.getByText('止まっている')).toBeTruthy()
    expect(screen.getAllByText('読み終えた').length).toBeGreaterThan(0)
    expect(screen.getByText('3通目まで')).toBeTruthy()
    expect(screen.getAllByText('—（止めている）').length).toBe(2)
    expect(screen.getByText('届いた率 100.0%・開いた —・押した 4人')).toBeTruthy()
  })

  test('「…」は配信中・止まっている行だけ。配信失敗の行だけ「失敗を再送」', async () => {
    search = 'id=sc-1'
    render(<ScenarioResultsV8 />)
    await screen.findByText('高橋 直人')
    expect(screen.getByRole('button', { name: '高橋 直人のその他の操作' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Kyohei Yamamotoのその他の操作' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '中村 彩のその他の操作' }))
    expect(await screen.findByRole('menuitem', { name: '失敗を再送' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '山田 花子のその他の操作' }))
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: '失敗を再送' })).toBeNull())
  })

  test('閲覧のみには行の「…」を置かない（予定を見るは出す）', async () => {
    role = 'staff'
    search = 'id=sc-1'
    render(<ScenarioResultsV8 />)
    await screen.findByText('高橋 直人')
    expect(screen.queryByRole('button', { name: /のその他の操作$/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /予定を見る/ }).length).toBeGreaterThan(0)
  })
})
