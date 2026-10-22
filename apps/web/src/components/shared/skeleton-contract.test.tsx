// @vitest-environment happy-dom
import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * ★管理画面 仕上げ「読み込みと初回表示の動き」の契約（`z97zZN` §1・§3 / `sTJsh` §2）。
 *
 * - §3 骨組み：0.3 秒以内に来たら出さない・出したら最低 0.4 秒。
 *   明滅は不透明度 1↔0.55・1.2 秒、光が流れる演出は無し。
 * - §1 初回表示：不透明度 0→1＋下から 8px・200ms・ease-out、
 *   同じ段で 1 つ 40ms ずつ・4 つ目以降は同時。
 * - `sTJsh` §2：読み直し中は前の表示を残して 0.55 に薄め、上に 2px の線。
 *   0.3 秒より早く来たら薄めない。
 *
 * タイマーは fake timers で進めて、実時間を待たない。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const GLOBALS = readFileSync(join(HERE, '../../app/globals.css'), 'utf8')
const GLOBALS_CODE = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, '')
/* 完全切り替え：管理画面 の一覧 page.tsx は捨て、V8 の list-v8.tsx を見る。 */
// シナリオの入口は src/v8/scenarios/list.tsx（古い app/scenarios/list-v8.tsx はもう描かれない）。

import { CardsSkeleton, DelayedSkeleton, Skeleton, StatTilesSkeleton, TableSkeleton } from './skeleton'
import ListState from './list-state'
import { RefreshCover } from './refresh-cover'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.useRealTimers()
})

const tick = async (ms: number) => {
  await act(async () => { vi.advanceTimersByTime(ms) })
}

describe("Skeleton", () => {
  it('骨組みは印（data-skeleton）を持ち、読み上げには出さない', () => {
    const html = renderToStaticMarkup(<Skeleton className="h-5 w-20" />)
    expect(html).toContain('data-skeleton')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('bg-canvas-sunken')
  })

  it('0.3 秒以内に来たら骨組みを出さない', async () => {
    function Probe({ loading }: { loading: boolean }) {
      return (
        <DelayedSkeleton loading={loading} skeleton={<Skeleton className="h-5 w-12" />}>
          <span>42件</span>
        </DelayedSkeleton>
      )
    }
    await act(async () => { root.render(<Probe loading={true} />) })
    expect(host.querySelector('[data-skeleton]')).toBeNull()
    // 250ms で応答が来た。骨組みは一度も出ない。
    await tick(250)
    await act(async () => { root.render(<Probe loading={false} />) })
    await tick(500)
    expect(host.querySelector('[data-skeleton]')).toBeNull()
    expect(host.textContent).toContain('42件')
  })

  it('遅い応答では骨組みを出し、来たあとも最低 0.4 秒は残す', async () => {
    function Probe({ loading }: { loading: boolean }) {
      return (
        <DelayedSkeleton loading={loading} skeleton={<Skeleton className="h-5 w-12" />}>
          <span>42件</span>
        </DelayedSkeleton>
      )
    }
    await act(async () => { root.render(<Probe loading={true} />) })
    await tick(350)
    expect(host.querySelector('[data-skeleton]')).not.toBeNull()
    // 骨組みが出てすぐ応答が来ても、0.4 秒は骨組みのまま。
    await act(async () => { root.render(<Probe loading={false} />) })
    await tick(100)
    expect(host.querySelector('[data-skeleton]')).not.toBeNull()
    await tick(400)
    expect(host.querySelector('[data-skeleton]')).toBeNull()
    expect(host.textContent).toContain('42件')
  })
})

describe("RefreshCover", () => {
  it('0.3 秒より早い応答では薄めない', async () => {
    function Probe({ refreshing }: { refreshing: boolean }) {
      return <RefreshCover refreshing={refreshing}><div>行</div></RefreshCover>
    }
    await act(async () => { root.render(<Probe refreshing={true} />) })
    expect(host.querySelector('[role="status"]')).toBeNull()
    await tick(250)
    await act(async () => { root.render(<Probe refreshing={false} />) })
    expect(host.querySelector('.v7-refresh-dim')).toBeNull()
    expect(host.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('遅い読み直しでは行を残したまま更新中を出す', async () => {
    function Probe({ refreshing }: { refreshing: boolean }) {
      return <RefreshCover refreshing={refreshing}><div>行</div></RefreshCover>
    }
    await act(async () => { root.render(<Probe refreshing={true} />) })
    await tick(350)
    expect(host.querySelector('[role="status"]')?.textContent).toBe('更新中')
    expect(host.querySelector('[aria-busy="true"]')?.textContent).toBe('行')
    // 応答が来たらすぐ元に戻す（最低表示時間は無い）。
    await act(async () => { root.render(<Probe refreshing={false} />) })
    expect(host.querySelector('.v7-refresh-dim')).toBeNull()
  })
})

describe('globals.css の現役の動き規定', () => {
  it('骨組みは今の静止表示を保ち、旧い明滅を残さない', () => {
    expect(GLOBALS_CODE).not.toContain('@keyframes v7-skeleton-pulse')
    expect(GLOBALS_CODE).toMatch(/:root \[data-skeleton\] \{[^}]*background-image:\s*none;\s*animation:\s*none/)
  })

  it('今の初回表示は下から4px・200ms ease-out・40msずつ、消える行を除く', () => {
    expect(GLOBALS_CODE).toMatch(/@keyframes v8-content-in[\s\S]*?translateY\(4px\)/)
    expect(GLOBALS_CODE).toMatch(/tbody:not\(\[data-rows-settled\]\) > tr:not\(\[data-leaving="true"\]\)\s*\{[^}]*var\(--motion-base\)[^}]*var\(--motion-ease-out\)/)
    // 40ms のずらし幅は変数（--motion-stagger）に置いた（動きの点検 18 番）。
    expect(GLOBALS_CODE).toMatch(/--motion-stagger:\s*40ms;/)
    expect(GLOBALS_CODE).toMatch(/nth-child\(2\)\s*\{[^}]*var\(--motion-stagger\)/)
    expect(GLOBALS_CODE).toMatch(/nth-child\(n \+ 4\)\s*\{[^}]*calc\(var\(--motion-stagger\) \* 3\)/)
  })

  it('読み直しを旧い線や薄めへ戻さない', () => {
    expect(GLOBALS_CODE).not.toMatch(/\.v7-refresh-(?:line|dim)\s*\{/)
    expect(GLOBALS_CODE).not.toContain('@keyframes v7-refresh-sweep')
  })
})

describe('形の決まった骨組みの組み合わせ（V8「サクサク感」⑤）', () => {
  it('表の骨組み：5行・行の高さと列の幅を保つ・読み上げに出さない', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(
      <table>
        <TableSkeleton columns={[56, '20%', 120]} rows={5} rowHeight={52} />
      </table>,
    )
    expect(host.querySelectorAll('tbody tr')).toHaveLength(5)
    expect(host.querySelector('tbody tr')?.getAttribute('style')).toContain('52')
    expect(host.querySelectorAll('[data-skeleton]')).toHaveLength(15)
    expect(host.querySelector('tbody')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('カードの骨組み4枚・数のタイルの骨組みは題＋数字の幅', () => {
    const cards = document.createElement('div')
    cards.innerHTML = renderToStaticMarkup(<CardsSkeleton count={4} height={112} />)
    expect(cards.querySelectorAll('[data-skeleton]')).toHaveLength(4)
    const tiles = document.createElement('div')
    tiles.innerHTML = renderToStaticMarkup(<StatTilesSkeleton count={4} />)
    expect(tiles.querySelectorAll('[data-skeleton]')).toHaveLength(8)
  })
})


describe("一覧の読み込み", () => {
  it('V8 は300msまで場所だけ確保し、その後4行の骨格を出す', async () => {
    document.documentElement.dataset.theme = 'v8'
    try {
      await act(async () => { root.render(<ListState kind="loading" />) })
      await tick(299)
      expect(host.querySelector('[data-skeleton-reserve]')).not.toBeNull()
      await tick(1)
      expect(host.querySelector('[data-skeleton-reserve]')).toBeNull()
      expect(host.querySelectorAll('[data-skeleton]')).toHaveLength(12)
      expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
      await act(async () => { root.render(<ListState kind="empty" />) })
      expect(host.querySelector('[aria-busy="true"]')).toBeNull()
    } finally { delete document.documentElement.dataset.theme }
  })
})
