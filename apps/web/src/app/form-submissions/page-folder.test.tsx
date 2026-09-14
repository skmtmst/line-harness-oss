// @vitest-environment happy-dom
/*
 * N-175 (#805): フォルダ選択をサーバーへ渡すことを実マウントで確かめる。
 * サーバーが返した一覧をそのまま描き、画面内でフォルダ絞りしないこと。
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

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const calls: string[] = []

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
}
const formA = { ...baseForm, id: 'f-a1', name: '箱フォーム', folderId: 'fol-a' }
const formUnfiled = { ...baseForm, id: 'f-a2', name: '未分類フォーム', folderId: null }
// サーバーが folderId 不一致の行を返しても描く(正本はサーバー)。
const formOther = { ...baseForm, id: 'f-x', name: '他箱のはずが返った行', folderId: 'other' }

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  calls.length = 0
  fetchApi.mockImplementation(async (url: string) => {
    calls.push(url)
    if (url.startsWith('/api/folders')) {
      return { success: true, data: [{ id: 'fol-a', name: 'A箱', formCount: 1 }] }
    }
    if (url.includes('folder_id=fol-a')) {
      return { success: true, data: { items: [formOther], total: 1 } }
    }
    return { success: true, data: { items: [formA, formUnfiled], total: 2 } }
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

async function clickFolder(label: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
  expect(button).toBeTruthy()
  await act(async () => {
    button!.click()
  })
}

describe('フォルダ選択はサーバーへ渡す（N-175・実マウント）', () => {
  it('箱を選ぶとfolder_id付きで取り直す', async () => {
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    await clickFolder('A箱')
    expect(calls.some((url) => url.includes('folder_id=fol-a'))).toBe(true)
  })

  it('サーバーが返した行はfolder不一致でも描く', async () => {
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    await clickFolder('A箱')
    await act(async () => {})
    expect(host.textContent).toContain('他箱のはずが返った行')
  })
})
