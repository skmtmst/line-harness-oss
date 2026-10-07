// @vitest-environment happy-dom
/*
 * V8 会員（src/v8/nen-members）の動きの試験。BEHAVIOR.md を守る。
 * V8 のテーマで表示し、ランクを消す窓（移す先を先に選ぶ・版つきの DELETE）・
 * 409 で競合の帯・ライフタイムの「…」から直して保存・閲覧のみで押せないボタンを置かない、を確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const fetchApi = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const push = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, fetchApi }
})
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/nen/members',
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

import { ApiError } from '@/lib/api'
import MembersV8, { type MemberTab } from './members'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SETTINGS: NenRankSettingsData = {
  ranks: [
    { id: 'r-pt', key: 'platinum', name: 'プラチナ', annualThresholdYen: 200000, mileRatePercent: 3, tagId: 't-pt', tagName: '会員ランク：プラチナ', memberCount: 1 },
    { id: 'r-gd', key: 'gold', name: 'ゴールド', annualThresholdYen: 50000, mileRatePercent: 2, tagId: 't-gd', tagName: '会員ランク：ゴールド', memberCount: 3 },
    { id: 'r-sv', key: 'silver', name: 'シルバー', annualThresholdYen: 20000, mileRatePercent: 1.5, tagId: 't-sv', tagName: '会員ランク：シルバー', memberCount: 2 },
    { id: 'r-bz', key: 'bronze', name: 'ブロンズ', annualThresholdYen: 0, mileRatePercent: 1, tagId: 't-bz', tagName: '会員ランク：ブロンズ', memberCount: 6 },
  ],
  rules: {
    yearStartMonth: 1, applyOnReach: 'immediate', keepUntil: 'next_year_end', countOrders: 'paid',
    version: 3, syncStatus: 'synced', syncError: null, syncedAt: '2026-09-30T10:12:00+09:00', updatedAt: '2026-09-30T10:12:00+09:00',
  },
  milestones: [
    { id: 'm1', thresholdYen: 50000, title: 'なかよし', benefitKind: null, benefitNote: '送料無料クーポン 1 枚', notifyOnReach: true, reachedCount: 5 },
    { id: 'm2', thresholdYen: 300000, title: 'ずっといっしょ', benefitKind: null, benefitNote: null, notifyOnReach: true, reachedCount: 1 },
  ],
  kpis: { members: 12, annualTotalYen: 0, lifetimeTotalYen: 772800, balanceTotal: 0, usedThisMonth: 0, byRank: { platinum: 1, gold: 3, silver: 2, bronze: 6 }, linkedMembers: 9, petMembers: 8, monthPurchaseYen: 186400, monthBuyers: 7 },
}

let host: HTMLDivElement
let root: Root

async function settle(ms = 30) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

async function render(tab: MemberTab, onRetry = () => {}) {
  await act(async () => {
    root.render(
      <MembersV8 accountId="acc-1" tab={tab} status="ready" settings={SETTINGS} onRetry={onRetry} onSaved={() => {}} onChangeTab={() => {}} />,
    )
  })
  await settle()
}

const buttons = () => Array.from(document.querySelectorAll('button'))
const byText = (text: string) => buttons().find((b) => b.textContent?.trim() === text)
const byLabel = (label: string) => buttons().find((b) => b.getAttribute('aria-label') === label)

async function click(target: Element | undefined) {
  expect(target).toBeTruthy()
  await act(async () => { fireEvent.click(target!) })
  await settle()
}

describe('V8 会員（src/v8/nen-members）', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'v8'
    role.value = 'owner'
    fetchApi.mockReset()
    push.mockReset()
    fetchApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/nen/rank-settings?')) return { success: true, data: SETTINGS }
      if (path.startsWith('/api/nen/members?')) return { success: true, data: { items: [], total: 0, page: 1, pageSize: 10, kpis: SETTINGS.kpis, ranks: [] } }
      return { success: true, data: {} }
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
    delete document.documentElement.dataset.theme
  })

  it('ランク設定は絵の形の値（¥200,000〜・3%）と固定の ¥0〜 を見せ、数の帯を出す', async () => {
    await render('ranks')
    const inputs = Array.from(host.querySelectorAll('input')).map((input) => input.value)
    expect(inputs).toContain('¥200,000〜')
    expect(inputs).toContain('3%')
    expect(host.textContent).toContain('¥0〜（固定）')
    expect(host.textContent).toContain('ゴールド以上')
    expect(host.textContent).toContain('今年の購入 ¥50,000 以上')
    expect(host.textContent).toContain('最後に送った日時 9/30 10:12')
  })

  it('「…」→ランクを削除する：移す先はひとつ下を先に選び、版つきで消す', async () => {
    const onRetry = vi.fn()
    await render('ranks', onRetry)
    await click(byLabel('ランク「シルバー」のその他操作'))
    await click(byText('ランクを削除する'))
    expect(document.body.textContent).toContain('ランク「シルバー」を消しますか？')
    expect(document.body.textContent).toContain('このランクには会員が 2 人います。')
    fetchApi.mockImplementationOnce(async () => ({ success: true, data: { id: 'r-sv', replacementRankId: 'r-bz', movedMembers: 2, version: 4, operationId: 'op', ecSync: 'synced' } }))
    await click(byText('2 人を移して消す'))
    const call = fetchApi.mock.calls.find(([path, options]) => String(path).startsWith('/api/nen/rank-settings/r-sv') && options?.method === 'DELETE')
    expect(call).toBeTruthy()
    expect(JSON.parse(call![1].body)).toEqual({ accountId: 'acc-1', replacementRankId: 'r-bz', expectedVersion: 3 })
    expect(onRetry).toHaveBeenCalled()
  })

  it('消すときに版が違う（409）と、タブの下に競合の帯が出る', async () => {
    await render('ranks')
    await click(byLabel('ランク「シルバー」のその他操作'))
    await click(byText('ランクを削除する'))
    fetchApi.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (options?.method === 'DELETE') throw new ApiError(409, 'VERSION_CONFLICT')
      if (path.startsWith('/api/nen/rank-settings?')) return { success: true, data: { ...SETTINGS, rules: { ...SETTINGS.rules!, version: 4, updatedAt: '2026-10-01T14:02:00+09:00' } } }
      return { success: true, data: {} }
    })
    await click(byText('2 人を移して消す'))
    expect(host.textContent).toContain('ほかの人が 14:02 にランク設定を保存しました')
    expect(byText('違いを比べる')).toBeTruthy()
    expect(byText('最新を読み込んで続ける')).toBeTruthy()
  })

  it('いちばん下のランクの削除は押せず、理由を出す', async () => {
    await render('ranks')
    await click(byLabel('ランク「ブロンズ」のその他操作'))
    const item = buttons().find((b) => b.textContent?.includes('ランクを削除する'))
    expect(item).toBeTruthy()
    expect(item!.hasAttribute('disabled') || item!.getAttribute('aria-disabled') === 'true').toBe(true)
    expect(document.body.textContent).toContain('いちばん下のランクは消せません')
  })

  it('ライフタイム：「…」の編集で直し、まとめて保存する', async () => {
    await render('lifetime')
    expect(host.textContent).toContain('最上位')
    expect(host.textContent).toContain('未設定')
    await click(byLabel('節目「なかよし」のその他操作'))
    await click(byText('編集する'))
    const title = Array.from(document.querySelectorAll('input')).find((input) => input.value === 'なかよし')
    expect(title).toBeTruthy()
    await act(async () => { fireEvent.change(title!, { target: { value: 'はじめまして' } }) })
    await click(byText('決める'))
    expect(host.textContent).toContain('はじめまして')
    fetchApi.mockImplementationOnce(async () => ({ success: true, data: SETTINGS }))
    await click(buttons().find((b) => b.textContent?.includes('保存して EC へ同期する')))
    const call = fetchApi.mock.calls.find(([path, options]) => path === '/api/nen/lifetime-milestones' && options?.method === 'PUT')
    expect(call).toBeTruthy()
    expect(JSON.parse(call![1].body).milestones[0]).toEqual({ id: 'm1', thresholdYen: 50000, title: 'はじめまして', notifyOnReach: true })
  })

  it('閲覧のみ：帯を出し、変える・足す・消す・保存のボタンを置かない（CSV は使える）', async () => {
    role.value = 'viewer'
    await render('ranks')
    expect(host.textContent).toContain('閲覧のみで見ています')
    for (const text of ['ランクを足す', 'もう一度同期', 'キャンセル', '保存して EC へ同期']) {
      expect(buttons().some((b) => b.textContent?.includes(text))).toBe(false)
    }
    expect(buttons().some((b) => b.textContent?.includes('CSV で書き出す'))).toBe(true)
    expect(Array.from(host.querySelectorAll('input')).every((input) => input.disabled)).toBe(true)
    // 押せないボタン（disabled）を飾りとして残していない。
    expect(Array.from(host.querySelectorAll('button')).filter((b) => b.disabled).map((b) => b.textContent?.trim())).toEqual([])
    await act(async () => { root.render(<MembersV8 accountId="acc-1" tab="lifetime" status="ready" settings={SETTINGS} onRetry={() => {}} onSaved={() => {}} onChangeTab={() => {}} />) })
    await settle()
    expect(buttons().some((b) => b.textContent?.includes('節目を足す'))).toBe(false)
    expect(byLabel('節目「なかよし」のその他操作')).toBeFalsy()
  })
})
