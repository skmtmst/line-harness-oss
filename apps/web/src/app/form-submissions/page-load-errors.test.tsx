// @vitest-environment happy-dom
/*
 * R602・R603: 回答フォーム一覧の失敗案内を言い分ける（実マウント）。
 *
 * - R602: `GET /api/forms` の 403 は権限不足（管理者への依頼・再試行なし）、
 *   503 は通信失敗（再試行あり）で出す。どちらも同じ「表示できませんでした」
 *   に畳まない。
 * - R603: フォルダだけ 503 のとき、取得済みのフォーム一覧と件数を残し、
 *   フォルダ欄だけ失敗と再試行を出す。全面エラー・0件にしない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchApi = vi.hoisted(() => vi.fn())
const apiFolders = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  swapOrder: vi.fn(),
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
const formB = { ...baseForm, id: 'f-a2', name: '未分類フォーム', folderId: null }

const folderA = { id: 'fol-a', kind: 'form', name: 'A箱', parentId: null, displayOrder: 0, color: null }

function mockFormsOk() {
  fetchApi.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/forms?')) {
      return { success: true, data: { items: [formA, formB], total: 2, all_total: 2 } }
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function mockFoldersOk() {
  apiFolders.list.mockImplementation(async () => ({ success: true, data: [folderA] }))
}

beforeEach(() => {
  // V8だけ見る（v7側は触らない）。この印でV8を出す。
  document.documentElement.dataset.theme = 'v8'
  const storage = new MemoryStorage()
  storage.setItem('lh_staff_role', 'admin')
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  mockFormsOk()
  mockFoldersOk()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

async function mount() {
  await act(async () => {
    root.render(<FormSubmissionsPage />)
  })
  await act(async () => {})
}

function retryButtons(): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')].filter(
    (b) => b.textContent === 'もう一度試す',
  ) as HTMLButtonElement[]
}

describe('R602: フォーム取得の失敗は403と503で言い分ける', () => {
  it('403は権限不足と管理者への依頼を出し、再試行は出さない', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/forms?')) throw new ApiError(403, 'Forbidden')
      throw new Error(`unexpected fetch: ${url}`)
    })
    await mount()
    expect(host.textContent).toContain('見る権限がありません')
    expect(host.textContent).toContain('担当・役割')
    expect(retryButtons()).toHaveLength(0)
    expect(host.textContent).not.toContain('箱フォーム')
  })

  it('429は混み合いの案内と再試行を出す', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/forms?')) throw new ApiError(429, 'Too Many Requests')
      throw new Error(`unexpected fetch: ${url}`)
    })
    await mount()
    expect(host.textContent).toContain('混み合っています')
    expect(retryButtons()).toHaveLength(1)
  })

  it('503は表示できない旨と再試行を出す', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/forms?')) throw new ApiError(503, 'Service Unavailable')
      throw new Error(`unexpected fetch: ${url}`)
    })
    await mount()
    expect(host.textContent).toContain('回答フォームを読み込めませんでした')
    expect(retryButtons()).toHaveLength(1)
  })

  it('再試行で直れば一覧が出る', async () => {
    let failing = true
    fetchApi.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/forms?')) {
        if (failing) throw new ApiError(503, 'Service Unavailable')
        return { success: true, data: { items: [formA, formB], total: 2, all_total: 2 } }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    await mount()
    expect(host.textContent).toContain('回答フォームを読み込めませんでした')
    failing = false
    await act(async () => {
      retryButtons()[0]!.click()
    })
    await act(async () => {})
    expect(host.textContent).toContain('箱フォーム')
    expect(host.textContent).not.toContain('回答フォームを読み込めませんでした')
  })
})

describe('R603: フォルダだけ失敗しても一覧と件数を残す', () => {
  it('フォーム7件相当の一覧と件数を残し、フォルダ欄だけ失敗と再試行を出す', async () => {
    apiFolders.list.mockImplementation(async () => {
      throw new ApiError(503, 'Service Unavailable')
    })
    await mount()
    // 取得済みのフォームは残る。
    expect(host.textContent).toContain('箱フォーム')
    expect(host.textContent).toContain('未分類フォーム')
    // 件数も残る（全面エラー・0件にしない）。
    expect(host.textContent).toContain('2件中')
    expect(host.textContent).not.toContain('回答フォームを読み込めませんでした')
    // フォルダ欄だけ失敗と再試行。
    expect(host.textContent).toContain('フォルダを読み込めませんでした。')
    const folderRetry = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'もう一度',
    )
    expect(folderRetry).toBeTruthy()
  })

  it('フォルダの再試行で直れば箱が出る', async () => {
    let failing = true
    apiFolders.list.mockImplementation(async () => {
      if (failing) throw new ApiError(503, 'Service Unavailable')
      return { success: true, data: [folderA] }
    })
    await mount()
    expect(host.textContent).toContain('フォルダを読み込めませんでした。')
    failing = false
    await act(async () => {
      const folderRetry = [...host.querySelectorAll('button')].find(
        (b) => b.textContent === 'もう一度',
      ) as HTMLButtonElement
      folderRetry.click()
    })
    await act(async () => {})
    expect(host.textContent).toContain('A箱')
    expect(host.textContent).not.toContain('フォルダを読み込めませんでした。')
  })
})

describe('正常・空は従来どおり', () => {
  it('一覧が出る', async () => {
    await mount()
    expect(host.textContent).toContain('箱フォーム')
    expect(host.textContent).toContain('2件中')
  })

  it('空は作成導線の空状態', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/forms?')) {
        return { success: true, data: { items: [], total: 0, all_total: 0 } }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    await mount()
    expect(host.textContent).toContain('まだ回答フォームはありません')
  })
})

describe('R602補足: 取れていない総件数は「すべて」に数を出さない', () => {
  it('フォーム503では「すべて 0」と言わず、失敗案内と再試行は残す', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/forms?')) throw new ApiError(503, 'Service Unavailable')
      throw new Error(`unexpected fetch: ${url}`)
    })
    await mount()
    // 未取得の総数は省略する（0と確定したように見せない）。
    expect(host.textContent).toContain('すべて')
    expect(host.textContent).not.toMatch(/すべて\s*\d/)
    // R602の案内と立て直しの口はそのまま。
    expect(host.textContent).toContain('回答フォームを読み込めませんでした')
    expect(retryButtons()).toHaveLength(1)
  })

  it('フォルダだけ503では「すべて 2」と一覧を残す', async () => {
    apiFolders.list.mockImplementation(async () => {
      throw new ApiError(503, 'Service Unavailable')
    })
    await mount()
    expect(host.textContent).toMatch(/すべて\s*2/)
    expect(host.textContent).toContain('箱フォーム')
  })

  it('正常200の実0は「すべて 0」のまま', async () => {
    fetchApi.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/forms?')) {
        return { success: true, data: { items: [], total: 0, all_total: 0 } }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    await mount()
    expect(host.textContent).toMatch(/すべて\s*0/)
  })
})
