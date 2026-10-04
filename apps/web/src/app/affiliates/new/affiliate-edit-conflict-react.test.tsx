// @vitest-environment happy-dom
/*
 * アフィリエイター登録の同時編集（板 Gqve5）。
 *
 * 追加情報の PUT は作ったときの更新日時を送る。ほかの人が先に保存して
 * 409 になったら、そのまま上書きせず帯を出す。帯から「違いを比べる」で
 * 違う項目だけ並べ、「最新を読み込んで続ける」で基準を進めて保存し直す。
 * 通信（api）と遷移（next/navigation）とアカウント選択だけ差し替える。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const friendsList = vi.hoisted(() => vi.fn())
const affiliatesCreate = vi.hoisted(() => vi.fn())
const affiliatesUpdate = vi.hoisted(() => vi.fn())
const affiliatesGet = vi.hoisted(() => vi.fn())

class MockApiError extends Error {
  status?: number
  code?: string
  data?: unknown
  constructor(status?: number, message?: string, code?: string, data?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    ApiError: MockApiError,
    api: {
      friends: { list: friendsList },
      affiliates: { create: affiliatesCreate, update: affiliatesUpdate, get: affiliatesGet },
      tags: { list: vi.fn(async () => ({ success: true, data: [] })) },
      scenarios: { list: vi.fn(async () => ({ success: true, data: [] })) },
    },
  }
})

const pushed = vi.hoisted(() => [] as string[])
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { pushed.push(href) } }),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: 'account-a',
    selectedAccount: { id: 'account-a', name: '本店' },
    accounts: [{ id: 'account-a', name: '本店' }],
    setSelectedAccountId: () => {},
    clearSelectedAccountId: () => {},
    refreshAccounts: async () => {},
    loading: false,
  }),
}))

vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, id, value, onChange, options }: {
    'aria-label'?: string
    id?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, id, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))

const { default: NewAffiliatePage } = await import('./page')

let container: HTMLDivElement
let root: Root

async function mount(element: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(element) })
}

function byId<T extends HTMLElement>(id: string): T {
  const found = container.querySelector<T>(`#${id}`)
  if (!found) throw new Error(`#${id} が見つかりません`)
  return found
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === text,
  )
  if (!found) throw new Error(`「${text}」のボタンが見つかりません`)
  return found as HTMLButtonElement
}

function hasText(text: string): boolean {
  return (container.textContent ?? '').includes(text)
}

async function type(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const CREATED_AT = '2026-10-01T00:00:00.000+09:00'
const LATEST_AT = '2026-10-02T14:02:00.000+09:00'
const LATEST = {
  id: 'aff-1',
  name: '坂本版の名前',
  code: 'sakamoto',
  commissionRate: 10,
  isActive: true,
  email: null,
  holdDays: null,
  payoutCycle: null,
  notifyOnConversion: true,
  createdAt: CREATED_AT,
  updatedAt: LATEST_AT,
}

beforeEach(() => {
  vi.clearAllMocks()
  pushed.length = 0
  friendsList.mockImplementation(async () => ({ success: true, data: { items: [], total: 0 } }))
  affiliatesCreate.mockImplementation(async () => ({
    success: true, data: { id: 'aff-1', updatedAt: CREATED_AT },
  }))
  affiliatesGet.mockImplementation(async () => ({ success: true, data: LATEST }))
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
})

describe('アフィリエイター登録の同時編集', () => {
  it('更新日時は作ったときの値を送り、409なら帯を出して上書きしない', async () => {
    affiliatesUpdate.mockRejectedValueOnce(
      new MockApiError(409, 'conflict', 'VERSION_CONFLICT', { latest: LATEST }),
    )
    await mount(<NewAffiliatePage />)
    await type(byId<HTMLInputElement>('af-name'), '自分の名前')
    await click(buttonByText('登録して、紹介リンクを発行する'))

    // 作ったときの更新日時を付けて送る
    expect(affiliatesUpdate).toHaveBeenCalledTimes(1)
    expect(affiliatesUpdate.mock.calls[0][1]).toMatchObject({ expectedUpdatedAt: CREATED_AT })
    // 帯が出て、その場にとどまる（上書きしない・遷移しない）
    expect(hasText('ほかの人が10/2 14:02にこのアフィリエイターを保存しました')).toBe(true)
    expect(hasText('このまま保存すると、その人の変更が消えます')).toBe(true)
    expect(pushed).toHaveLength(0)
  })

  it('違いを比べると違う項目だけ並ぶ', async () => {
    affiliatesUpdate.mockRejectedValueOnce(
      new MockApiError(409, 'conflict', 'VERSION_CONFLICT', { latest: LATEST }),
    )
    await mount(<NewAffiliatePage />)
    await type(byId<HTMLInputElement>('af-name'), '自分の名前')
    await click(buttonByText('登録して、紹介リンクを発行する'))
    await click(buttonByText('違いを比べる'))

    // 比べの表だけを見る（入力欄にも同じ言葉があるため）。
    const compare = container.querySelector('[data-design-part="edit-conflict-compare"]')
    if (!compare) throw new Error('比べの表が見つかりません')
    const compareText = compare.textContent ?? ''
    expect(compareText.includes('違う項目だけ並べています')).toBe(true)
    // 名前は違うので並ぶ
    expect(compareText.includes('坂本版の名前')).toBe(true)
    // 連絡先メールは両方未登録で同じなので並ばない
    expect(compareText.includes('連絡先メール')).toBe(false)
  })

  it('最新を読み込んで続けると基準が進み、保存し直せる', async () => {
    affiliatesUpdate.mockRejectedValueOnce(
      new MockApiError(409, 'conflict', 'VERSION_CONFLICT', { latest: LATEST }),
    )
    affiliatesUpdate.mockImplementation(async () => ({
      success: true, data: { id: 'aff-1', updatedAt: '2026-10-02T15:00:00.000+09:00' },
    }))
    await mount(<NewAffiliatePage />)
    await type(byId<HTMLInputElement>('af-name'), '自分の名前')
    await click(buttonByText('登録して、紹介リンクを発行する'))
    await click(buttonByText('最新を読み込んで続ける'))

    // 帯が消え、入力（下書き）は残る
    expect(hasText('ほかの人が10/2')).toBe(false)
    expect(byId<HTMLInputElement>('af-name').value).toBe('自分の名前')
    // 保存し直すと進んだ日時を送る
    await click(buttonByText('追加情報の保存を再開する'))
    expect(affiliatesUpdate).toHaveBeenCalledTimes(2)
    expect(affiliatesUpdate.mock.calls[1][1]).toMatchObject({ expectedUpdatedAt: LATEST_AT })
  })
})
