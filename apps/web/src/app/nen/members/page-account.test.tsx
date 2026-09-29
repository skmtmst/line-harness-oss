// @vitest-environment happy-dom
/*
 * DEEP-21（親側）: 会員ページが持つランク設定は「どのアカウントのものか」を
 * 一緒に持ち、選択中のアカウントのものだけをタブへ渡すことを確かめる。
 *
 * - Bの取得が終わるまで、Aの設定はタブへ渡さない
 * - 切替後に遅れて届いたAの応答は捨てる（逆順応答で混ざらない）
 * - 切替前アカウントの保存応答は反映しない
 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'

const fixture = vi.hoisted(() => ({ accountId: 'A' as string }))
const m = vi.hoisted(() => ({ settings: vi.fn() }))
type RankTabProps = {
  accountId: string
  status: string
  settings: NenRankSettingsData | null
  onSaved: (forAccountId: string, next: NenRankSettingsData) => void
  onRetry: () => void
}
const captured = vi.hoisted(() => ({ rank: null as RankTabProps | null }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams('tab=ranks') }))
vi.mock('@/lib/api', () => ({ ApiError: class extends Error { status?: number } }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/components/shared/page-header', () => ({ default: () => null }))
vi.mock('@/components/layout/scrollable-tabs', () => ({ default: () => null }))
vi.mock('@/lib/nen-ranks-api', () => ({ nenRanksApi: { settings: m.settings } }))
vi.mock('./rank-settings-tab', () => ({ default: (props: RankTabProps) => { captured.rank = props; return null } }))
vi.mock('./lifetime-tab', () => ({ default: () => null }))
vi.mock('./members-tab', () => ({ default: () => null }))

import Page from './page'

const settingsData = (tag: string): NenRankSettingsData => ({
  ranks: [],
  milestones: [],
  rules: null,
  kpis: { members: 0, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: { [tag]: 1 } },
})
const flush = () => act(async () => { await Promise.resolve() })

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  captured.rank = null
  fixture.accountId = 'A'
})

describe('DEEP-21 会員ページの対象スナップショット', () => {
  it('Aの取得中にBへ切り替えると、BへはAの設定を渡さず、遅れたA応答も保存応答も捨てる', async () => {
    let resolveA!: (value: unknown) => void
    m.settings
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve }))
      .mockResolvedValueOnce({ success: true, data: settingsData('B') })

    const v = render(<Page />)
    await flush()
    // Aの取得中：まだ何も渡さない
    expect(captured.rank!.settings).toBeNull()

    fixture.accountId = 'B'
    v.rerender(<Page />)
    await flush()
    // Bの設定だけが届く
    expect(captured.rank!.settings).toEqual(settingsData('B'))
    expect(captured.rank!.status).toBe('ready')

    // 遅れて届いたAの取得応答は捨てる
    await act(async () => resolveA({ success: true, data: settingsData('A') }))
    expect(captured.rank!.settings).toEqual(settingsData('B'))

    // 切替前アカウントの保存応答は反映しない
    act(() => { captured.rank!.onSaved('A', settingsData('A')) })
    expect(captured.rank!.settings).toEqual(settingsData('B'))

    // いまのアカウントの保存応答は反映する
    act(() => { captured.rank!.onSaved('B', settingsData('B2')) })
    expect(captured.rank!.settings).toEqual(settingsData('B2'))
  })
})
