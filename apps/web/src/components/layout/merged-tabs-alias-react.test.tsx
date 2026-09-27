// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MergedTabs, { useMergedTab } from './merged-tabs'
import { ANALYTICS_TABS as SEARCH_CONSOLE_TABS } from '@/app/search-console/analytics-tabs'

/**
 * R75: Search Console の「URLクリック」タブが別の分析（友だちの増減）を
 * 開いていた。タブのキー `clicks` が分析側の `url-clicks` と違ったため、
 * クエリが知らない値として先頭タブへ落ちていた。
 *
 * 直し: Search Console 側のキーを `url-clicks` にそろえ、旧キー `clicks`
 * で来たURLは互換表で寄せる。戻して赤くなること（= キーがずれると
 * 違うタブが開くこと）もこの試験で守る。
 */

const fixture = vi.hoisted(() => ({
  tabParam: null as string | null,
  replaced: [] as string[],
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? fixture.tabParam : null) }),
  useRouter: () => ({
    push: () => undefined,
    replace: (url: string) => { fixture.replaced.push(url) },
    back: () => undefined,
  }),
}))

const ANALYTICS_TABS = [
  { key: 'friends', label: '友だちの増減' },
  { key: 'url-clicks', label: 'URLクリック' },
] as const

function Probe({ aliases }: { aliases?: Record<string, string> }) {
  const tab = useMergedTab([...ANALYTICS_TABS], 'tab', undefined, aliases)
  return <p data-testid="active-tab">{tab}</p>
}

let root: Root | null = null
let host: HTMLElement | null = null

function render(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  root = null
  host = null
  fixture.tabParam = null
  fixture.replaced = []
})

function tabText(host: HTMLElement): string {
  return host.querySelector('[data-testid="active-tab"]')?.textContent ?? ''
}

describe('useMergedTab の互換表', () => {
  it('旧キー clicks を url-clicks へ寄せる', () => {
    fixture.tabParam = 'clicks'
    const host = render(<Probe aliases={{ clicks: 'url-clicks' }} />)
    expect(tabText(host)).toBe('url-clicks')
  })

  it('現行キーはそのまま開く', () => {
    fixture.tabParam = 'url-clicks'
    const host = render(<Probe aliases={{ clicks: 'url-clicks' }} />)
    expect(tabText(host)).toBe('url-clicks')
  })

  it('互換表に無い知らない値は先頭タブへ落とす', () => {
    fixture.tabParam = 'clicks'
    const host = render(<Probe />)
    // 互換表なしでは旧キーは知らない値。先頭（友だちの増減）が開く。
    expect(tabText(host)).toBe('friends')
  })
})

describe('Search Console からの移動先', () => {
  it('URLクリックのタブは /analytics?tab=url-clicks へ向かう', () => {
    // 本物の Search Console のタブ定義を使う。キーがずれると行き先が変わる。
    const host = render(
      <MergedTabs basePath="/analytics" tabs={SEARCH_CONSOLE_TABS} active="search" />,
    )
    const button = [...host.querySelectorAll('button')].find(
      (el) => el.textContent === 'URLクリック',
    )
    expect(button).toBeTruthy()
    act(() => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(fixture.replaced).toEqual(['/analytics?tab=url-clicks'])
  })
})
