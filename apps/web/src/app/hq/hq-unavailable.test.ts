// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement, type ComponentType, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ_MENU_SECTIONS } from '@/lib/menu'

const fixture = vi.hoisted(() => ({
  pathname: '/hq', navigate: vi.fn(), list: vi.fn(), listByKind: vi.fn(),
  kindCounts: vi.fn(), context: vi.fn(), accounts: vi.fn(), folders: vi.fn(), stats: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => fixture.pathname,
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: fixture.navigate, replace: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ children, onClick, href, ...props }: ComponentProps<'a'>) => createElement('a', {
  ...props, href, onClick: (event) => {
    onClick?.(event)
    if (!event.defaultPrevented) fixture.navigate(href)
    event.preventDefault()
  },
}, children) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {}, usePageChrome: () => ({ title: null }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null, loading: false, accounts: [], setSelectedAccountId: vi.fn() }) }))
vi.mock('@/hooks/use-account-style', () => ({ useAccountStyle: () => ({ data: { style: 'standard' }, status: 'ready' }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true, useTenantWideAccess: () => true }))
vi.mock('@/lib/use-brand', () => ({ useBrand: () => ({ name: '試験会社', iconUrl: null }) }))
vi.mock('@/components/hq/account-menu', () => ({ SidebarAccountMenu: () => null }))
vi.mock('@/lib/admin-version-cache', () => ({ loadAdminVersionDetail: async () => null }))
vi.mock('@/components/update/use-update-status', () => ({ useUpdateStatus: () => ({ kind: 'loading' }) }))
vi.mock('@/lib/api/helpers/styles', () => ({ hqStyleApi: { attention: async () => ({ success: true, data: { items: [] } }) } }))
vi.mock('@/lib/hq-templates-api', async (original) => ({
  ...await original<typeof import('@/lib/hq-templates-api')>(),
  hqTemplatesApi: {
    list: fixture.list, listByKind: fixture.listByKind, kindCounts: fixture.kindCounts,
    context: fixture.context, accounts: fixture.accounts, folders: { list: fixture.folders }, listStats: fixture.stats,
  },
}))

import Sidebar from '@/components/layout/sidebar'
import HqFormPage from './form-submissions/page'
import HqTagsPage from './friend-attributes/page'
import HqRichMenusPage from './rich-menus/page'
import HqTemplatesPage from './templates/page'

const CASES: Array<{ href: string; label: string; type: string; search: string; Page: ComponentType }> = [
  { href: '/hq/friend-attributes', label: 'タグ', type: 'tag', search: 'タグ名・用途で探す', Page: HqTagsPage },
  { href: '/hq/templates', label: 'テンプレート', type: 'template', search: '名前・本文・差し込みで探す', Page: HqTemplatesPage },
  { href: '/hq/rich-menus', label: 'リッチメニュー', type: 'rich_menu', search: 'メニュー名・ボタン名', Page: HqRichMenusPage },
  { href: '/hq/form-submissions', label: '回答フォーム', type: 'form', search: 'フォーム名・質問文', Page: HqFormPage },
]

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
  fixture.pathname = '/hq'
  fixture.list.mockResolvedValue([])
  fixture.listByKind.mockResolvedValue([])
  fixture.kindCounts.mockResolvedValue({ message: 0 })
  fixture.context.mockResolvedValue({ tenantId: 'tenant-test', actorId: 'owner-test' })
  fixture.accounts.mockResolvedValue([])
  fixture.folders.mockResolvedValue([])
  fixture.stats.mockResolvedValue({ thisMonthSentCount: 0, outdatedTemplateCount: 0 })
})
afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear() })

describe('統括の配布画面への入口', () => {
  it('メニュー定義の4つの住所を保つ', () => {
    const hrefs = HQ_MENU_SECTIONS.flatMap((section) => section.items).map((item) => item.href)
    for (const { href } of CASES) expect(hrefs).toContain(href)
  })

  it.each(CASES)('$labelのサイドバーのリンクから機能の住所へ進める', ({ href, label }) => {
    const view = render(createElement(Sidebar))
    const desktop = within(view.container.querySelector('aside:not(#mobile-menu)') as HTMLElement)
    const link = desktop.getByRole('link', { name: label })
    expect(link.getAttribute('href')).toBe(href)
    fireEvent.click(link)
    expect(fixture.navigate).toHaveBeenCalledWith(href)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it.each(CASES)('$labelの直接URLで実際の一覧を読み、検索を使える', async ({ href, type, search, Page }) => {
    fixture.pathname = href
    window.history.replaceState(null, '', href)
    const row = { id: 'template-test', name: '検査用のひな形', template_type: type, revision: 1, updated_at: '2026-10-22T00:00:00Z', kind: 'message' }
    fixture.list.mockResolvedValue([row])
    fixture.listByKind.mockResolvedValue([row])
    render(createElement(Page))
    await waitFor(() => expect(fixture.list).toHaveBeenCalledWith(type))
    const page = within(document.body)
    expect(await page.findByRole('link', { name: '検査用のひな形' })).toBeTruthy()
    const input = page.getByPlaceholderText(search)
    fireEvent.change(input, { target: { value: '一致しない名前' } })
    await waitFor(() => expect(page.queryByRole('link', { name: '検査用のひな形' })).toBeNull())
    fireEvent.change(input, { target: { value: '' } })
    expect(await page.findByRole('link', { name: '検査用のひな形' })).toBeTruthy()
    expect(page.queryByText('まだ使えません')).toBeNull()
  })

  it('旧テーマの機能停止と代替ページを戻さない', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const sidebar = readFileSync(join(here, '../../components/layout/sidebar.tsx'), 'utf8')
    const form = readFileSync(join(here, 'form-submissions/page.tsx'), 'utf8')
    expect(sidebar).not.toContain('HQ_TEMPLATE_DISTRIBUTION_ENABLED')
    expect(sidebar).not.toContain('HQ_UNAVAILABLE_DISTRIBUTION_HREFS')
    expect(form).not.toContain('TargetMissing')
  })
})
