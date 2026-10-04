// @vitest-environment happy-dom
/*
 * UX更新 A・B（NEN 会員V8・主食タブ）。
 * A: 読み込み中は骨組み（DelayedSkeleton＋aria-busy、読み込み中の文言なし）。
 * B: 保存ボタンは 保存中→✓保存しました をボタンの内側だけで出す。
 */
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'

const m = vi.hoisted(() => ({
  members: vi.fn(),
  settings: vi.fn(),
  feeding: vi.fn(),
  saveRanks: vi.fn(),
  saveMilestones: vi.fn(),
  saveFeeding: vi.fn(),
}))

vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: m }))
vi.mock('@/lib/staff-role', () => ({
  useStaffRole: () => 'owner',
  canManageRole: (role: string | null) => role === 'owner' || role === 'admin',
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageCrumbs: () => {}, usePageTitle: () => {} }))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error { status?: number } }))

import MembersPageV8 from './members-v8'
import FeedingTab from '../pets/feeding-tab'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SETTINGS: NenRankSettingsData = {
  ranks: [
    { id: 'r0', key: 'base', name: 'レギュラー', annualThresholdYen: 0, mileRatePercent: 1, tagId: null, tagName: null, memberCount: 10 },
    { id: 'r1', key: 'gold', name: 'ゴールド', annualThresholdYen: 10000, mileRatePercent: 3, tagId: null, tagName: null, memberCount: 2 },
  ],
  milestones: [
    { id: 'm1', thresholdYen: 100000, title: '常連', benefitKind: null, benefitNote: null, notifyOnReach: true, reachedCount: 3 },
  ],
  rules: { version: 3, yearStartMonth: 1 },
  kpis: { members: 12, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
} as unknown as NenRankSettingsData

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const pageProps = {
  accountId: 'acc-1',
  onRetry: () => {},
  onSaved: () => {},
  onChangeTab: () => {},
}

describe('NEN-V8のUX（A骨組み・B保存ボタン）', () => {
  it('会員一覧の読み込み中は表の骨組み（見出し＋5行）を出す', async () => {
    m.members.mockReturnValue(new Promise(() => {}))
    render(<MembersPageV8 {...pageProps} tab="members" status="ready" settings={null} />)
    await flush()
    expect(document.querySelector('[data-skeleton]')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy?.getAttribute('aria-label')).toContain('会員を読み込んでいます')
    const table = busy?.querySelector('table')
    expect(table?.querySelectorAll('thead th').length).toBe(9)
    expect(table?.querySelectorAll('tbody tr').length).toBe(5)
    expect(document.body.textContent).not.toContain('読み込み中')
  })

  it('ランク設定の読み込み中はカードの骨組みを出す', async () => {
    render(<MembersPageV8 {...pageProps} tab="ranks" status="loading" settings={null} />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy?.getAttribute('aria-label')).toContain('ランク設定を読み込んでいます')
    expect(busy?.querySelector('[data-skeleton]'), '骨組みがある').toBeTruthy()
  })

  it('ライフタイムの読み込み中はカードの骨組みを出す', async () => {
    render(<MembersPageV8 {...pageProps} tab="lifetime" status="loading" settings={null} />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy?.getAttribute('aria-label')).toContain('ライフタイムを読み込んでいます')
    expect(busy?.querySelector('[data-skeleton]'), '骨組みがある').toBeTruthy()
  })

  it('主食の読み込み中は骨組みを出す', async () => {
    m.feeding.mockReturnValue(new Promise(() => {}))
    document.documentElement.dataset.theme = 'v8'
    render(<FeedingTab accountId="acc-1" />)
    await flush()
    await act(async () => { vi.advanceTimersByTime(350) })
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy?.getAttribute('aria-label')).toContain('主食のカロリー表を読み込んでいます')
    expect(busy?.querySelector('[data-skeleton]'), '骨組みがある').toBeTruthy()
    expect(document.body.textContent).not.toContain('読み込み中')
    delete document.documentElement.dataset.theme
  })

  it('ランク設定の保存が成功するとボタンに✓保存しましたが出る', async () => {
    m.settings.mockResolvedValue({ success: true, data: { rules: { version: 3 } } })
    m.saveRanks.mockResolvedValue({ success: true, data: { sync: { status: 'synced' } } })
    render(<MembersPageV8 {...pageProps} tab="ranks" status="ready" settings={SETTINGS} />)
    await flush()
    fireEvent.change(screen.getByLabelText('ランク名 2'), { target: { value: 'プラチナ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存して EC へ同期' }))
    await flush()
    expect(m.saveRanks, '保存の口を叩く').toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /保存しました/ }), '✓保存しましたがボタンの内側に出る').toBeTruthy()
  })
})
