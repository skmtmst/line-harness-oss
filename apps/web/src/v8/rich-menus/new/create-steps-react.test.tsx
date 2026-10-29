// @vitest-environment happy-dom
/*
 * ★V8 リッチメニューを作る：手順・面の欄・候補の読み込み失敗・公開の段の動き。
 * - `?step=` で開く手順を選べ、手順の現在地と板の印がその手順になる
 * - 面を選ぶと、その面だけの動きの欄が開き、面の名前が出る
 * - 候補の読み込みに失敗したら理由を出し、同じ条件で読み直せる
 * - 出す相手・いつ公開するかは共通の選ぶ札で選ぶ。終わりを決めるまでは終わりの欄を触れない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: ACCOUNT, loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/rich-menus/new',
}))

const ACCOUNT = { id: 'acc-1', name: '店舗A' }

import RichMenuCreateV8 from './create'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const area = (id: string, label: string, x: number) => ({
  id, boundsX: x, boundsY: 0, boundsWidth: 833, boundsHeight: 843, actionType: 'uri',
  actionData: { uri: 'https://nen.example/' }, intent: 'url', label, tagIds: [], scoreChange: null,
  templateId: null, formId: null, trackedLinkId: null,
})
const GROUP = {
  id: 'rmg-x', accountId: 'acc-1', name: '通常メニュー', chatBarText: 'メニュー', size: 'large',
  isDefaultForAll: true, status: 'draft', targetingPriority: 1, targetingEnabled: false, targetingCondition: null,
  folderId: null, displayOrder: 1, version: 1, defaultPageId: 'p-top',
  pages: [
    { id: 'p-top', orderIndex: 0, name: 'トップ', aliasId: 'a-top', lineRichmenuId: null, imageR2Key: null, imageContentType: null,
      areas: [area('a-1', '予約する', 0), area('a-2', '会員証', 833)] },
  ],
}

let host: HTMLDivElement
let root: Root
const calls: string[] = []
/** 道の頭がこれに当たる候補の口は、この回数だけ 500 で断る。 */
let failing: Record<string, number> = {}
/** 下書きの取得で返す中身。形の違う返事を試すときに入れ替える。 */
let groupBody: unknown = GROUP

function stubFetch() {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const parsed = new URL(String(url), 'http://localhost')
    calls.push(parsed.pathname + parsed.search)
    const prefix = Object.keys(failing).find((key) => parsed.pathname === key && failing[key] > 0)
    if (prefix) {
      failing[prefix] -= 1
      return { ok: false, status: 500, json: async () => ({ success: false, error: 'internal' }) }
    }
    if (parsed.pathname === '/api/staff/me') return { ok: true, status: 200, json: async () => ({ success: true, data: { id: 'owner-1', role: 'owner' } }) }
    if (parsed.pathname === '/api/rich-menu-groups/rmg-x') return { ok: true, status: 200, json: async () => ({ success: true, data: groupBody }) }
    if (parsed.pathname === '/api/rich-menu-groups') return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [], total: 0, page: 1, limit: 200 } }) }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
  }))
}

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

async function open(search: string) {
  window.history.replaceState(null, '', `/rich-menus/new${search}`)
  await act(async () => { root.render(<RichMenuCreateV8 />) })
  await settle()
}

function board(): string | null {
  return host.querySelector('[data-design-node]')?.getAttribute('data-design-node') ?? null
}

function currentStep(): string {
  const nav = host.querySelector('nav[aria-label="リッチメニューを作る手順"]')
  return nav?.querySelector('[aria-current="step"]')?.textContent ?? ''
}

beforeEach(() => {
  failing = {}
  groupBody = GROUP
  stubFetch()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('リッチメニューを作る：手順', () => {
  it.each([
    ['shape', 'JeINq', '形と画像'],
    ['buttons', 'Z0uO6', 'ボタンの動き'],
    ['audience', 'OxEMM', '誰に出すか'],
    ['publish', 'F4gELj', '公開'],
  ])('?step=%s で開くと、その手順が現在地になり、手順ごとの板の印が付く', async (step, boardId, label) => {
    await open(`?id=rmg-x&step=${step}`)
    expect(board()).toBe(boardId)
    expect(currentStep()).toContain(label)
  })

  it('知らない ?step= は最初の手順（形と画像）で開く', async () => {
    await open('?id=rmg-x&step=unknown')
    expect(board()).toBe('JeINq')
    expect(currentStep()).toContain('形と画像')
  })
})

describe('リッチメニューを作る：①形と画像', () => {
  it('面の分け方は共通の選ぶ部品（radiogroup）で、右に共通の要約と LINE の見え方を出す', async () => {
    await open('')
    expect(board()).toBe('JeINq')
    const picker = host.querySelector('[role="radiogroup"]')
    expect(picker).not.toBeNull()
    expect(within(picker as HTMLElement).getByRole('radio', { name: '1面（面 A）' })).toBeTruthy()
    expect(host.querySelectorAll('[data-part="create-summary"]').length).toBeGreaterThan(0)
    expect(host.querySelector('section[aria-label="LINEでの見え方"]')).not.toBeNull()
  })

  it('「画像の作り方」を押すと、大きさと押しやすい余白の案内の窓が開く', async () => {
    await open('')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '画像の作り方（大きさ・押しやすい余白）' })) })
    expect(screen.getByRole('dialog', { name: '画像の作り方' })).toBeTruthy()
  })
})

describe('リッチメニューを直す：下書きの読み込み', () => {
  it.each([
    ['ページの無い返事', { id: 'rmg-x', name: '通常メニュー' }],
    ['ページが配列でない返事', { ...GROUP, pages: null }],
    ['名前の無い返事', { ...GROUP, name: undefined }],
  ])('%sは形を確かめて受け取らず、見つからない扱いにする', async (_label, body) => {
    groupBody = body
    window.history.replaceState(null, '', '/rich-menus/edit?id=rmg-x&step=buttons')
    await act(async () => { root.render(<RichMenuCreateV8 editGroupId="rmg-x" />) })
    await settle()
    expect(host.textContent).toContain('このリッチメニューは見つかりません')
    expect(host.textContent).not.toContain('面 A')
  })
})

describe('リッチメニューを作る：面の動きの欄', () => {
  it('選んだ面だけの動きの欄を開き、面の名前を出す。別の面を選ぶと欄が入れ替わる', async () => {
    await open('?id=rmg-x&step=buttons')
    expect(screen.getByText('面 A「予約する」の動き')).toBeTruthy()
    expect(screen.queryByText('面 B「会員証」の動き')).toBeNull()
    await act(async () => { fireEvent.click([...host.querySelectorAll('button')].find((button) => button.textContent?.startsWith('B会員証'))!) })
    expect(screen.getByText('面 B「会員証」の動き')).toBeTruthy()
    expect(screen.queryByText('面 A「予約する」の動き')).toBeNull()
  })
})

describe('リッチメニューを作る：候補の読み込み', () => {
  it('候補の読み込みに失敗したら何が読めなかったかを出し、もう一度読み込むで同じアカウントの候補を読み直す', async () => {
    failing = { '/api/tags': 1, '/api/forms': 1 }
    await open('?id=rmg-x&step=buttons')
    const alert = screen.getByText(/候補の読み込みに失敗しました（タグ・フォーム）/)
    expect(alert).toBeTruthy()
    const before = calls.filter((path) => path.startsWith('/api/tags')).length
    const retry = within(alert.closest('[data-design-part="notice"]') as HTMLElement).getByRole('button', { name: 'もう一度読み込む' })
    await act(async () => { fireEvent.click(retry) })
    await settle()
    const tagCalls = calls.filter((path) => path.startsWith('/api/tags'))
    expect(tagCalls.length).toBe(before + 1)
    expect(tagCalls.at(-1)).toContain('acc-1')
    expect(calls.filter((path) => path.startsWith('/api/forms/') || path.startsWith('/api/forms?') || path === '/api/forms').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/候補の読み込みに失敗しました/)).toBeNull()
  })
})

describe('リッチメニューを作る：選ぶ札と終わりの欄', () => {
  it('出す相手は共通の選ぶ札（fieldset と legend）で選ぶ', async () => {
    await open('?id=rmg-x&step=audience')
    const group = screen.getByRole('group', { name: '出す相手' })
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.length).toBeGreaterThanOrEqual(2)
    expect(new Set(radios.map((radio) => radio.name))).toEqual(new Set(['audience']))
  })

  it('いつ公開するかは共通の選ぶ札で選び、終わりを決めるをオンにするまで終わりの欄は触れない', async () => {
    await open('?id=rmg-x&step=publish')
    const timing = screen.getByRole('group', { name: 'いつ公開するか' })
    expect(new Set((within(timing).getAllByRole('radio') as HTMLInputElement[]).map((radio) => radio.name))).toEqual(new Set(['timing']))
    const ends = () => screen.getByLabelText('終わる日時') as HTMLInputElement
    expect(ends().disabled).toBe(true)
    expect(screen.getByText('「終わりを決める」をオンにすると設定できます').id).toBe(ends().getAttribute('aria-describedby'))
    await act(async () => { fireEvent.click(screen.getByRole('switch', { name: '終わりを決める' })) })
    expect(ends().disabled).toBe(false)
    expect(screen.queryByText('「終わりを決める」をオンにすると設定できます')).toBeNull()
  })
})
