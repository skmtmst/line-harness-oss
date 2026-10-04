// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * ★V7 仕上げ「読み込みと初回表示の動き」の契約（`z97zZN` §1・§3 / `sTJsh` §2）。
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
const FRIENDS_PAGE = readFileSync(join(HERE, '../../app/friends/page.tsx'), 'utf8')
const FRIENDS_TABLE = readFileSync(join(HERE, '../friends/friend-list-table.tsx'), 'utf8')
const SCENARIOS_PAGE = readFileSync(join(HERE, '../../app/scenarios/page.tsx'), 'utf8')
const SERVER_LIST = readFileSync(join(HERE, '../../lib/use-server-list.ts'), 'utf8')

import { CardsSkeleton, DelayedSkeleton, Skeleton, StatTilesSkeleton, TableSkeleton } from './skeleton'
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

describe('Skeleton（★V7 `z97zZN` §3）', () => {
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

describe('RefreshCover（★V7 `sTJsh` §2 前の表示を残す）', () => {
  it('0.3 秒より早い応答では薄めない', async () => {
    function Probe({ refreshing }: { refreshing: boolean }) {
      return <RefreshCover refreshing={refreshing}><div>行</div></RefreshCover>
    }
    await act(async () => { root.render(<Probe refreshing={true} />) })
    expect(host.querySelector('.v7-refresh-dim')).toBeNull()
    await tick(250)
    await act(async () => { root.render(<Probe refreshing={false} />) })
    expect(host.querySelector('.v7-refresh-dim')).toBeNull()
    expect(host.querySelector('.v7-refresh-line')).toBeNull()
  })

  it('遅い読み直しでは 0.55 に薄め、上に線の帯を出す', async () => {
    function Probe({ refreshing }: { refreshing: boolean }) {
      return <RefreshCover refreshing={refreshing}><div>行</div></RefreshCover>
    }
    await act(async () => { root.render(<Probe refreshing={true} />) })
    await tick(350)
    expect(host.querySelector('.v7-refresh-dim')).not.toBeNull()
    expect(host.querySelector('.v7-refresh-line')).not.toBeNull()
    // 応答が来たらすぐ元に戻す（最低表示時間は無い）。
    await act(async () => { root.render(<Probe refreshing={false} />) })
    expect(host.querySelector('.v7-refresh-dim')).toBeNull()
  })
})

describe('globals.css の動き規定（★V7 `z97zZN` §1・§3）', () => {
  it('骨組みの明滅は不透明度 1↔0.55・1.2 秒', () => {
    expect(GLOBALS_CODE).toMatch(/--motion-pulse:\s*1\.2s/)
    expect(GLOBALS_CODE).toMatch(/@keyframes v7-skeleton-pulse[\s\S]*?50%\s*\{\s*opacity:\s*0\.55/)
    expect(GLOBALS_CODE).toMatch(/\.animate-pulse\s*\{[^}]*v7-skeleton-pulse/)
  })

  it('初回表示は下から 8px・200ms ease-out・40ms ずつ', () => {
    expect(GLOBALS_CODE).toMatch(/@keyframes v7-rise[\s\S]*?translateY\(8px\)/)
    expect(GLOBALS_CODE).toMatch(/\.v7-stagger > \*\s*\{[^}]*var\(--motion-base\)[^}]*var\(--motion-ease-out\)/)
    expect(GLOBALS_CODE).toMatch(/nth-child\(2\)\s*\{[^}]*40ms/)
    expect(GLOBALS_CODE).toMatch(/nth-child\(n \+ 4\)\s*\{[^}]*120ms/)
  })

  it('読み直しの線は上に 2px、薄めは 0.55', () => {
    expect(GLOBALS_CODE).toMatch(/\.v7-refresh-line\s*\{[^}]*height:\s*2px/)
    expect(GLOBALS_CODE).toMatch(/\.v7-refresh-dim\s*\{[^}]*opacity:\s*0\.55/)
  })
})

describe('前の表示を残したまま読む（★V7 `sTJsh` §2）', () => {
  it('一覧の読み直しでは行を消さず refreshing を画面へ渡す', () => {
    // 友だち一覧: 行があるときは消さず、refreshing で薄め＋線を出す。
    expect(FRIENDS_PAGE).toContain('setRefreshing(true)')
    expect(FRIENDS_PAGE).toContain('refreshing={refreshing}')
    expect(FRIENDS_TABLE).toContain('<RefreshCover')
    // 共有の一覧 hook: 読み直しで items を消さず refreshing を返す。
    expect(SERVER_LIST).toContain('refreshing: state.loading && state.items.length > 0')
    expect(SERVER_LIST).not.toMatch(/items:\s*\[\],\s*loaded:\s*false,\s*loading:\s*true/)
    // シナリオ一覧も薄め＋線を出す。
    expect(SCENARIOS_PAGE).toContain('refreshing={scenarioList.refreshing}')
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
