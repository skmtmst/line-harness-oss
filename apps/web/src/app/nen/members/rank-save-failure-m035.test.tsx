// @vitest-environment happy-dom
/*
 * M035：ランク設定・ライフタイムの保存失敗を、生のまま出さず
 * 共通の状態別案内（`describeApiFailure`）へ渡す。本物の React で確かめる試験。
 *
 * - 403 は権限の案内（`API error: 403` は出さない）
 * - 429 は待ち案内（`API error: 429` は出さない）
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'

const m = vi.hoisted(() => ({ saveRanks: vi.fn(), saveMilestones: vi.fn() }))

vi.mock('@/lib/nen-ranks-api', () => ({
  nenRanksApi: { saveRanks: m.saveRanks, saveMilestones: m.saveMilestones },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=ranks'),
}))

import RankSettingsTab from './rank-settings-tab'
import LifetimeTab from './lifetime-tab'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SETTINGS: NenRankSettingsData = {
  ranks: [
    { id: 'r0', key: 'base', name: 'レギュラー', annualThresholdYen: 0, mileRatePercent: 1, tagId: null, tagName: null, memberCount: 10 },
    { id: 'r1', key: 'gold', name: 'ゴールド', annualThresholdYen: 10000, mileRatePercent: 3, tagId: null, tagName: null, memberCount: 2 },
  ],
  milestones: [
    { id: 'm1', thresholdYen: 100000, title: '常連', benefitKind: null, benefitNote: null, notifyOnReach: true, reachedCount: 3 },
  ],
  rules: null,
  kpis: { members: 12, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
})

describe('M035 ランク設定・ライフタイムの保存失敗', () => {
  it('ランク設定の保存の403は権限の案内になり、生文は出ない', async () => {
    m.saveRanks.mockRejectedValueOnce(new ApiError(403, 'API error: 403'))
    render(<RankSettingsTab accountId="acc-1" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} />)
    await flush()
    fireEvent.change(screen.getByLabelText('ランク名 2'), { target: { value: 'プラチナ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存してECへ同期する' }))
    await flush()

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('権限')
    expect(alert.textContent).not.toContain('API error: 403')
  })

  it('節目の保存の429は待ち案内になり、生文は出ない', async () => {
    m.saveMilestones.mockRejectedValueOnce(new ApiError(429, 'API error: 429'))
    render(<LifetimeTab accountId="acc-1" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} />)
    await flush()
    fireEvent.change(screen.getByLabelText('称号 1'), { target: { value: '大常連' } })
    fireEvent.click(screen.getByRole('button', { name: '保存してECへ同期する' }))
    await flush()

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/混み合っています|待って/)
    expect(alert.textContent).not.toContain('API error: 429')
  })
})
