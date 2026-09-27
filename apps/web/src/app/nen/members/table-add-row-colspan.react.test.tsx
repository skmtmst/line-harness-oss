// @vitest-environment happy-dom
/*
 * m18s 真因の直し：「追加」は表の外（表の下）に置き colSpan を使わない。
 * table-layout: fixed では結合セルが畳んだ列を見えない列として作り直し、
 * 残り幅を分け合って帯と線が手前で切れて見える。本物のReactで動かして見る。
 * - 表の中に結合セル（td[colspan]）が無い
 * - 「追加」のボタンは表の中に無く、同じ区画にある
 * 表の中に戻すと赤。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=ranks'),
}))

import RankSettingsTab from './rank-settings-tab'
import LifetimeTab from './lifetime-tab'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const SETTINGS: NenRankSettingsData = {
  ranks: [
    { id: 'r0', key: 'base', name: 'レギュラー', annualThresholdYen: 0, mileRatePercent: 1, tagId: null, tagName: null, memberCount: 10 },
  ],
  milestones: [
    { id: 'm1', thresholdYen: 30000, title: 'ブロンズ', benefitKind: null, benefitNote: null, notifyOnReach: true, reachedCount: 3 },
  ],
  rules: null,
  kpis: { members: 10, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

/** 区画の表の中に結合セルが無く、追加ボタンが表の外・区画の中にある。 */
function expectAddOutsideTable(label: string) {
  const section = host.querySelector('section[data-design="Table"]')
  expect(section).toBeTruthy()
  const table = section!.querySelector('table')
  expect(table).toBeTruthy()
  expect(section!.querySelector('td[colspan]')).toBeNull()
  const add = Array.from(section!.querySelectorAll('button')).find((b) => b.textContent?.includes(label))
  expect(add).toBeTruthy()
  expect(table!.contains(add!)).toBe(false)
}

describe('m18s 追加は表の外に置き表の中に結合を作らない', () => {
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

  it('ランク表：「ランクを追加」は表の外にある', async () => {
    await act(async () => {
      root.render(
        <RankSettingsTab accountId="acc-1" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} />,
      )
    })
    await settle(50)
    expectAddOutsideTable('ランクを追加')
  })

  it('lifetime表：「節目を追加」は表の外にある', async () => {
    await act(async () => {
      root.render(
        <LifetimeTab accountId="acc-1" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} />,
      )
    })
    await settle(50)
    expectAddOutsideTable('節目を追加')
  })
})
