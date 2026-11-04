// @vitest-environment happy-dom
/*
 * N-175 (#805): フォルダ選択をサーバーへ渡すことを実マウントで確かめる。
 * サーバーが返した一覧をそのまま描き、画面内でフォルダ絞りしないこと。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const heldInlineAction = vi.hoisted(() => ({ hold: false, run: null as null | (() => void) }))
vi.mock('@/components/shared/use-inline-detail-guard', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/shared/use-inline-detail-guard')>()
  return { ...actual, useInlineDetailGuard: (key: string) => {
    const guard = actual.useInlineDetailGuard(key)
    return { ...guard, protect: (action: () => void) => { if (heldInlineAction.hold) { heldInlineAction.run = action; return } return guard.protect(action) } }
  } }
})

const heldFolderConfirm = vi.hoisted(() => ({ current: null as null | (() => unknown) }))
vi.mock('@/components/shared/confirm-dialog', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/shared/confirm-dialog')>()
  return { ...actual, default: (props: React.ComponentProps<typeof actual.default>) => {
    if (props.open && props.description?.startsWith('削除しても、中のフォームは未分類') && props.onConfirm) heldFolderConfirm.current = props.onConfirm
    return <actual.default {...props} />
  } }
})
const fetchApi = vi.hoisted(() => vi.fn())
const account = vi.hoisted(() => ({ id: 'account-a' }))
const apiFolders = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  swapOrder: vi.fn(),
}))
// V8 の名前変更は型付き口 `api.forms.update` を使う（管理画面 の生 PUT と違う）。
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

vi.mock('@/lib/line-accounts-cache', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/line-accounts-cache')>()),
  loadLineAccounts: vi.fn(async () => ({ success: true, data: [{ id: 'account-a', name: '選択中の店' }, { id: 'account-b', name: 'フォルダの所有店' }] })),
}))

/* 操作の試験は、本人確認が済んだ管理者として行う。 */
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) =>
    React.createElement('a', props, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: account.id, loading: false }),
  useOptionalAccount: () => ({ selectedAccountId: account.id, loading: false }),
}))

/* 新しい一覧（src/v8/forms/list.tsx）を描く。2026-10-06 に `./list-v8` から向け直した。 */
import FormSubmissionsPage from '@/v8/forms/list'

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
  heldInlineAction.hold = false
  heldInlineAction.run = null
  account.id = 'account-a'
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

describe('フォームのフォルダ削除確認', () => {
  it.each([{ accountId: null }, { accountId: 'account-b' }, {}])('共通・別所有・不明の削除対象を確認する %o', async owner => {
    apiFolders.list.mockResolvedValue({ success: true, data: [{ ...folderA, ...owner }] })
    await act(async () => { root.render(<FormSubmissionsPage />) })
    await clickFolder('A箱')
    const action = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'フォルダ「A箱」の操作')!
    await act(async () => { action.click() })
    const remove = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.includes('消す')) as HTMLElement
    await act(async () => { remove.click() })
    const dialog = document.querySelector('[role="alertdialog"]')!
    if ('accountId' in owner && owner.accountId === null) expect(dialog.textContent).toContain('共通（全アカウント）')
    const retained = heldFolderConfirm.current!
    await act(async () => { await retained() })
    if ('accountId' in owner && owner.accountId === null) expect(apiFolders.delete).toHaveBeenCalledWith('fol-a', undefined)
    else expect(apiFolders.delete).not.toHaveBeenCalled()
  })
  it('未保存確認の間にアカウントが往復した古い削除操作は開かない', async () => {
    await act(async () => { root.render(<FormSubmissionsPage />) })
    await clickFolder('A箱')
    const action = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'フォルダ「A箱」の操作')!
    await act(async () => { action.click() })
    heldInlineAction.hold = true
    const remove = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.includes('消す')) as HTMLElement
    await act(async () => { remove.click() })
    expect(heldInlineAction.run).toBeTypeOf('function')
    account.id = 'account-b'; await act(async () => { root.render(<FormSubmissionsPage />) })
    account.id = 'account-a'; await act(async () => { root.render(<FormSubmissionsPage />) })
    await act(async () => { heldInlineAction.run!() })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(apiFolders.delete).not.toHaveBeenCalled()
  })

  it('折りたたんだフォルダ欄でも削除入口を出す', async () => {
    await act(async () => { root.render(<FormSubmissionsPage />) })
    await clickFolder('A箱')
    expect(document.querySelectorAll('[aria-label="フォルダ「A箱」の操作"]')).toHaveLength(2)
  })

  it('フォルダに記録された所有先を表示する', async () => {
    apiFolders.list.mockResolvedValue({ success: true, data: [{ ...folderA, accountId: 'account-b' }] })
    await act(async () => { root.render(<FormSubmissionsPage />) })
    await clickFolder('A箱')
    const action = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'フォルダ「A箱」の操作')!
    await act(async () => { action.click() })
    const remove = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.includes('消す')) as HTMLElement
    await act(async () => { remove.click() })
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('フォルダの所有店')
    expect(document.querySelector('[role="alertdialog"]')?.textContent).not.toContain('選択中の店')
  })

  it('閉じたフォルダ削除の古い確定は実行しない', async () => {
    await act(async () => { root.render(<FormSubmissionsPage />) })
    await clickFolder('A箱')
    const action = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'フォルダ「A箱」の操作')!
    await act(async () => { action.click() })
    const remove = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.includes('消す')) as HTMLElement
    await act(async () => { remove.click() })
    const retained = heldFolderConfirm.current!
    const dialog = document.querySelector('[role="alertdialog"]')!
    await act(async () => { [...dialog.querySelectorAll('button')].find(b => b.textContent?.trim() === 'キャンセル')!.click() })
    await act(async () => { await retained() })
    expect(apiFolders.delete).not.toHaveBeenCalled()
  })

  it('対象アカウントと環境を出し、切替後に前の窓を確定できない', async () => {
    await act(async () => { root.render(<FormSubmissionsPage />) })
    await clickFolder('A箱')
    const action = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'フォルダ「A箱」の操作')
    expect(action).toBeTruthy()
    await act(async () => { action!.click() })
    const remove = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent?.includes('消す')) as HTMLElement | undefined
    expect(remove).toBeTruthy()
    await act(async () => { remove!.click() })
    const dialog = document.querySelector('[role="alertdialog"]')!
    expect(dialog.textContent).toContain('LINEアカウント')
    expect(dialog.textContent).toContain('環境')
    expect(dialog.textContent).toContain('名前を確認できません')
    account.id = 'account-b'
    await act(async () => { root.render(<FormSubmissionsPage />) })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(apiFolders.delete).not.toHaveBeenCalled()
  })
})

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
    // 管理画面は V8 だけ。共通の追加窓（role=dialog）は V8 の見た目で出る。
    document.documentElement.dataset.theme = 'v8'
    await act(async () => {
      root.render(<FormSubmissionsPage />)
    })
    await clickFolder('フォルダを追加')
    // 共通の追加窓は最上層へ描画される。
    const nameInput = document.querySelector('[role="dialog"] input[placeholder^="例："]') as HTMLInputElement | null
    expect(nameInput).toBeTruthy()
    await act(async () => {
      nameInput!.focus()
      // React の変更検知を通すためネイティブの値設定を使う
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(nameInput, '来店・予約')
      nameInput!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const addButton = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === '追加する')
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
    const renameDialog = [...document.querySelectorAll('[role="dialog"]')].find(element => element.textContent?.includes('回答者に表示されるフォーム名'))
    expect(renameDialog?.textContent).toContain('LINEアカウント')
    expect(renameDialog?.textContent).toContain('環境')
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
    const nameLink = [...host.querySelectorAll('a[aria-label="「箱フォーム」の詳細を見る"]')].find(
      (a) => a.textContent === '箱フォーム',
    )
    expect(nameLink).toBeTruthy()
    expect(nameLink?.getAttribute('href')).toBe('/form-submissions/edit?id=f-a1&tab=basic')
    await openRowMenu('箱フォーム')
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    expect(items).toContain('編集する')
    expect(items).toContain('名前を変更')
    expect(items).toContain('フォルダへ移す')
    expect(items).toContain('削除')
  })
})
it('フォーム名の変更中は画面移動前に確認する', async () => {
  window.history.replaceState(null, '', '/form-submissions')
  await act(async () => { root.render(<><FormSubmissionsPage /><a href="/events">イベントへ</a></>) })
  await openRowMenu('箱フォーム')
  await clickMenuItem('名前を変更')
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find(element => element.textContent?.includes('回答者に表示されるフォーム名'))!
  const input = dialog.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '変更途中')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { (document.querySelector('a[href="/events"]') as HTMLAnchorElement).click() })
  expect(document.body.textContent).toContain('保存していない変更があります')
})
it('フォーム名の変更窓は破棄の確認を一度だけ出す', async () => {
  await act(async () => { root.render(<FormSubmissionsPage />) })
  await openRowMenu('箱フォーム')
  await clickMenuItem('名前を変更')
  const dialog = [...document.querySelectorAll('[role="dialog"]')].find(element => element.textContent?.includes('回答者に表示されるフォーム名'))!
  const input = dialog.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '変更途中')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { ([...dialog.querySelectorAll('button')].find(button => button.textContent === 'キャンセル') as HTMLButtonElement).click() })
  const confirmation = [...document.querySelectorAll('[role="dialog"]')].find(element => element.textContent?.includes('入力を破棄しますか？'))!
  expect(confirmation).toBeTruthy()
  await act(async () => { ([...confirmation.querySelectorAll('button')].find(button => button.textContent === '破棄する') as HTMLButtonElement).click() })
  expect(document.body.textContent).not.toContain('保存していない変更があります')
  expect(document.body.textContent).not.toContain('回答者に表示されるフォーム名も変わります')
})
