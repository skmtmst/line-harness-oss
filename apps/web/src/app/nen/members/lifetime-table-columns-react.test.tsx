// @vitest-environment happy-dom
/*
 * m18s: ライフタイム表も「幅を固定しない列は特典の1列だけ・隠す列は
 * ThとTdの両方を消す」の形にする。本物のReactで動かして見る。
 * 1440px・1152px・1920px のどの幅でも列幅の合計が表の幅になる。戻すと赤。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=lifetime'),
}))

import LifetimeTab from '@/v8/nen-members/lifetime'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const SETTINGS: NenRankSettingsData = {
  ranks: [],
  milestones: [
    { id: 'm1', thresholdYen: 50000, title: '常連', benefitKind: null, benefitNote: null, notifyOnReach: true, reachedCount: 3 },
  ],
  rules: null,
  kpis: { members: 0, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

describe('m18s ライフタイム表の列幅は見出しと合う', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('行の列幅は見出しと合う（吸収列は特典の1列だけ）', async () => {
    await act(async () => {
      root.render(
        <LifetimeTab readonly={false} accountId="acc-1" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} />,
      )
    })
    await settle(50)
    const table = host.querySelector('[role="table"]')!
    const heads = Array.from(table.querySelectorAll('[role="columnheader"]')).map(cell => cell.className)
    expect(heads).toHaveLength(6)
    const rows = Array.from(table.querySelectorAll('[role="row"]')).filter(row => row.querySelectorAll('[role="cell"]').length === 6)
    expect(rows).toHaveLength(1)
    for (const row of rows) {
      expect(Array.from(row.querySelectorAll('[role="cell"]')).map(cell => cell.className)).toEqual(heads)
    }
  })
})
