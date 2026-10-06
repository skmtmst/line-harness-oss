// @vitest-environment happy-dom
/**
 * V8 回答フォームの通し試験（見た目のみ）。
 * 流れ：作る→下書き保存→公開→一覧に戻ると増えている。
 * 各段で「押せる・保存後の知らせ・一覧の変化」を確かめる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyLayout } from '@line-crm/shared'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const navigation = vi.hoisted(() => ({
  pathname: '/form-submissions',
  query: '',
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
  useParams: () => ({}),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const accountValue = vi.hoisted(() => ({
  accounts: [{ id: 'acc-1', name: 'テスト店' }],
  selectedAccountId: 'acc-1',
  selectedAccount: { id: 'acc-1', name: 'テスト店' },
  loading: false,
  error: '',
  selectAccount: () => {},
  reloadAccounts: async () => {},
  canManage: true,
  role: 'admin',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => accountValue,
}))

const emptyList = vi.hoisted(() => async () => ({ success: true, data: [] as never[] }))
const formsGet = vi.hoisted(() => vi.fn())
const formsUpdate = vi.hoisted(() => vi.fn())
const formsPublish = vi.hoisted(() => vi.fn())
const formsCreateDraft = vi.hoisted(() => vi.fn())
const fetchApiMock = vi.hoisted(() => vi.fn())
const listStatsGet = vi.hoisted(() => vi.fn())
const foldersList = vi.hoisted(() => vi.fn())

const store = vi.hoisted(() => ({ forms: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi: fetchApiMock,
    api: {
      ...actual.api,
      forms: {
        ...actual.api.forms,
        get: formsGet,
        update: formsUpdate,
        publish: formsPublish,
        createDraft: formsCreateDraft,
        submitCount: vi.fn(async () => ({ success: true, data: { count: 0 } })),
      },
      folders: { list: foldersList },
      listStats: { get: listStatsGet },
      tags: { list: emptyList },
      friendFields: { list: emptyList },
      scenarios: { ...actual.api.scenarios, list: emptyList },
      reminders: { ...actual.api.reminders, list: emptyList },
      templates: { ...actual.api.templates, list: emptyList },
      staff: { me: vi.fn(async () => ({ success: true, data: { role: 'owner' } })) },
      formsShared: {
        options: vi.fn(async () => ({
          success: true,
          data: { userAttributes: [], tags: [], triggerScenarios: [], formRefs: [] },
        })),
      },
      publicFormSettings: { get: vi.fn(async () => ({ success: false })) },
      accounts: { list: emptyList },
      auth: { check: vi.fn(async () => ({ success: true })) },
    },
  }
})

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
  usePageChrome: () => ({ title: '' }),
}))

import FormSubmissionsPage from './page'
import EditFormPage from './edit/page'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const fixtureLayout = (() => {
  const layout = emptyLayout()
  layout.sections[0].name = 'ページ1'
  layout.sections[0].blocks = [
    { id: 'b1', kind: 'heading', text: 'アンケート' },
    { id: 'b2', kind: 'input', type: 'text', name: 'memo', label: 'ひとこと', required: false },
    { id: 'b3', kind: 'button', label: '送信する', url: '' },
  ] as never
  return layout
})()

function formRow(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    fields: [],
    layout: fixtureLayout,
    onSubmitTagId: null,
    isActive: true,
    status: 'active',
    revision: 1,
    folderId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    lastSubmittedAt: null,
    usedByAccounts: [],
  }
}

const apiFormData = {
  id: 'form-1',
  lineAccountId: 'acc-1',
  name: '流れのフォーム',
  description: '',
  isActive: 0,
  onSubmitTagId: null,
  layout: fixtureLayout,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  contentRevision: 1,
  publishedVersionId: null,
  publicSlug: 'form-1',
  urlKey: null,
  expiresAt: null,
  maxSubmissions: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderNode(node: React.ReactNode) {
  act(() => {
    root.render(<>{node}<ToastHost /></>)
  })
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

beforeEach(() => {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  if (!g.crypto) g.crypto = {}
  if (!g.crypto.randomUUID) g.crypto.randomUUID = () => 'test-uuid-1'
  document.documentElement.dataset.theme = 'v8'
  // 板 JV2oR（閲覧のみ）：作る操作は localStorage の役職で決まる。試験では店長として通す。
  // このファイルの happy-dom には localStorage が無いので、無ければ小さな置き換えを置く。
  const w = window as unknown as { localStorage?: Storage }
  if (!w.localStorage) {
    const bag = new Map<string, string>()
    w.localStorage = {
      getItem: (k: string) => bag.get(k) ?? null,
      setItem: (k: string, v: string) => { bag.set(k, String(v)) },
      removeItem: (k: string) => { bag.delete(k) },
      clear: () => { bag.clear() },
      key: () => null,
      get length() { return bag.size },
    } as Storage
  }
  window.localStorage.setItem('lh_staff_role', 'owner')
  store.forms = [formRow('form-1', '流れのフォーム')]
  fetchApiMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/forms')) {
      return { success: true, data: { items: store.forms, total: store.forms.length, page: 1, limit: 20 } }
    }
    return { success: true, data: [] }
  })
  foldersList.mockImplementation(async () => ({ success: true, data: [], unfiledCount: 0 }))
  listStatsGet.mockImplementation(async () => ({ success: true, data: {} }))
  formsCreateDraft.mockImplementation(async () => ({ success: true, data: { id: 'form-new' } }))
  formsGet.mockImplementation(async () => ({ success: true, data: { ...apiFormData } }))
  formsUpdate.mockImplementation(async () => ({
    success: true,
    data: { id: 'form-1', contentRevision: 2, updatedAt: '' },
  }))
  formsPublish.mockImplementation(async () => ({ success: true, data: { id: 'v1' } }))
  navigation.query = ''
  navigation.pathname = '/form-submissions'
  navigation.push.mockClear()
  navigation.replace.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  clearToastsForTest()
  delete document.documentElement.dataset.theme
  window.localStorage.removeItem('lh_staff_role')
  vi.clearAllMocks()
})

describe('V8 回答フォームの通し：作る→保存→公開→一覧', () => {
  it('「＋ フォームを作る」で下書きが作られて編集へ進む', async () => {
    renderNode(<FormSubmissionsPage />)
    await flush()
    await screen.findByText('流れのフォーム')
    // 一覧は src/v8/forms/list（「＋」は印。読み上げ名は「フォームを作る」）。
    const creates = screen.getAllByRole('button', { name: 'フォームを作る' })
    expect(creates.length).toBeGreaterThan(0)
    fireEvent.click(creates[0])
    await waitFor(() => expect(formsCreateDraft).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/form-submissions/edit?id=form-new&tab=basic'))
  })

  it('下書き保存→知らせ→公開→知らせ・一覧に戻ると増えている', async () => {
    // V8 の編集（src/v8/form-edit）。フォーム名の欄は「受付と見た目」のタブにある。
    navigation.query = 'id=form-1&tab=appearance'
    navigation.pathname = '/form-submissions/edit'
    renderNode(<EditFormPage />)
    await flush()
    await screen.findByDisplayValue('流れのフォーム')

    // 下書きを保存する（画面の知らせとトーストの両方に出る）。
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(formsUpdate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getAllByText('下書きを保存しました')).toHaveLength(2))

    // この版を公開する（公開の確かめ Z9wXm が出るので窓の中でもう一度押す。
    // 画面の知らせとトーストの両方に出る）。
    fireEvent.click(screen.getByRole('button', { name: 'この版を公開' }))
    const publishDialog = await screen.findByRole('dialog', { name: 'この版を公開する' })
    fireEvent.click(within(publishDialog).getByRole('button', { name: 'この版を公開' }))
    await waitFor(() => expect(formsPublish).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getAllByText('この版を公開しました')).toHaveLength(2))

    // 一覧に戻ると増えている。
    store.forms = [...store.forms, formRow('form-new', '流れの型2')]
    navigation.query = ''
    navigation.pathname = '/form-submissions'
    renderNode(<FormSubmissionsPage />)
    await flush()
    await screen.findByText('流れの型2')
  })
})
