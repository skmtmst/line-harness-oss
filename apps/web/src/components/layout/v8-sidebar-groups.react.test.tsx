// @vitest-environment happy-dom
/*
 * ★V8（夕44-A・部品 T7XSI6）：左メニューの組の開閉と「設定」の入口。
 *
 *   - メイン・配信・コンテンツ・予約は開いた形、ほかは見出しだけ
 *   - 畳んだ組は見出しだけ残る（組が丸ごと消えない）
 *   - 押すと開き、開いた状態はブラウザが覚える（lh-sidebar-groups）
 *   - いまいる画面の組は常に開く
 *   - 左メニューのいちばん下に「設定」（オーナー・管理者だけ）
 *   - v7 では開閉も歯車も出さず、V2 モードの組隠しも v8 では効かない
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MENU_SECTIONS } from '@/lib/menu'

const fixture = vi.hoisted(() => ({
  visibility: vi.fn(),
  get: vi.fn(),
  pathname: '/',
}))

const localStorageValues = new Map<string, string>()
const testLocalStorage = {
  getItem: (key: string) => localStorageValues.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageValues.set(key, String(value)) },
  removeItem: (key: string) => { localStorageValues.delete(key) },
  clear: () => { localStorageValues.clear() },
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testLocalStorage })
Object.defineProperty(window, 'localStorage', { configurable: true, value: testLocalStorage })

vi.mock('next/navigation', () => ({ usePathname: () => fixture.pathname }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return { default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...props }, children) }
})
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: '会社', iconUrl: null }) }))
vi.mock('@/components/layout/sidebar-identity', () => ({ default: () => <div>identity</div> }))
vi.mock('@/components/layout/sidebar-version', () => ({ default: () => <div>version</div> }))
vi.mock('@/components/hq/account-menu', () => ({ default: () => <div>hq</div> }))
vi.mock('@/lib/api', () => ({
  api: {
    featureSettings: {
      visibility: fixture.visibility,
      get: fixture.get,
    },
    inbox: { unanswered: { count: vi.fn(async () => ({ success: true, data: { total: 0 } })) } },
    nenMembers: { overview: vi.fn(async () => ({ success: true, data: { pendingPhotos: 0 } })) },
    health: { summary: vi.fn(async () => ({ success: true, data: { warningCount: 0, dangerCount: 0 } })) },
  },
}))

import Sidebar, { isHqShellPath } from './sidebar'
import { clearFeatureVisibilityCache } from '@/lib/feature-visibility-cache'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 全部の任意機能を on にした応答（組の出方だけを見るため）。 */
const ALL_FEATURES_ON = Object.fromEntries(
  MENU_SECTIONS.flatMap((section) => section.items)
    .map((item) => item.featureKey)
    .filter((key): key is string => Boolean(key))
    .map((key) => [key, true]),
)

/** 飲食店向け（テスト）は環境の旗が立たないと出ない。テストでは 8 組。 */
const VISIBLE_GROUP_LABELS = ['メイン', '配信', 'コンテンツ', '成果と分析', '自動化', '予約', '専用機能', '設定']

async function renderSidebar(props: { friendAttributesV2Mode?: boolean } = {}) {
  const view = render(<Sidebar {...props} />)
  await waitFor(() => expect(fixture.visibility).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  return view
}

describe('★V8 左メニューの組の開閉と「設定」の入口', () => {
  beforeEach(() => {
    clearFeatureVisibilityCache()
    fixture.visibility.mockReset()
    fixture.get.mockReset()
    fixture.pathname = '/'
    fixture.visibility.mockResolvedValue({ success: true, data: { features: ALL_FEATURES_ON } })
    fixture.get.mockResolvedValue({
      success: true,
      data: { features: ALL_FEATURES_ON, sidebarOrder: null, sidebarItemOrder: null, specializedFeatureKeys: [] },
    })
    document.documentElement.dataset.theme = 'v8'
    window.localStorage.clear()
    window.localStorage.setItem('lh_staff_role', 'owner')
    /*
     * 画面幅 1280 未満では畳んだ形で開く既定がある（テスト環境の幅は
     * happy-dom の小さい値）。組の出し分けを見るので、ここでは
     * 「広げた」に固定する。
     */
    window.localStorage.setItem('lh-sidebar-collapsed', '0')
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.theme
  })

  it('全部の組の見出しが出る（畳んだ組も見出しだけ残る＝組が丸ごと消えない）', async () => {
    const view = await renderSidebar()
    for (const label of VISIBLE_GROUP_LABELS) {
      expect(view.getAllByRole('button', { name: label }).length, `組「${label}」の見出しが無い`).toBeGreaterThan(0)
    }
  })

  it('主要4組ははじめから開き、ほかの組は見出しだけ', async () => {
    const view = await renderSidebar()
    // 開く：メイン・配信・コンテンツ・予約
    expect(view.getAllByRole('link', { name: 'ダッシュボード' }).length).toBeGreaterThan(0)
    expect(view.getAllByRole('link', { name: '一斉配信' }).length).toBeGreaterThan(0)
    expect(view.getAllByRole('link', { name: 'テンプレート' }).length).toBeGreaterThan(0)
    expect(view.getAllByRole('link', { name: '予約管理' }).length).toBeGreaterThan(0)
    // 畳む：成果と分析・自動化・専用機能・設定
    expect(view.queryAllByRole('link', { name: '分析' })).toHaveLength(0)
    expect(view.queryAllByRole('link', { name: 'オートメーション' })).toHaveLength(0)
    expect(view.queryAllByRole('link', { name: '会員' })).toHaveLength(0)
    expect(view.queryAllByRole('link', { name: '機能設定' })).toHaveLength(0)
  })

  it('畳んだ組の見出しを押すと開き、開いた状態を覚える', async () => {
    const view = await renderSidebar()
    const toggle = view.getAllByRole('button', { name: '自動化' })[0]!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { toggle.click() })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(view.getAllByRole('link', { name: 'オートメーション' }).length).toBeGreaterThan(0)
    expect(window.localStorage.getItem('lh-sidebar-groups')).toContain('"automation":true')
  })

  it('開閉は項目を包みに残して高さで動かす。畳んだ包みは押せず読み上げない（触り心地 5 回目）', async () => {
    const view = await renderSidebar()
    const toggle = view.getAllByRole('button', { name: '自動化' })[0]!
    const box = toggle.parentElement!.querySelector('[data-group-open]')!
    expect(box.getAttribute('data-group-open')).toBe('false')
    expect(box.hasAttribute('inert')).toBe(true)
    expect(box.getAttribute('aria-hidden')).toBe('true')
    await act(async () => { toggle.click() })
    expect(box.isConnected).toBe(true)
    expect(box.getAttribute('data-group-open')).toBe('true')
    expect(box.hasAttribute('inert')).toBe(false)
    expect(box.hasAttribute('aria-hidden')).toBe(false)
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sidebar.module.css'), 'utf8')
    // 動きは「動きを減らす」設定では付けない
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-theme="v8"\] \.sectionItems \{\s*transition:\s*grid-template-rows var\(--motion-base\)/)
    expect(css).toMatch(/\.sectionItemsClosed \{\s*grid-template-rows: 0fr;/)
  })

  it('いまいる画面の組は、畳まれていても開いてその項目を選ばれた形にする', async () => {
    fixture.pathname = '/analytics'
    const view = await renderSidebar()
    // 成果と分析は既定で畳むが、/analytics が中にあるので開く
    expect(view.getAllByRole('link', { name: '分析' }).length).toBeGreaterThan(0)
  })

  it('いちばん下に「設定」が出るのはオーナー・管理者だけ', async () => {
    const view = await renderSidebar()
    const gear = view.getAllByRole('link', { name: '設定' })
    expect(gear.length).toBeGreaterThan(0)
    expect(gear[0]!.getAttribute('href')).toBe('/settings')
    cleanup()

    window.localStorage.setItem('lh_staff_role', 'staff')
    const staffView = await renderSidebar()
    expect(staffView.queryAllByRole('link', { name: '設定' })).toHaveLength(0)
  })

  it('V2 の友だち属性モードでも、v8 では組を丸ごと隠さない', async () => {
    const view = await renderSidebar({ friendAttributesV2Mode: true })
    // v7 では「自動化・予約・設定」の組が消えるが、v8 では見出しが残る
    for (const label of ['自動化', '予約', '設定']) {
      expect(view.getAllByRole('button', { name: label }).length, `組「${label}」が消えている`).toBeGreaterThan(0)
    }
  })

  it('v7 では組の開閉も「設定」の入口も出さず、全項目がそのまま出る', async () => {
    document.documentElement.dataset.theme = 'v7'
    const view = await renderSidebar()
    // 組の見出しはボタンではない（開閉しない）
    expect(view.queryAllByRole('button', { name: '自動化' })).toHaveLength(0)
    // 全項目が常に出る
    expect(view.getAllByRole('link', { name: 'オートメーション' }).length).toBeGreaterThan(0)
    expect(view.getAllByRole('link', { name: '機能設定' }).length).toBeGreaterThan(0)
    // 歯車の「設定」リンクは無い
    expect(view.queryAllByRole('link', { name: '設定' })).toHaveLength(0)
  })

  it('v7 では V2 モードの組隠しが今までどおり効く', async () => {
    document.documentElement.dataset.theme = 'v7'
    const view = await renderSidebar({ friendAttributesV2Mode: true })
    expect(view.queryAllByText('自動化')).toHaveLength(0)
    expect(view.queryAllByText('予約')).toHaveLength(0)
  })
})

describe('統括の左メニューを出す住所', () => {
  it('/hq の下と LINEアカウントの登録は統括、ほかの /accounts は店舗', () => {
    expect(isHqShellPath('/hq')).toBe(true)
    expect(isHqShellPath('/hq/templates')).toBe(true)
    expect(isHqShellPath('/accounts/new')).toBe(true)
    expect(isHqShellPath('/accounts')).toBe(false)
    expect(isHqShellPath('/hqx')).toBe(false)
    expect(isHqShellPath(null)).toBe(false)
  })
})
