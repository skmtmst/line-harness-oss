// @vitest-environment happy-dom
/*
 * 共通情報の一覧の出し方を、本物の画面を描いて確かめる。
 * 列・選択中のアカウントでの読み込み・件数上限の知らせ・空と0件の言い分け・
 * 読み込み中・検索・並び・空のまま使われている知らせ・CSVの書き出しの口・畳んだフォルダの選択。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const listVars = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
const deleteImpact = vi.hoisted(() => vi.fn())
const deleteVar = vi.hoisted(() => vi.fn())
const replaceVar = vi.hoisted(() => vi.fn())
const replacementCandidates = vi.hoisted(() => vi.fn())
const replacementImpact = vi.hoisted(() => vi.fn())
const listExports = vi.hoisted(() => vi.fn())
const schedules = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      commonVars: {
        ...actual.api.commonVars,
        list: listVars,
        deleteImpact,
        delete: deleteVar,
        replace: replaceVar,
        replacementCandidates,
        replacementImpact,
        listExports,
        schedules,
      },
      folders: { ...actual.api.folders, list: listFolders },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => 'owner' }
})

import { ApiError } from '@/lib/api'
import CommonVarsListV8 from './list'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const base = {
  lineAccountId: 'account-a',
  type: 'text',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  nextSchedule: null,
  pendingScheduleCount: 0,
  validFrom: null,
  validUntil: null,
  folderId: null,
}
const company = { ...base, id: 'v-company', name: '会社名', varKey: 'company_name', value: '株式会社NEN', usageCount: 15 }
const contact = { ...base, id: 'v-contact', name: '問い合わせ先', varKey: 'contact', value: '03-0000-0000', usageCount: 0 }
const notice = { ...base, id: 'v-notice', name: '臨時のお知らせ', varKey: 'temp_notice', value: '本日は17時まで', usageCount: 0 }

function impactOf(variable: { id: string; name: string; varKey: string }, over: Record<string, unknown> = {}) {
  return {
    variable,
    total: 0,
    blockingTotal: 0,
    historicalTotal: 0,
    sendingFixedTotal: 0,
    unscopedFormTotal: 0,
    canDelete: true,
    byKind: {},
    items: [],
    unavailableReferences: [],
    checkedAt: '2026-09-07T10:00:00.000+09:00',
    recommendedAction: 'delete',
    ...over,
  }
}

const blockedCompany = impactOf(company, {
  total: 15,
  blockingTotal: 15,
  canDelete: false,
  items: [{ kind: 'broadcast', kindLabel: '一斉配信', name: '10月のお知らせ', status: '配信予約中', href: '/broadcasts/edit?id=b1', blocksDeletion: true, currentPreview: '' }],
  recommendedAction: 'review_references',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  listVars.mockReset().mockImplementation(async () => ({ success: true, data: [company, contact, notice] }))
  listFolders.mockReset().mockImplementation(async () => ({ success: true, data: [], unfiledCount: 3 }))
  listExports.mockReset().mockImplementation(async () => ({ success: true, data: [] }))
  deleteImpact.mockReset().mockImplementation(async (id: string) => ({
    success: true,
    data: id === company.id ? blockedCompany : impactOf([company, contact, notice].find((item) => item.id === id) ?? notice),
  }))
  deleteVar.mockReset().mockImplementation(async () => ({ success: true, data: null }))
  replaceVar.mockReset().mockImplementation(async () => ({ success: true, data: {} }))
  replacementCandidates.mockReset().mockImplementation(async () => ({ success: true, data: { source: { id: company.id, name: company.name, type: 'text', version: 1 }, candidates: [] } }))
  schedules.mockReset().mockImplementation(async () => ({ success: true, data: [] }))
  replacementImpact.mockReset().mockImplementation(async () => ({ success: false, error: 'none' }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
})

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await Promise.resolve() })
  }
}

async function render() {
  act(() => { root.render(<CommonVarsListV8 />) })
  await flush()
}

function byLabel<T extends HTMLElement = HTMLElement>(label: string): T {
  const found = document.querySelector(`[aria-label="${label}"]`) as T | null
  expect(found, `「${label}」がありません`).toBeTruthy()
  return found as T
}

function findButton(text: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll('button, [role="menuitem"]')]
    .find((element) => element.textContent?.trim() === text) as HTMLButtonElement | undefined
}

function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const found = findButton(text, scope)
  expect(found, `「${text}」がありません`).toBeTruthy()
  return found as HTMLButtonElement
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
  await flush()
}

async function type(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

async function openRowDelete(name: string) {
  await click(byLabel(`共通情報「${name}」の操作`))
  await click(button('削除する'))
}

function deleteDialog(): HTMLElement {
  const dialog = document.querySelector('[data-design-node="xxKtW"]') as HTMLElement | null
  expect(dialog, '削除の窓（xxKtW）が開いていません').toBeTruthy()
  return dialog as HTMLElement
}

function inputByPlaceholder(placeholder: string, scope: ParentNode = document): HTMLInputElement {
  const found = scope.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement | null
  expect(found, `「${placeholder}」の欄がありません`).toBeTruthy()
  return found as HTMLInputElement
}

/** 検索欄は打ち終わりを 300ms 待ってから絞る。 */
async function search(value: string) {
  await type(byLabel<HTMLInputElement>('共通情報を検索'), value)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
  await flush()
}

/** 使っている所の列が出る広い板（1440 相当）。 */
function wideViewport() {
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => true),
  }))
}

function rowNames(): string[] {
  return [...host.querySelectorAll('tbody tr')].map((row) => row.querySelector('a')?.textContent?.trim() ?? '')
}

it('CSV状況は見出しの外の一覧通知へ出し、見出しには書き出し操作だけを残す', async () => {
  listExports.mockResolvedValue({ success: true, data: [{ id: 'expired', status: 'expired', downloadUrl: null }] })
  await render()
  const status = host.querySelector('[data-testid="vars-export-status"]')
  expect(status).not.toBeNull()
  expect(status?.closest('[data-template-region="heading"]')).toBeNull()
  expect(status?.closest('[data-template-region="toolbar"]')).not.toBeNull()
  expect(host.querySelector('[data-template-region="heading"]')?.textContent).toContain('CSVで書き出す')
})

describe('共通情報の一覧の出し方', () => {
  it('選択中のLINEアカウントで一覧とフォルダを読み、行ごとの予約は読まずに一覧の次回予定を使う', async () => {
    listVars.mockResolvedValue({ success: true, data: [{ ...company, nextSchedule: { id: 's1', effectiveFrom: '2026-10-01T10:00', value: '株式会社ネン' }, pendingScheduleCount: 1 }, contact] })
    await render()
    expect(listVars).toHaveBeenCalledWith('account-a')
    expect(listFolders).toHaveBeenCalledWith('common_var', 'account-a')
    expect(schedules).not.toHaveBeenCalled()
    const row = [...host.querySelectorAll('tbody tr')].find((element) => element.textContent?.includes('会社名'))
    expect(row?.getAttribute('title')).toContain('株式会社ネン')
  })

  it('列は名前・中身・状態・使っている所で、種別の列を出さない', async () => {
    wideViewport()
    await render()
    const headings = [...host.querySelectorAll('thead th')].map((cell) => cell.textContent?.trim()).filter(Boolean)
    expect(headings).toEqual(['共通情報（差し込み名）', '中身', '状態', '使っている所'])
    expect(host.querySelector('thead')?.textContent).not.toContain('種別')
  })

  it('既定は使われている数が多い順に並べる', async () => {
    // 名前順（会社名・問い合わせ先・臨時のお知らせ）と違う並びになる数にする。
    listVars.mockResolvedValue({ success: true, data: [notice, company, { ...contact, usageCount: 20 }] })
    await render()
    expect(rowNames()).toEqual(['問い合わせ先', '会社名', '臨時のお知らせ'])
  })

  it('上限で切られたら黙らず、絞り込みを案内する', async () => {
    listVars.mockResolvedValue({ success: true, data: [company], meta: { total: 250, limited: true, limit: 200 } })
    await render()
    expect(host.textContent).toContain('表示は最初の200件までです。フォルダや検索で絞り込んでください。')
  })

  it('上限に届いていなければ案内を出さない', async () => {
    listVars.mockResolvedValue({ success: true, data: [company], meta: { total: 1, limited: false, limit: 200 } })
    await render()
    expect(host.textContent).not.toContain('表示は最初の200件までです。')
  })

  it('空のまま使われているものは、空欄のまま送られることまで言う', async () => {
    listVars.mockResolvedValue({ success: true, data: [{ ...contact, value: '', usageCount: 2 }] })
    await render()
    expect(host.textContent).toContain('「問い合わせ先」が空のまま 2か所で使われています。差し込んだところが空欄のまま送られます。')
  })

  it('読み込み中は表を出さず、読み込み中の印だけを出す', async () => {
    listVars.mockImplementation(() => new Promise(() => {}))
    await render()
    expect(host.querySelector('[aria-label="読み込み中"]')).toBeTruthy()
    expect(host.querySelector('table')).toBeNull()
  })

  it('1件も無いときは表の外で「まだ共通情報がありません」と作る口を出す', async () => {
    listVars.mockResolvedValue({ success: true, data: [] })
    await render()
    expect(host.textContent).toContain('まだ共通情報がありません')
    expect(host.querySelector('table')).toBeNull()
    expect([...host.querySelectorAll('a')].some((link) => link.getAttribute('href') === '/contents/vars/new' && link.textContent?.includes('最初の共通情報を作る'))).toBe(true)
  })

  it('検索で0件のときは初回の空と言い分け、「条件を外す」で元に戻す', async () => {
    await render()
    await search('存在しない言葉')
    expect(rowNames()).toEqual([])
    expect(host.textContent).not.toContain('まだ共通情報がありません')
    await click(button('条件を外す'))
    expect(rowNames()).toHaveLength(3)
  })

  it('検索欄は名前で行を絞る', async () => {
    await render()
    await search('会社')
    expect(rowNames()).toEqual(['会社名'])
  })

  it('管理者にはCSVの書き出しの口を出す', async () => {
    await render()
    expect(findButton('CSVで書き出す')).toBeTruthy()
  })

  it('フォルダがあるときは、畳んだ段にもフォルダを選ぶ欄を出す', async () => {
    listFolders.mockResolvedValue({ success: true, data: [{ id: 'f1', name: '店舗案内', color: null, kind: 'common_var', sortOrder: 0, itemCount: 1 }], unfiledCount: 2 })
    await render()
    const collapsed = host.querySelector('[data-template-region="collapsed-folders"], [data-template-region="toolbar"]')
    expect(collapsed?.textContent).toContain('フォルダ')
    // 読んだフォルダが左の列に出る（読み込みの結果を捨てていない）。
    expect(host.textContent).toContain('店舗案内')
  })
})
