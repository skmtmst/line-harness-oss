// @vitest-environment happy-dom
/*
 * N-175 (#805): フォルダ選択をサーバーへ渡すことを実マウントで確かめる。
 * サーバーが返した一覧をそのまま描き、画面内でフォルダ絞りしないこと。
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
// V8 の名前変更は型付き口 `api.forms.update` を使う（V7 の生 PUT と違う）。
const formsUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  // `api.folders.*` は内部で生の fetchApi を掴むため、部品ごと差し替える。
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    fetchApi,
    api: { ...api, folders: apiFolders, forms: { ...api.forms, update: formsUpdate } },
  }
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

import FormSubmissionsPage from './list-v8'

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

const writes: { url: string; method?: string; body?: unknown }[] = []

function mockResponse(url: string, options?: { method?: string; body?: string }) {
  calls.push(url)
  if (options?.method === 'POST' && url === '/api/folders') {
    const body = JSON.parse(options.body ?? '{}')
    writes.push({ url, method: 'POST', body })
    return { success: true, data: { id: 'fol-new', kind: 'form', ...body } }
  }
  if (options?.method === 'PUT' && url.startsWith('/api/forms/')) {
    const body = JSON.parse(options.body ?? '{}')
    writes.push({ url, method: 'PUT', body })
    return { success: true, data: { id: 'f-a1' } }
  }
  if (url.startsWith('/api/folders')) {
    // 箱ごとの件数は数えていない（R25）。キーが無いことをそのまま返す。
    return { success: true, data: [{ id: 'fol-a', kind: 'form', name: 'A箱', parentId: null, displayOrder: 0, color: null }] }
  }
  if (/^\/api\/forms\/[^/?]+[?]/.test(url)) {
    return { success: true, data: { ...formA, contentRevision: 3 } }
  }
  if (url.includes('folder_id=fol-a')) {
    return { success: true, data: { items: [formOther], total: 1 } }
  }
  return { success: true, data: { items: [formA, formUnfiled], total: 2 } }
}

const folderA = { id: 'fol-a', kind: 'form', name: 'A箱', parentId: null, displayOrder: 0, color: null }

beforeEach(() => {
  const storage = new MemoryStorage()
  storage.setItem('lh_staff_role', 'admin')
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  calls.length = 0
  writes.length = 0
  fetchApi.mockImplementation(mockResponse)
  apiFolders.list.mockImplementation(async (kind: string, accountId?: string) => {
    calls.push(`/api/folders?kind=${kind}&account_id=${accountId ?? ''}`)
    return { success: true, data: [folderA] }
  })
  apiFolders.create.mockImplementation(async (data: Record<string, unknown>) => {
    writes.push({ url: '/api/folders', method: 'POST', body: data })
    return { success: true, data: { id: 'fol-new', parentId: null, displayOrder: 1, color: null, ...data } }
  })
  apiFolders.update.mockImplementation(async (id: string, data: Record<string, unknown>) => {
    writes.push({ url: `/api/folders/${id}`, method: 'PATCH', body: data })
    return { success: true, data: { ...folderA, id, ...data } }
  })
  apiFolders.delete.mockImplementation(async (id: string) => {
    writes.push({ url: `/api/folders/${id}`, method: 'DELETE' })
    return { success: true, data: null }
  })
  apiFolders.swapOrder.mockImplementation(async (id: string, withId: string) => {
    writes.push({ url: `/api/folders/${id}/swap-order`, method: 'SWAP', body: { withId } })
    return { success: true, data: { swapped: [id, withId] } }
  })
  formsUpdate.mockImplementation(async (id: string, _accountId: string, data: Record<string, unknown>) => {
    writes.push({ url: `/api/forms/${id}`, method: 'PUT', body: data })
    return { success: true, data: { id } }
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

async function openRowMenu(formName: string) {
  const menuButton = [...host.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') ?? '').startsWith(`「${formName}」のその他の操作`),
  )
  expect(menuButton).toBeTruthy()
  await act(async () => {
    menuButton!.click()
  })
}

async function clickMenuItem(label: string) {
  // 操作メニューは最上層の portal に出るため、描画の隔離先ではなく文書全体から探す。
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (el) => el.textContent === label,
  )
  expect(item).toBeTruthy()
  await act(async () => {
    (item as HTMLElement).click()
  })
  await act(async () => {})
}

describe('箱の作成・名前変更・移動が選んだアカウントでつながる（R25・実マウント）', () => {
  it('箱を追加すると選んだアカウント付きで作る', async () => {
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    await clickFolder('フォルダを追加')
    const nameInput = host.querySelector('input[placeholder^="例:"]') as HTMLInputElement | null
    expect(nameInput).toBeTruthy()
    await act(async () => {
      nameInput!.focus()
      // React の変更検知を通すためネイティブの値設定を使う
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(nameInput, '来店・予約')
      nameInput!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const addButton = [...host.querySelectorAll('button')].find((b) => b.textContent === '追加する')
    expect(addButton).toBeTruthy()
    await act(async () => {
      addButton!.click()
    })
    await act(async () => {})
    const created = writes.find((w) => w.method === 'POST' && w.url === '/api/folders')
    expect(created).toBeTruthy()
    expect(created!.body).toMatchObject({ kind: 'form', name: '来店・予約', accountId: 'account-a' })
  })

  it('名前の変更は確認した編集の版を添えて送る', async () => {
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    await openRowMenu('箱フォーム')
    await clickMenuItem('名前を変更')
    // 名前変更の窓は最上層の portal に出るため、文書全体で見る。
    expect(document.body.textContent).toContain('フォーム名を変更')
    await act(async () => {})
    const saveButton = [...document.querySelectorAll('button')].find((b) => b.textContent === '保存する')
    expect(saveButton).toBeTruthy()
    await act(async () => {
      saveButton!.click()
    })
    await act(async () => {})
    const renamed = writes.find((w) => w.method === 'PUT' && String(w.url).startsWith('/api/forms/f-a1'))
    expect(renamed).toBeTruthy()
    expect(renamed!.body).toMatchObject({ name: '箱フォーム', expectedContentRevision: 3 })
  })

  it('箱へ移すと所属だけを送る（版の確認は要しない）', async () => {
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    await openRowMenu('未分類フォーム')
    await clickMenuItem('フォルダへ移す')
    // 確認窓は最上層の portal に出るため、文書全体で見る。
    expect(document.body.textContent).toContain('どのフォルダへ移しますか')
    // 「A箱」を選ぶ（未分類以外の選択肢）
    const radios = [...document.querySelectorAll('input[name="move-folder"]')] as HTMLInputElement[]
    expect(radios.length).toBeGreaterThan(1)
    await act(async () => {
      radios[1]!.click()
    })
    const moveButton = [...document.querySelectorAll('button')].find((b) => b.textContent === '移動する')
    expect(moveButton).toBeTruthy()
    await act(async () => {
      (moveButton as HTMLElement).click()
    })
    await act(async () => {})
    const moved = writes.find((w) => w.method === 'PUT' && String(w.url).startsWith('/api/forms/f-a2'))
    expect(moved).toBeTruthy()
    expect(moved!.body).toEqual({ folderId: 'fol-a' })
  })
})

describe('行の編集は質問の編集へ行く（R27・実マウント）', () => {
  it('編集は編集画面への行き先で、名前変更は「…」の中にある', async () => {
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    // 名前自体が編集画面への行き先になっている。
    const nameLink = [...host.querySelectorAll('button[aria-label="「箱フォーム」の詳細を見る"]')].find(
      (a) => a.textContent === '箱フォーム',
    )
    expect(nameLink).toBeTruthy()
    await openRowMenu('箱フォーム')
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    expect(items).toContain('編集')
    expect(items).toContain('名前を変更')
    expect(items).toContain('フォルダへ移す')
    expect(items).toContain('削除')
  })
})
