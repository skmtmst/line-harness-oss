// @vitest-environment happy-dom
/*
 * M507残差: 紹介文の保存が409で止まっても、最新の紹介文が画面のどこにも
 * 出ていなかった（元受入「409で止めて最新を見せる」未達）。
 * コラム編集ページを本物の React で mount し、同カード内に最新の紹介文が
 * 読み取り専用で別表示されること・下書きを置き換えないことを確かめる。
 *
 * 見る筋書き:
 *   1. 409後は自入力を残したまま、最新の紹介文が同カードに別表示される。
 *      別カードの入力には触れない。
 *   2. 書き直しても別表示は残り、保存成功（200）で消える。
 *   3. latest が無い409でも落ちず、案内だけ出る（安全処理）。
 *   4. 最新が空文字でも別表示が出る（空にされたことが分かる）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'

const lineAccountsListApi = vi.hoisted(() => vi.fn())
const columnsApi = vi.hoisted(() => vi.fn())
const updateColumnMessageApi = vi.hoisted(() => vi.fn())

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  // ?key= なし（一覧=紹介文編集モード）で開く。
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      lineAccounts: { ...actual.api.lineAccounts, list: lineAccountsListApi },
      nenCampaigns: {
        ...actual.api.nenCampaigns,
        columns: columnsApi,
        updateColumnMessage: updateColumnMessageApi,
      },
    },
  }
})

const { AccountProvider } = await import('@/contexts/account-context')
const { default: NenColumnEditPage } = await import('./page')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT_ID = 'account-nen'

function column(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    slug: `slug-${id}`,
    title: `題名${id}`,
    introText: `紹介文${id}`,
    publishedAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    ...over,
  }
}

let container: HTMLDivElement
let root: Root

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function mount() {
  localStorage.setItem('lh_selected_account', ACCOUNT_ID)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      React.createElement(AccountProvider, null, React.createElement(NenColumnEditPage)),
    )
  })
  await settle()
}

function textareas(): HTMLTextAreaElement[] {
  return Array.from(container.querySelectorAll('textarea')) as HTMLTextAreaElement[]
}

function saveButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter(
    (element) => element.textContent === '保存する',
  ) as HTMLButtonElement[]
}

async function setDraft(index: number, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(textareas()[index], value)
    textareas()[index].dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
  await settle()
}

function conflictError(message = 'ほかの人が先に保存しました') {
  return new ApiError(409, message, 'VERSION_CONFLICT', {
    latest: { introText: 'ほかの人の最新紹介文', updatedAt: '2026-09-30T01:00:00Z' },
  })
}

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  } as Storage
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', fakeStorage())
  lineAccountsListApi.mockResolvedValue({
    success: true,
    data: [{ id: ACCOUNT_ID, channelId: 'ch-1', name: 'テスト店', isActive: true, country: 'JP', role: 'owner', displayOrder: 0 }],
  })
  columnsApi.mockResolvedValue({ success: true, data: [column('a'), column('b')] })
  updateColumnMessageApi.mockResolvedValue({ success: true, data: { updatedAt: 'v3' } })
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('M507残差・409で止めて最新を見せる（実mount）', () => {
  it('409後は自入力を残したまま最新の紹介文が同カードに別表示され、別カードに触れない', async () => {
    updateColumnMessageApi.mockRejectedValueOnce(conflictError())
    await mount()
    await setDraft(0, '自分の書きかけの紹介文')

    await click(saveButtons()[0])

    // 開いたときの版を添えて送る（原assert）。
    expect(updateColumnMessageApi).toHaveBeenCalledTimes(1)
    expect(updateColumnMessageApi.mock.calls[0][3]).toBe('2026-09-30T00:00:00Z')
    // 案内は出る。
    expect(container.textContent).toContain('ほかの人が先に保存しました')
    // 最新の紹介文が同カードに別表示される（残差の核心）。
    expect(container.textContent).toContain('ほかの人が保存した最新の紹介文')
    expect(container.textContent).toContain('ほかの人の最新紹介文')
    // 自分の下書きは置き換えない。
    expect(textareas()[0].value).toBe('自分の書きかけの紹介文')
    // 別カードの入力はそのまま・別表示も付かない（1回だけ）。
    expect(textareas()[1].value).toBe('紹介文b')
    expect(container.textContent?.match(/ほかの人の最新紹介文/g)?.length).toBe(1)
  })

  it('書き直しても別表示は残り、保存成功で消える', async () => {
    updateColumnMessageApi.mockRejectedValueOnce(conflictError())
    await mount()
    await setDraft(0, '自分の書きかけの紹介文')
    await click(saveButtons()[0])
    expect(container.textContent).toContain('ほかの人の最新紹介文')

    // 再編集：比較の助けは残したまま、自入力を直せる。
    await setDraft(0, '書き直した紹介文')
    expect(textareas()[0].value).toBe('書き直した紹介文')
    expect(container.textContent).toContain('ほかの人の最新紹介文')

    // 保存し直すと200で通り、比較表示は消える。
    updateColumnMessageApi.mockResolvedValueOnce({ success: true, data: { updatedAt: 'v3' } })
    await click(saveButtons()[0])
    expect(container.textContent).toContain('この紹介文を保存しました')
    expect(container.textContent).not.toContain('ほかの人の最新紹介文')
    expect(textareas()[0].value).toBe('書き直した紹介文')
  })

  it('latestが無い409でも落ちず案内だけ出る（欠損時の安全処理）', async () => {
    updateColumnMessageApi.mockRejectedValueOnce(
      new ApiError(409, 'ほかの人が先に保存しました', 'VERSION_CONFLICT', null),
    )
    columnsApi.mockResolvedValue({ success: true, data: [column('a'), column('b')] })
    await mount()
    await setDraft(0, '自分の書きかけの紹介文')

    await click(saveButtons()[0])
    await settle()

    expect(container.textContent).toContain('ほかの人が先に保存しました')
    expect(container.textContent).not.toContain('ほかの人が保存した最新の紹介文')
    // 画面は生きていて、入力し直せる。
    await setDraft(0, '入力し直し')
    expect(textareas()[0].value).toBe('入力し直し')
  })

  it('最新が空文字でも別表示が出る（空にされたことが分かる）', async () => {
    updateColumnMessageApi.mockRejectedValueOnce(
      new ApiError(409, 'ほかの人が先に保存しました', 'VERSION_CONFLICT', {
        latest: { introText: '', updatedAt: '2026-09-30T01:00:00Z' },
      }),
    )
    await mount()
    await setDraft(0, '自分の書きかけの紹介文')

    await click(saveButtons()[0])

    expect(container.textContent).toContain('ほかの人が保存した最新の紹介文')
    expect(textareas()[0].value).toBe('自分の書きかけの紹介文')
  })
})
