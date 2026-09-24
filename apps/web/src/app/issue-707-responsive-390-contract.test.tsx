// @vitest-environment happy-dom
/*
 * #707 監査6: 390pxレスポンシブ残件の受入試験。
 *
 * - 21 NEN配信: 表の外枠で切り落とさず横スクロール＋操作列sticky
 * - 32 機能設定: 狭幅で1列へ落ち、スイッチ・まとめて切替が域内に残る
 * - 16 成果とアフィリエイト: 6タブ行に続きがある手がかり（影＋送り）
 * - 28 予約メニュー: 操作列を右端へ留める
 *
 * 本物の部品・本物のページを描いて確かめる。モックだけの形骸にしない。
 */
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')
const NEN_OVERVIEW = readFileSync(join(HERE, 'nen-campaigns', 'nen-overview.tsx'), 'utf8')
const SETTINGS_PAGE_SRC = readFileSync(join(HERE, 'settings', 'page.tsx'), 'utf8')
const BOOKING_MENUS_SRC = readFileSync(join(HERE, 'booking', 'menus', 'page.tsx'), 'utf8')
const SCROLLABLE_TABS_SRC = readFileSync(join(SRC, 'components', 'layout', 'scrollable-tabs.tsx'), 'utf8')
const DATA_TABLE_CSS = readFileSync(join(SRC, 'components', 'shared', 'data-table.module.css'), 'utf8')

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) =>
    React.createElement('a', { href: String(href) }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

const { DataTable, TableHeadRow, Th, Tr, Td } = await import('@/components/shared/table')
const { default: ScrollableTabs } = await import('@/components/layout/scrollable-tabs')
const { default: SettingsPage } = await import('./settings/page')

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let host: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const path = String(input)
    if (path.includes('/api/settings/features')) {
      return response({
        success: true,
        data: { features: {}, sidebarItemOrder: {}, specializedFeatureKeys: [], version: 3 },
      })
    }
    if (path.includes('/api/analytics/usage')) {
      return response({ success: true, data: { data: { categories: [], features: [] } } })
    }
    return response({ success: false, error: 'not found' }, 404)
  })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  root = null
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mount(node: React.ReactElement) {
  root = createRoot(host)
  await act(async () => {
    root!.render(node)
    await Promise.resolve()
    await Promise.resolve()
  })
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}

describe('21: 表は外枠で切り落とさず横スクロールで届く', () => {
  it('DataTableの外枠が横スクロールを許す（PC幅では収まるので不変）', () => {
    const frame = DATA_TABLE_CSS.slice(DATA_TABLE_CSS.indexOf('.frame {'), DATA_TABLE_CSS.indexOf('.row {'))
    expect(frame).toContain('overflow-x: auto')
    expect(frame).not.toMatch(/^\s*overflow:\s*hidden/m)
  })

  it('本物のDataTableを描き、操作列がDOMに残る', async () => {
    await mount(
      <DataTable>
        <thead>
          <TableHeadRow>
            <Th>配信</Th>
            <Th className="w-28 sticky right-0 bg-surface-pearl" align="right"><span className="sr-only">操作</span></Th>
          </TableHeadRow>
        </thead>
        <tbody>
          <Tr>
            <Td>テスト配信</Td>
            <Td align="right" className="sticky right-0 bg-canvas"><button type="button">中身を見る</button></Td>
          </Tr>
        </tbody>
      </DataTable>,
    )
    const table = host.querySelector('table')
    expect(table).not.toBeNull()
    // 操作列は表の中に残り、押せる（スクロール先でもDOMから消えない）。
    expect(host.querySelector('button')?.textContent).toBe('中身を見る')
    const actionHeader = [...host.querySelectorAll('th')].find((th) => th.textContent === '')
    expect(actionHeader?.className).toContain('sticky')
  })

  it('nen-overviewの3表すべてに操作列stickyがある', () => {
    expect(NEN_OVERVIEW.match(/sticky right-0 bg-surface-pearl/g)?.length).toBeGreaterThanOrEqual(3)
    expect(NEN_OVERVIEW.match(/sticky right-0 bg-canvas/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('32: 狭幅で1列へ落ち、スイッチが域内に残る', () => {
  it('機能の一覧は基底grid-cols-1＋min-w-0（xl以上は3列のまま）', () => {
    expect(SETTINGS_PAGE_SRC).toContain('grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-3')
    expect(SETTINGS_PAGE_SRC).toContain('min-w-0 space-y-3')
  })

  it('本物の設定ページを描き、スイッチとまとめて切替がDOMに残る', async () => {
    await mount(<SettingsPage />)
    const list = host.querySelector('[data-design="機能の一覧"]')
    expect(list).not.toBeNull()
    expect(list!.className).toContain('grid-cols-1')
    // 切替スイッチは狭幅でも描かれ、押せる状態で残る。
    const switches = [...host.querySelectorAll('[role="switch"]')]
    expect(switches.length).toBeGreaterThan(0)
    expect(host.textContent).toContain('まとめて切替')
  })
})

describe('16: 6タブ行は続きの手がかりと送りを持つ', () => {
  const items = [
    { label: 'アフィリエイター', current: false, onClick: () => {} },
    { label: '案件', current: false, onClick: () => {} },
    { label: '成果承認', current: false, onClick: () => {} },
    { label: '成果地点', current: true, onClick: () => {} },
    { label: 'レポート', current: false, onClick: () => {} },
    { label: '支払い', current: false, onClick: () => {} },
  ]

  it('影ヒントの印が部品にある', () => {
    expect(SCROLLABLE_TABS_SRC).toContain('data-scroll-hint')
  })

  it('本物のタブ行を描き、6タブ全員が押せる＋はみ出し側に影が出る', async () => {
    await mount(<ScrollableTabs items={items} />)
    // 4つ目以降もDOMにあり、押せる（横スクロールで届く）。
    for (const label of ['アフィリエイター', '案件', '成果承認', '成果地点', 'レポート', '支払い']) {
      const tab = [...host.querySelectorAll('[data-scrollable-tabs] button')].find((b) => b.textContent === label)
      expect(tab, label).toBeTruthy()
    }
    // 390px相当（中身560px＞容器350px）を再現し、スクロールで端を測り直す。
    const scroller = host.querySelector('[data-scrollable-tabs] .overflow-x-auto') as HTMLElement
    expect(scroller).not.toBeNull()
    Object.defineProperty(scroller, 'scrollWidth', { value: 560, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 350, configurable: true })
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, configurable: true, writable: true })
    await act(async () => {
      fireEvent.scroll(scroller)
    })
    expect(host.querySelector('[data-scroll-hint="right"]')).not.toBeNull()
  })
})

describe('28: 予約メニューの操作列は右端へ留まる', () => {
  it('表は横スクロール容器＋操作列sticky（ページ全体ではない最小単位）', () => {
    expect(BOOKING_MENUS_SRC).toContain('overflow-x-auto')
    expect(BOOKING_MENUS_SRC).toContain('sticky right-0 bg-canvas-sunken px-4 py-3 text-right')
    expect(BOOKING_MENUS_SRC).toContain('sticky right-0 bg-canvas px-4 py-3 text-right')
    expect(BOOKING_MENUS_SRC).toContain('中身を見る')
    expect(BOOKING_MENUS_SRC).toContain('止める・出す')
  })
})
