// @vitest-environment happy-dom
/*
 * 実際の共通編集部品とPageChromeProviderを使う。
 * 保存して編集部品が外れたときも、統括のパンくずと一覧への操作を保つ。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => Object.fromEntries(['context', 'list', 'listByKind', 'kindCounts', 'accounts', 'get', 'create', 'update', 'remove', 'duplicate', 'preflight', 'distribute', 'result', 'messageReferences', 'folderList', 'deleteImage', 'uploadRichMessageImage', 'uploadImage', 'listStats', 'versions', 'receivedVersions', 'compareVersions', 'restoreVersion'].map((key) => [key, vi.fn()])))
const push = vi.hoisted(() => vi.fn())
const selectAccount = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api,
    lineAccounts: { ...actual.api.lineAccounts, list: vi.fn(async () => ({ success: true, data: [
      { id: 'a-1', name: '然 -NEN- 本店', folderId: 'direct' }, { id: 'a-2', name: '然 -NEN- 渋谷店', folderId: 'direct' },
    ] })) },
    lineAccountFolders: { ...actual.api.lineAccountFolders, list: vi.fn(async () => ({ success: true, data: { folders: [{ id: 'direct', name: '直営店', color: '#2563eb', displayOrder: 0 }] } })) },
  } }
})
vi.mock('@/lib/hq-templates-api', async (original) => ({ ...await original<typeof import('@/lib/hq-templates-api')>(), TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form', 'scenario'], hqTemplatesApi: { ...calls, folders: { list: calls.folderList } } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq/templates',
}))
vi.mock('@/lib/staff-role', () => ({ useTenantWideAccess: () => true, useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [], selectedAccountId: null, selectedAccount: null, setSelectedAccountId: selectAccount, loading: false }) }))
import { PageChromeProvider, usePageChrome, usePageCrumbs, type PageCrumb } from '@/components/shell/page-chrome'
let crumbs: PageCrumb[] | null = null
function ChromeProbe() { crumbs = usePageChrome().crumbs; return null }
vi.mock('@/components/auto-replies/inline-action-list', () => ({ useActionOptions: () => ({ tags: [], scenarios: [], templates: [], forms: [], reminders: [], richMenus: [] }) }))

import HqTemplatesV8 from './console'
import CarouselV8 from '@/v8/templates/carousel'
import QuestionNewV8 from '@/v8/templates/question-new'

const message = {
  schemaVersion: 1,
  template: { id: 'hq-authored-message', name: '予約前日のご案内', category: 'general', messageType: 'text', messageContent: '{{name}}さん、明日のご予約です', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' },
  media: [],
}
const detail = (definition: unknown = message) => ({ template: { id: 't-1', name: '予約前日のご案内', description: '', template_type: 'template', folder_id: null, revision: 3, updated_at: '2026-08-21T09:02:00Z' }, definition })
const listRow = { ...detail().template, kind: 'message', content_summary: '本文', distributed_account_count: 4, distributed_account_names: ['然 -NEN- 本店', '然 -NEN- 渋谷店', '2025年イベント'], distributed_account_more: 1 }

beforeEach(() => {
  window.history.replaceState(null, '', '/hq/templates')
  window.sessionStorage.clear()
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.list.mockResolvedValue([listRow])
  calls.listByKind.mockResolvedValue([listRow])
  calls.kindCounts.mockResolvedValue({ message: 1, carousel: 0, rich_message: 0, question: 0, coupon: 0, research: 0 })
  calls.accounts.mockResolvedValue([{ id: 'a-1', name: '然 -NEN- 本店' }, { id: 'a-2', name: '然 -NEN- 渋谷店' }])
  calls.folderList.mockResolvedValue([{ id: 'f-1', name: '予約', revision: 1 }])
  calls.messageReferences.mockResolvedValue([])
  calls.listStats.mockResolvedValue({ thisMonthSentCount: 0, outdatedTemplateCount: 0 })
  calls.versions.mockResolvedValue([])
  calls.receivedVersions.mockResolvedValue([])
  calls.get.mockResolvedValue(detail())
  calls.preflight.mockResolvedValue({ preflightId: 'pf-1', expiresAt: new Date(Date.now() + 60000).toISOString(), stores: [{ accountId: 'a-1', accountName: '然 -NEN- 本店', items: [], warnings: [] }] })
  calls.create.mockImplementation(async (input: { name: string; definition: unknown }) => ({ template: { ...detail().template, id: 't-new', name: input.name }, definition: input.definition }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('実際の統括編集とパンくずの所有', () => {
  it.each(['カルーセル', '質問'])('%s：埋め込んだ編集を開閉しても親の一覧へ戻る操作を残す', async (kind) => {
    const back = vi.fn()
    function Parent() {
      const [open, setOpen] = React.useState(false)
      usePageCrumbs([{ label: '一括配信', href: '/hq/broadcasts', onSelect: back }])
      const host = { description: '統括の編集', folders: [], folder: '', onFolderChange: vi.fn(), busy: false, onSave: vi.fn(), onCancel: vi.fn() }
      return <><button onClick={() => setOpen(!open)}>編集の開閉</button>{open ? kind === 'カルーセル' ? <CarouselV8 host={host} /> : <QuestionNewV8 host={host} /> : null}</>
    }
    render(<PageChromeProvider><Parent /><ChromeProbe /></PageChromeProvider>)
    await waitFor(() => expect(crumbs?.[0]?.href).toBe('/hq/broadcasts'))
    fireEvent.click(screen.getByRole('button', { name: '編集の開閉' }))
    await waitFor(() => expect(crumbs?.[0]?.href).toBe('/hq/broadcasts'))
    fireEvent.click(screen.getByRole('button', { name: '編集の開閉' }))
    await waitFor(() => expect(crumbs?.[0]?.href).toBe('/hq/broadcasts'))
    act(() => crumbs![0].onSelect!())
    expect(back).toHaveBeenCalledOnce()
  })
  it.each(['カルーセル', '質問'])('%s：編集中と保存後も統括のパンくずを保ち、一覧へ戻れる', async (kind) => {
    render(<PageChromeProvider><HqTemplatesV8 type="template" /><ChromeProbe /></PageChromeProvider>)
    fireEvent.click(await screen.findByRole('tab', { name: new RegExp(kind) }))
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    await screen.findByRole('heading', { name: `${kind}を作る` })
    expect(crumbs?.find((item) => item.href === '/templates')).toBeUndefined()
    expect(crumbs?.find((item) => item.href === '/hq/templates')?.onSelect).toBeTypeOf('function')
    fireEvent.change(screen.getByPlaceholderText(kind === '質問' ? '例：継続の意思をうかがう' : '例：夏の定番5点'), { target: { value: '案内' } })
    fireEvent.change(screen.getByLabelText(kind === '質問' ? /^質問文/ : /本文（/), { target: { value: 'どちらにしますか？' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await screen.findByRole('dialog', { name: '保存しました。アカウントに配りますか？' })
    await waitFor(() => expect(crumbs?.find((item) => item.href === '/')?.label).toBe('ホーム'))
    fireEvent.click(screen.getByRole('checkbox', { name: /本店/ }))
    fireEvent.click(screen.getByRole('button', { name: '1 アカウントへ配る' }))
    await screen.findByRole('heading', { name: 'アカウントへ配る：案内' })
    expect(document.querySelector('[data-page-template="distribution"]')).toBeTruthy()
    await waitFor(() => expect(crumbs?.find((item) => item.href === '/hq/templates')?.onSelect).toBeTypeOf('function'))
    act(() => crumbs!.find((item) => item.href === '/hq/templates')!.onSelect!())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await screen.findAllByRole('button', { name: /テンプレートを作る/ })).length).toBeGreaterThan(0)
  })
})
