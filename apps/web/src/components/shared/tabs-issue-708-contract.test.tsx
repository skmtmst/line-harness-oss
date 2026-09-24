// @vitest-environment happy-dom
/*
 * Issue #708 a11y第2弾（フォーカスリング・tablist・h1・隠れ動線）。
 *
 * 形骸にしないため、タブの意味とキー操作は本物のReactで動かして
 * 確かめる（モックだけの存在確認はしない）。
 */
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

const navState = vi.hoisted(() => ({ search: '', replaced: [] as string[] }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(), refresh: vi.fn(),
    back: vi.fn(), forward: vi.fn(), prefetch: vi.fn(),
    replace: (url: string) => { navState.replaced.push(url) },
  }),
  useSearchParams: () => new URLSearchParams(navState.search),
}))

import { Tabs } from '@/components/shared/tabs'
import { MENU_SECTIONS, SCREEN_MENU_OWNER, menuOwnerForScreen } from '@/lib/menu'
import AffiliatesPage from '@/app/affiliates/page'
import { AFFILIATE_OFFERS_DESTINATION } from '@/app/affiliate-offers/destination'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
}

afterEach(cleanup)

function renderTabs() {
  return render(
    <Tabs
      label="表示内容の切替"
      items={[
        { label: 'アフィリエイター', current: false, panelId: 'panel', onClick: () => {} },
        { label: '案件', current: true, panelId: 'panel', onClick: () => {} },
        { label: 'レポート', href: '/conversions?tab=report', current: false, panelId: 'panel' },
      ]}
    />,
  )
}

describe('Issue #708 09/16 タブは tablist として振る舞う（実React）', () => {
  it('tablist・tab・aria-selected・tabpanel への結線がある', () => {
    renderTabs()
    const list = screen.getByRole('tablist', { name: '表示内容の切替' })
    expect(list).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['アフィリエイター', '案件', 'レポート'])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    for (const tab of tabs) {
      expect(tab.getAttribute('aria-controls')).toBe('panel')
    }
  })

  it('今のタブだけが Tab の停止点（roving tabindex）', () => {
    renderTabs()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => (tab as HTMLElement).tabIndex)).toEqual([-1, 0, -1])
  })

  it('矢印キーで焦点が移り、Home・End で端へ飛ぶ', () => {
    renderTabs()
    const tabs = screen.getAllByRole('tab') as HTMLElement[]
    act(() => { tabs[1].focus() })
    expect(document.activeElement).toBe(tabs[1])
    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[0])
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(tabs[2], { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0])
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(document.activeElement).toBe(tabs[2])
  })

  it('矢印では遷移せず、焦点だけが移る（手動操作タブ）', () => {
    const onClick = vi.fn()
    render(
      <Tabs
        label="表示内容の切替"
        items={[
          { label: '先頭', current: true, onClick },
          { label: '次へ', href: '/next', current: false },
        ]}
      />,
    )
    const tabs = screen.getAllByRole('tab') as HTMLElement[]
    act(() => { tabs[0].focus() })
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[1])
    expect(onClick).not.toHaveBeenCalled()
    // リンクの行き先は残っている（Enter で開ける）。
    expect(tabs[1].getAttribute('href')).toBe('/next')
  })

  it('行き先のない今のタブは押せないまま焦点に止まれる', () => {
    render(
      <Tabs
        label="表示内容の切替"
        items={[
          { label: '今ここ', current: true },
          { label: 'ほか', current: false, onClick: () => {} },
        ]}
      />,
    )
    const tabs = screen.getAllByRole('tab') as HTMLElement[]
    const current = tabs[0]
    expect(current.hasAttribute('disabled')).toBe(false)
    expect(current.getAttribute('aria-disabled')).toBe('true')
    expect(current.getAttribute('aria-selected')).toBe('true')
    expect(current.tabIndex).toBe(0)
    act(() => { current.focus() })
    expect(document.activeElement).toBe(current)
    // 見た目の押せない表現は CSS が引き受ける。
    expect(read('components/shared/tabs.module.css')).toContain(".tab[aria-disabled='true']")
  })

  it('選択中の追従（ScrollableTabs）が読む目印を残す', () => {
    renderTabs()
    const tabs = screen.getAllByRole('tab')
    expect(tabs[1].getAttribute('aria-current')).toBe('page')
    expect(read('components/layout/scrollable-tabs.tsx')).toContain('[aria-current="page"]')
  })
})

describe('Issue #708 09/16 面（tabpanel）の配線', () => {
  it('09 友だち追加時の配信は名前付き tablist と対応する面を持つ', () => {
    const src = read('app/friend-add-settings/page.tsx')
    expect(src).toContain('label="配信する相手の切替"')
    expect(src).toContain("panelId: 'friend-add-rule-panel'")
    expect(src).toContain('role="tabpanel"')
    expect(src).toContain('id="friend-add-rule-panel"')
  })

  it('16 コンバージョンは名前付き tablist と対応する面を持つ', () => {
    const src = read('app/conversions/page.tsx')
    expect(src).toContain('label="表示内容の切替"')
    expect(src).toContain('panelId="conversions-tabpanel"')
    expect(src).toContain('role="tabpanel"')
    expect(src).toContain('id="conversions-tabpanel"')
  })
})

describe('Issue #708 10 フォーカスリング', () => {
  it('共通の :focus-visible 規定が @layer 内にある', () => {
    const css = read('app/globals.css')
    const layerStart = css.indexOf('@layer base')
    expect(layerStart).toBeGreaterThan(-1)
    const focusRule = css.indexOf(':focus-visible {')
    expect(focusRule).toBeGreaterThan(layerStart)
    expect(css.slice(focusRule, focusRule + 160)).toContain('2px solid')
    expect(css.slice(focusRule, focusRule + 160)).toContain('status-info')
  })

  it('ウェビナー画面に outline 消しが残っていない', () => {
    for (const rel of ['app/webinars/page.tsx', 'app/webinars/new/page.tsx', 'app/webinars/edit/page.tsx']) {
      expect(read(rel), rel + ' に outline 消しが残っている').not.toContain('focus:outline-none')
      expect(read(rel), rel + ' に outline 消しが残っている').not.toContain('outline:none')
      expect(read(rel), rel + ' に outline 消しが残っている').not.toContain('outline: none')
    }
  })
})

describe('Issue #708 19 h1 とナビ選択の一致', () => {
  it('案件・承認・支払いタブは「成果とアフィリエイト」に属する', () => {
    expect(menuOwnerForScreen('/conversions', '?tab=offers')).toBe('affiliates')
    expect(menuOwnerForScreen('/conversions', '?tab=approvals')).toBe('affiliates')
    expect(menuOwnerForScreen('/conversions', '?tab=payment')).toBe('affiliates')
    expect(menuOwnerForScreen('/conversions', '?tab=report')).toBe('conversions')
    // 既存の一致（アフィリエイター・成果地点・素のURL）は宣言なしで合う。
    expect(menuOwnerForScreen('/conversions', '?tab=affiliates')).toBeUndefined()
    expect(menuOwnerForScreen('/conversions', '?tab=points')).toBeUndefined()
    expect(menuOwnerForScreen('/conversions', '')).toBeUndefined()
  })

  it('所属先の項目がメニューに実在する', () => {
    const ids = new Set(MENU_SECTIONS.flatMap((section) => section.items.map((item) => item.id)))
    for (const screen of ['/conversions?tab=offers', '/conversions?tab=approvals', '/conversions?tab=payment', '/conversions?tab=report']) {
      expect(ids.has(SCREEN_MENU_OWNER[screen]), `${screen} の所属先がメニューに無い`).toBe(true)
    }
  })
})

describe('Issue #708 隠れ動線 リダイレクトの行き先明示', () => {
  it('/affiliates は ?tab= を保って正規ルートへ送る（実React）', () => {
    navState.search = 'tab=offers'
    navState.replaced.length = 0
    render(<AffiliatesPage />)
    // 自動転送の行き先は ?tab= を保つ。
    expect(navState.replaced).toEqual(['/conversions?tab=offers'])
    // 画面にも行き先の名前と押せるリンクが出る。
    expect(screen.getByText('成果とアフィリエイトへ移動しています…')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'こちらから移動する' })
    expect(link.getAttribute('href')).toBe('/conversions?tab=offers')
    cleanup()
    // 知らない値・未指定は「アフィリエイター」タブを開く。
    navState.search = 'tab=unknown'
    navState.replaced.length = 0
    render(<AffiliatesPage />)
    expect(navState.replaced).toEqual(['/conversions?tab=affiliates'])
    expect(screen.getByRole('link', { name: 'こちらから移動する' }).getAttribute('href'))
      .toBe('/conversions?tab=affiliates')
  })

  it('/affiliate-offers は正規ルートへ直接送る（二段飛ばしにしない）', () => {
    expect(AFFILIATE_OFFERS_DESTINATION).toBe('/conversions?tab=offers')
    expect(read('app/affiliate-offers/page.tsx')).not.toContain("router.replace('/affiliates")
  })

  it('どちらの画面にも行き先の名前と押せるリンクがある', () => {
    for (const rel of ['app/affiliates/page.tsx', 'app/affiliate-offers/page.tsx']) {
      const src = read(rel)
      expect(src, rel).toContain('こちらから移動する')
      expect(src, rel).toContain('<Link')
    }
  })
})
