// @vitest-environment happy-dom
/*
 * カードの画像URLが https だけを受け付けるかの試験（FORM-18 / #1061）。
 *
 * 欄には「https で始まるURLだけ使えます」と書いてあるのに、
 * http:// のURLが保存できて残っていた。見る筋書き:
 *   1. http:// を入れると、その場で理由が出る（入力は消さない）。
 *   2. そのまま「下書きを保存」を押しても送らず、理由を出す。
 *   3. https:// に直すと保存でき、trim したURLが送られる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiForm } from '@/lib/api'

const navigation = vi.hoisted(() => ({
  pathname: '/form-submissions/edit',
  query: 'id=form-1&tab=design',
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
const formsUpdate = vi.hoisted(() => vi.fn())
const emptyList = vi.hoisted(() => async () => ({ success: true, data: [] as never[] }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    // ページは参照一覧を素の fetchApi で取る。通信が要ると試験が環境へ
    // 依存するので、ここで空の一覧を返す。
    fetchApi: vi.fn(async () => ({ success: true, data: [] })),
    api: {
      ...actual.api,
      forms: {
        ...actual.api.forms,
        get: formsGet,
        update: formsUpdate,
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

// api.ts は読み込み時に NEXT_PUBLIC_API_URL を要求する。ページの
// import より先に立てておく（Vite はファイル順に評価する）。
process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'

import { emptyLayout } from '@line-crm/shared'
import EditFormPage from './page'
import { OG_IMAGE_URL_ERROR } from './form-validate'

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

const apiFormData = {
  id: 'form-1',
  lineAccountId: 'acc-1',
  name: '読み込んだフォーム名',
  description: '',
  isActive: 0,
  onSubmitTagId: null,
  layout: fixtureLayout,
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
  window.history.replaceState(null, '', '/form-submissions/edit?id=form-1&tab=design')
  navigation.query = 'id=form-1&tab=design'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  formsGet.mockReset()
  formsUpdate.mockReset()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function show(over: Partial<ApiForm> = {}) {
  formsGet.mockResolvedValue({ success: true, data: { ...apiFormData, ...over } })
  await act(async () => { root.render(<EditFormPage />) })
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

function ogInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('#form-og-image-url')
  expect(input, 'カードの画像URLの欄がある').toBeTruthy()
  return input!
}

function setOgUrl(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  const input = ogInput()
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function clickSave() {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === '下書きを保存' && !b.disabled)
  expect(button, '「下書きを保存」がある').toBeTruthy()
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let step = 0; step < 10; step += 1) await Promise.resolve()
  })
}

describe('カードの画像URLは https だけ（FORM-18）', () => {
  it('http:// を入れると理由が出て、入力はそのまま残る', async () => {
    await show()
    await act(async () => { setOgUrl('http://example.com/og.png') })
    expect(ogInput().value).toBe('http://example.com/og.png')
    expect(host.querySelector('#form-og-image-url-error')?.textContent).toBe(OG_IMAGE_URL_ERROR)
  })

  it('http:// のままでは保存を送らず、理由を出す', async () => {
    await show()
    await act(async () => { setOgUrl('http://example.com/og.png') })
    await clickSave()
    expect(formsUpdate).not.toHaveBeenCalled()
    expect(host.textContent).toContain(OG_IMAGE_URL_ERROR)
    // 入力は消えない。直してもう一度保存できる。
    expect(ogInput().value).toBe('http://example.com/og.png')
  })

  it('https:// に直すと保存でき、trimしたURLを送る', async () => {
    formsUpdate.mockResolvedValue({ success: true, data: { contentRevision: 2 } })
    await show()
    await act(async () => { setOgUrl('  https://cdn.example.com/og.png  ') })
    expect(host.querySelector('#form-og-image-url-error')).toBeNull()
    await clickSave()
    expect(formsUpdate).toHaveBeenCalledTimes(1)
    expect(formsUpdate.mock.calls[0][2]).toMatchObject({ ogImageUrl: 'https://cdn.example.com/og.png' })
  })

  it('空欄は「設定しない」として保存できる', async () => {
    formsUpdate.mockResolvedValue({ success: true, data: { contentRevision: 2 } })
    await show({ ogImageUrl: 'https://cdn.example.com/og.png' })
    await act(async () => { setOgUrl('') })
    await clickSave()
    expect(formsUpdate).toHaveBeenCalledTimes(1)
    expect(formsUpdate.mock.calls[0][2]).toMatchObject({ ogImageUrl: null })
  })
})
