// @vitest-environment happy-dom
/*
 * 回答フォーム編集の「その場で確かめる入力」。
 * フォーム名の欄を離れたとき（blur）に直し方を欄の下へ出す。
 * 文は保存時と同じ。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiForm } from '@/lib/api'
import { emptyLayout } from '@line-crm/shared'

const navigation = vi.hoisted(() => ({
  pathname: '/form-submissions/edit',
  query: 'id=form-1&tab=basic',
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

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    accounts: [{ id: 'acc-1', name: 'テスト店' }],
    selectedAccountId: 'acc-1',
    selectedAccount: { id: 'acc-1', name: 'テスト店' },
    loading: false,
    error: '',
    selectAccount: () => {},
    reloadAccounts: async () => {},
    canManage: true,
    role: 'admin',
  }),
}))

const formsGet = vi.hoisted(() => vi.fn())
const emptyList = vi.hoisted(() => async () => ({ success: true, data: [] as never[] }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi: vi.fn(async () => ({ success: true, data: [] })),
    api: {
      ...actual.api,
      forms: {
        ...actual.api.forms,
        get: formsGet,
        update: vi.fn(async () => ({ success: true })),
        publish: vi.fn(async () => ({ success: true, data: { id: 'v1' } })),
        submitCount: vi.fn(async () => ({ success: true, data: { count: 0 } })),
      },
      tags: { list: emptyList },
      friendFields: { list: emptyList },
      scenarios: { ...actual.api.scenarios, list: emptyList },
      reminders: { ...actual.api.reminders, list: emptyList },
      templates: { ...actual.api.templates, list: emptyList },
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

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import EditFormPage from './page'

const apiFormData = {
  id: 'form-1',
  lineAccountId: 'acc-1',
  name: '読み込んだフォーム名',
  description: '読み込んだ説明',
  isActive: 0,
  onSubmitTagId: null,
  layout: emptyLayout(),
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  contentRevision: 1,
  publicSlug: 'form-1',
  urlKey: null,
  expiresAt: null,
  maxSubmissions: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState(null, '', '/form-submissions/edit?id=form-1&tab=basic')
  navigation.query = 'id=form-1&tab=basic'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  formsGet.mockReset()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function show() {
  formsGet.mockResolvedValue({ success: true, data: { ...apiFormData } })
  await act(async () => { root.render(<EditFormPage />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

function nameInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('#fm-name')
  if (!input) throw new Error('フォーム名の欄がない')
  return input
}

describe('回答フォーム編集の名前欄を離れたときの確かめ', () => {
  it('空にして離れると保存前に欄の下へ直し方が出る', async () => {
    await show()
    expect(nameInput().value).toBe('読み込んだフォーム名')

    await act(async () => { fireEvent.change(nameInput(), { target: { value: '' } }) })
    await act(async () => { fireEvent.blur(nameInput()) })
    expect(host.textContent).toContain('フォーム名を入力してください')
  })

  it('入れ直すと直し方が消える', async () => {
    await show()

    await act(async () => { fireEvent.change(nameInput(), { target: { value: '' } }) })
    await act(async () => { fireEvent.blur(nameInput()) })
    expect(host.textContent).toContain('フォーム名を入力してください')

    await act(async () => { fireEvent.change(nameInput(), { target: { value: '直した名前' } }) })
    expect(host.textContent).not.toContain('フォーム名を入力してください')
  })
})
