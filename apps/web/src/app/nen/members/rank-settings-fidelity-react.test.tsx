// @vitest-environment happy-dom
/*
 * ランク設定（板 ）と競合の帯（板 ）。
 * 送った日時は短く出す（09/30 10:12）。競合の帯も短い日時で出す。
 * 保存した人の名は口に無いので出さない（別途、口の追加が要る）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=ranks'),
}))

import MembersPageV8 from '@/v8/nen-members/members'
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true, useStaffIdentity: () => ({ id: 'test-staff' }) }))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const SETTINGS: NenRankSettingsData = {
  ranks: [
    { id: 'r1', key: 'gold', name: 'ゴールド', annualThresholdYen: 100000, mileRatePercent: 2, tagId: null, tagName: null, memberCount: 3 },
    { id: 'r0', key: 'base', name: 'ブロンズ', annualThresholdYen: 0, mileRatePercent: 1, tagId: null, tagName: null, memberCount: 6 },
  ],
  rules: {
    yearStartMonth: 1,
    applyOnReach: 'immediate',
    keepUntil: 'next_year_end',
    countOrders: 'paid',
    version: 3,
    syncStatus: 'synced',
    syncError: null,
    syncedAt: '2026-09-30T01:12:00.000Z',
    updatedAt: '2026-09-30T01:00:00.000Z',
  },
  milestones: [],
  kpis: { members: 12, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
}

const LATEST: NenRankSettingsData = {
  ...SETTINGS,
  rules: {
    ...SETTINGS.rules!,
    version: 4,
    updatedAt: '2026-10-02T05:02:00.000Z',
  },
}

function stubFetch() {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/nen/rank-settings')) {
      return new Response(JSON.stringify({ success: true, data: LATEST }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
  }) as typeof globalThis.fetch
}

const originalFetch = globalThis.fetch

describe('ランク設定の絵合わせ（板 `fb9NJ`・`e5yBLx`）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-11T12:00:00+09:00'))
    stubFetch()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
    document.body.innerHTML = ''
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('送った日時は短く出す（09/30 10:12）', async () => {
    await act(async () => {
      root.render(
        <MembersPageV8 accountId="acc-1" tab="ranks" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} onChangeTab={() => {}} />,
      )
    })
    expect(host.textContent ?? '').toContain('最後に送った日時 09/30 10:12')
  })

  it('ランク設定の板にも CSV のボタンと基準ランクの「固定」がある', async () => {
    await act(async () => {
      root.render(
        <MembersPageV8 accountId="acc-1" tab="ranks" status="ready" settings={SETTINGS} onRetry={() => {}} onSaved={() => {}} onChangeTab={() => {}} />,
      )
    })
    const labels = [...host.querySelectorAll('button')].map((element) => element.textContent)
    expect(labels).toContain("CSVで書き出す")
    /* SETTINGS の末尾はしきい値 0 のブロンズ＝基準ランク。 */
    expect(host.textContent ?? '').toContain('¥0〜（固定）')
  })

  it('競合の帯は短い日時で出す', async () => {
    await act(async () => {
      root.render(
        <MembersPageV8 accountId="acc-1" tab="ranks" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} onChangeTab={() => {}} />,
      )
    })
    /* 下書きを汚して保存を押せるようにする。 */
    const nameField = host.querySelector('input[aria-label="ランク名 1"]')
    if (!(nameField instanceof HTMLInputElement)) throw new Error('ランク名の欄がありません')
    await act(async () => {
      fireEvent.change(nameField, { target: { value: 'ブロンズ改' } })
    })
    const saveButton = [...host.querySelectorAll('button')].find(
      (element) => element.textContent === '保存して EC へ同期',
    )
    if (!(saveButton instanceof HTMLButtonElement)) throw new Error('保存のボタンがありません')
    await act(async () => {
      fireEvent.click(saveButton)
    })
    for (let i = 0; i < 60; i += 1) {
      await act(async () => { await Promise.resolve() })
      if ((host.textContent ?? '').includes('にランク設定が保存されました')) break
    }
    /* 版4（14:02 JST）が読み直され、帯が出る。 */
    expect(host.textContent ?? '').toContain('ほかの人が 14:02 にランク設定を保存しました')
    expect(host.querySelector('[title="10/02 14:02"]')).not.toBeNull()
    expect(host.textContent ?? '').toContain('違いを比べる')
    expect(host.textContent ?? '').toContain('最新を読み込んで続ける')
  })
})
