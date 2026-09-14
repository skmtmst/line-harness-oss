// @vitest-environment happy-dom
/*
 * 管理者確認専用ビュー(#724)を本物のReactで動かす試験。
 *
 * 見るのは3つだけ: 通常一覧へ未割当が混ざらないこと、専用ビューで
 * バッジと説明が出ること、権限が無い人には空の案内が出ること。
 * Required PR gate の `pnpm --filter web test` で必ず実行される。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchApi = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, fetchApi }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', loading: false }),
}))

import FormSubmissionsPage from './page'
import { ApiError } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const normalForm = {
  id: 'form-assigned',
  name: '割当済みフォーム',
  description: null,
  fields: [],
  layout: { version: 2, header: [], sections: [], options: {} },
  onSubmitTagId: null,
  isActive: true,
  status: 'active',
  revision: 1,
  createdAt: '2026-08-01',
  updatedAt: '2026-08-02',
  lastSubmittedAt: null,
  usedByAccounts: [{ id: 'account-a', name: 'A店', country: 'JP', displayOrder: 1, count: 2 }],
}
const unassignedForm = {
  ...normalForm,
  id: 'form-legacy',
  name: '旧フォーム要確認',
  usedByAccounts: [],
  accountScopeReviewRequired: true,
}

function mockDefault() {
  fetchApi.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/forms/unassigned')) {
      return { success: true, data: [unassignedForm] }
    }
    if (path.startsWith('/api/forms?')) {
      return { success: true, data: { items: [normalForm], total: 1, page: 1, limit: 1 } }
    }
    if (path.startsWith('/api/folders?')) {
      return { success: true, data: [] }
    }
    throw new Error(`unexpected: ${path}`)
  })
}

async function render() {
  await act(async () => { root.render(React.createElement(FormSubmissionsPage)) })
}

function byExactText(tag: string, text: string): HTMLElement {
  const found = Array.from(host.querySelectorAll(tag)).find((el) => el.textContent?.trim() === text)
  if (!found) throw new Error(`見つかりません: <${tag}> "${text}"`)
  return found as HTMLElement
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  mockDefault()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('回答フォーム一覧の管理者確認(#724)', () => {
  it('通常一覧には未割当が混ざらず専用口も叩かない', async () => {
    await render()
    expect(host.textContent).toContain('割当済みフォーム')
    expect(host.textContent).not.toContain('旧フォーム要確認')
    expect(fetchApi.mock.calls.some(([path]) => String(path).startsWith('/api/forms/unassigned'))).toBe(false)
  })

  it('専用ビューで未割当だけが出てバッジと#771説明が出る', async () => {
    await render()
    await click(byExactText('button', '管理者確認（担当未割当）'))
    expect(fetchApi.mock.calls.some(([path]) => String(path).startsWith('/api/forms/unassigned'))).toBe(true)
    expect(host.textContent).toContain('旧フォーム要確認')
    expect(host.textContent).toContain('管理者確認')
    expect(host.textContent).toContain('#771')
    // 割り当て操作は置かない
    expect(host.querySelector('td button')).toBeNull()
  })

  it('専用口が403なら確認できるものは無いと案内する', async () => {
    fetchApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/forms/unassigned')) throw new ApiError(403)
      if (path.startsWith('/api/forms?')) {
        return { success: true, data: { items: [normalForm], total: 1, page: 1, limit: 1 } }
      }
      return { success: true, data: [] }
    })
    await render()
    await click(byExactText('button', '管理者確認（担当未割当）'))
    expect(host.textContent).toContain('確認できる未割当フォームはありません')
  })
})
