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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=lifetime'),
}))

import LifetimeTab from './lifetime-tab'

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
        <LifetimeTab accountId="acc-1" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} />,
      )
    })
    await settle(50)
    const rows = Array.from(host.querySelectorAll('tbody tr')).filter(
      (tr) => tr.querySelectorAll(':scope > td').length === 6,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const tr of rows) {
      const classes = Array.from(tr.querySelectorAll(':scope > td')).map((td) => td.className)
      expect(classes[0]).toContain('w-52')
      expect(classes[1]).toContain('w-56')
      // 特典は幅指定なし（吸収列）＋隠すときは消す。
      expect(classes[2].split(' ')).not.toContain('w-52')
      expect(classes[2].split(' ')).not.toContain('w-56')
      expect(classes[2].split(' ')).not.toContain('w-28')
      expect(classes[2].split(' ')).not.toContain('w-44')
      expect(classes[2].split(' ')).not.toContain('w-14')
      expect(classes[2]).toContain('cq-hide-below-800')
      expect(classes[3]).toContain('w-28')
      expect(classes[4]).toContain('w-44')
      expect(classes[5]).toContain('w-14')
    }
  })
})
