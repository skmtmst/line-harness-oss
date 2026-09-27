// @vitest-environment happy-dom
/*
 * P（一覧の数・実マウント）：今月は日本時間の1日から数え、
 * 完了率 ＝ 今月の回答完了 ÷ 今月開いた人。取れていない数は「—」だけ出す。
 * 死んでいた今週表示は出さない。定義は見出し横の「？」に入れる。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchApi = vi.hoisted(() => vi.fn())
const apiFolders = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, fetchApi, api: { ...(actual as unknown as { api: object }).api, folders: apiFolders } }
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

const baseForm = {
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
  usedByAccounts: [],
  submitCount: 100,
}
const formMonthly = {
  ...baseForm,
  id: 'f-monthly',
  name: '今月のフォーム',
  folderId: null,
  monthlySubmitCount: 12,
  monthlyOpenCount: 24,
  monthlyCompletionRate: 50,
}
const formUnknown = {
  ...baseForm,
  id: 'f-unknown',
  name: '未取得のフォーム',
  folderId: null,
  monthlySubmitCount: null,
  monthlyOpenCount: null,
  monthlyCompletionRate: null,
}

beforeEach(() => {
  const storage = new MemoryStorage()
  storage.setItem('lh_staff_role', 'admin')
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  fetchApi.mockImplementation(async () => ({
    success: true,
    data: { items: [formMonthly, formUnknown], total: 2, all_total: 2, page: 1, limit: 20 },
  }))
  apiFolders.list.mockImplementation(async () => ({ success: true, data: [] }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

describe('一覧の今月の数（P・実マウント）', () => {
  it('今月の件数と完了率を出し、未取得は「—」にする', async () => {
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    await act(async () => {})
    expect(host.textContent).toContain('今月 12件')
    expect(host.textContent).toContain('完了率 50%')
    expect(host.textContent).toContain('今月 —')
    expect(host.textContent).toContain('完了率 —')
    // 「？」は見出しに1つだけ。行には置かない（7行に7個並ぶ騒がしさを避ける）。
    const helps = host.querySelectorAll('button[aria-label="今月の完了率の説明"]')
    expect(helps.length).toBe(1)
    expect(helps[0].closest('thead')).toBeTruthy()
    expect(host.querySelectorAll('tbody button[aria-label="今月の完了率の説明"]').length).toBe(0)
  })

  it('死んでいた今週表示は出さない', async () => {
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    await act(async () => {})
    expect(host.textContent).not.toContain('今週')
  })
})
