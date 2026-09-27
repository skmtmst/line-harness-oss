// @vitest-environment happy-dom
/*
 * m18s: ランク表の行操作はほかの一覧と同じ形にする。
 * 本物のReactで動かして見る。
 * - 保存済みの行に赤いゴミ箱（直置きの削除）は置かない。「…」の中に「削除」
 * - 「…」→「削除」では確認が出て、確定するまで行は残る
 * - まだ保存していない行（追加したばかり）は「行を外す」の文字ボタンで外す
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=ranks'),
}))

import RankSettingsTab from './rank-settings-tab'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const SETTINGS: NenRankSettingsData = {
  ranks: [
    { id: 'r0', key: 'base', name: 'レギュラー', annualThresholdYen: 0, mileRatePercent: 1, tagId: null, tagName: null, memberCount: 10 },
    { id: 'r1', key: 'gold', name: 'ゴールド', annualThresholdYen: 10000, mileRatePercent: 3, tagId: null, tagName: null, memberCount: 2 },
  ],
  milestones: [],
  rules: null,
  kpis: { members: 12, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
}

async function renderTab() {
  await act(async () => {
    root.render(
      <RankSettingsTab accountId="acc-1" status="ready" settings={SETTINGS} onSaved={() => {}} onRetry={() => {}} />,
    )
  })
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

describe('m18s ランク表の行操作は一覧共通の形', () => {
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

  it('表は区画の器で幅を決め、枠いっぱいに広がる形にする（1440px・1152px）', async () => {
    await renderTab()
    await settle(50)
    // 器（@container）は区画に置き、表の枠には付けない。枠の中で幅を
    // 決めると狭く縮んで右側が空く。区画と枠は同幅のため境目は変わらない。
    const section = host.querySelector('section[data-design="Table"]')
    expect(section).toBeTruthy()
    expect(section!.className).toContain('@container')
    const frame = section!.querySelector('div')
    expect(frame).toBeTruthy()
    expect(frame!.className.split(' ').some((c) => c === '@container')).toBe(false)
    // 操作列は固定幅で表の右端に付く（右寄せは契約テストで文字どおり守る）。
    const heads = Array.from(section!.querySelectorAll('thead th'))
    const last = heads[heads.length - 1]
    expect(last.className).toContain('w-14')
    expect(last.textContent).toContain('操作')
  })

  it('行の列幅は見出しと合う（吸収列はタグの1列だけ）', async () => {
    await renderTab()
    await settle(50)
    // 1440px・1152px・1920px のどの幅でも列幅の合計が表の幅になる形。
    // 幅指定なしはタグの1列だけ。戻すと赤。
    const rows = Array.from(host.querySelectorAll('tbody tr')).filter(
      (tr) => tr.querySelectorAll(':scope > td').length === 6,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const tr of rows) {
      const classes = Array.from(tr.querySelectorAll(':scope > td')).map((td) => td.className)
      expect(classes[0]).toContain('w-44')
      expect(classes[1]).toContain('w-40')
      expect(classes[2]).toContain('w-28')
      expect(classes[3].split(' ')).not.toContain('w-44')
      expect(classes[3].split(' ')).not.toContain('w-40')
      expect(classes[3].split(' ')).not.toContain('w-28')
      expect(classes[3].split(' ')).not.toContain('w-24')
      expect(classes[3].split(' ')).not.toContain('w-14')
      expect(classes[4]).toContain('w-24')
      expect(classes[5]).toContain('w-14')
    }
  })

  it('保存済みの行は「…」に削除を集約し、直置きのゴミ箱は出さない', async () => {
    await renderTab()
    await settle(50)
    // 直置きの削除（赤いゴミ箱）は無い。「ゴールドを削除する」という押口は無い。
    expect(
      Array.from(host.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'ゴールドを削除する'),
    ).toBeFalsy()
    // 「…」はある（ゴールド行のその他操作）。
    const more = host.querySelector('button[aria-label="ゴールドのその他操作"]')
    expect(more).toBeTruthy()
    await act(async () => {
      fireEvent.click(more!)
    })
    await settle(50)
    expect(document.body.textContent).toContain('ランクを削除')
  })

  it('「…」→削除では確認が出て、確定で行が外れる', async () => {
    await renderTab()
    await settle(50)
    const more = host.querySelector('button[aria-label="ゴールドのその他操作"]')
    await act(async () => {
      fireEvent.click(more!)
    })
    await settle(50)
    const del = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'ランクを削除')
    expect(del).toBeTruthy()
    await act(async () => {
      fireEvent.click(del!)
    })
    await settle(50)
    // 確認が出て、まだ行は残っている。
    expect(document.body.textContent).toContain('ゴールド」を削除しますか？')
    expect(host.textContent).toContain('ゴールド')
    const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '削除する')
    expect(confirm).toBeTruthy()
    await act(async () => {
      fireEvent.click(confirm!)
    })
    await settle(50)
    expect(host.textContent).not.toContain('ゴールド')
  })

  it('追加したばかりの行は「行を外す」で確認なしに外せる', async () => {
    await renderTab()
    await settle(50)
    const add = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('ランクを追加'))
    expect(add).toBeTruthy()
    await act(async () => {
      fireEvent.click(add!)
    })
    await settle(50)
    const detach = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '行を外す')
    expect(detach).toBeTruthy()
    await act(async () => {
      fireEvent.click(detach!)
    })
    await settle(50)
    expect(Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '行を外す')).toBeFalsy()
  })
})
