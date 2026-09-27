// @vitest-environment happy-dom
/*
 * m18s 真因の直し：「追加」の行の列結合は見えている列の数にする。
 * table-layout: fixed では colSpan=6 が畳んだ列を見えない6列目として作り直し、
 * 残り幅を吸収列と見えない列で分け合う（1440pxで帯と線が約113px手前で切れる）。
 * 本物のReactで動かして見る。表の器の実幅を変えたとき、
 * - ランク表：800px未満は5列、800px以上は6列
 * - lifetime表：800px未満は4列、800px以上1010px未満は5列、1010px以上は6列
 * 固定の colSpan=6 に戻すと赤（1440px相当の700pxで結合数が6のまま）。
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
let roCallbacks: Array<() => void>

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

async function renderRank() {
  await act(async () => {
    root.render(
      <RankSettingsTab accountId="acc-1" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} />,
    )
  })
}

async function renderLifetime() {
  await act(async () => {
    root.render(
      <LifetimeTab accountId="acc-1" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} />,
    )
  })
}

/** 表の器の実幅を作り、ResizeObserver の通知を送る。 */
async function setTableWidthPx(px: number) {
  const section = host.querySelector('section[data-design="Table"]') as HTMLElement
  expect(section).toBeTruthy()
  vi.spyOn(section, 'getBoundingClientRect').mockReturnValue({
    width: px, height: 0, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON: () => ({}),
  })
  expect(roCallbacks.length).toBeGreaterThan(0)
  await act(async () => {
    roCallbacks.forEach((cb) => cb())
  })
}

function addRowColSpan(): string | null {
  return host.querySelector('tbody tr td[colspan]')?.getAttribute('colspan') ?? null
}

describe('m18s 追加行の列結合は見えている列の数', () => {
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    roCallbacks = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) {
        roCallbacks.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('ランク表：1440px相当（700px）では5列に結合する', async () => {
    await renderRank()
    await setTableWidthPx(700)
    expect(addRowColSpan()).toBe('5')
  })

  it('ランク表：広い器（900px）では6列に結合する', async () => {
    await renderRank()
    await setTableWidthPx(900)
    expect(addRowColSpan()).toBe('6')
  })

  it('lifetime表：狭い器（700px）では4列に結合する', async () => {
    await renderLifetime()
    await setTableWidthPx(700)
    expect(addRowColSpan()).toBe('4')
  })

  it('lifetime表：中の器（900px）では5列に結合する', async () => {
    await renderLifetime()
    await setTableWidthPx(900)
    expect(addRowColSpan()).toBe('5')
  })

  it('lifetime表：広い器（1100px）では6列に結合する', async () => {
    await renderLifetime()
    await setTableWidthPx(1100)
    expect(addRowColSpan()).toBe('6')
  })
})
