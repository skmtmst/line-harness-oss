// @vitest-environment happy-dom
/**
 * 回答フォームの編集（★V8・src/v8/form-edit）の動き。
 * V8 のテーマで出し、タブ・ページの指定・競合の帯・公開の確かめ・押せないボタンが無いことを見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyLayout, type FormLayout } from '@line-crm/shared'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const navigation = vi.hoisted(() => ({ query: '', push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  usePathname: () => '/form-submissions/edit',
  useSearchParams: () => new URLSearchParams(navigation.query),
  useParams: () => ({}),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: { id: 'acc-1', name: 'テスト店', liffId: 'liff-1' }, accounts: [], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {}, usePageChrome: () => ({ title: '' }) }))

const formsGet = vi.hoisted(() => vi.fn())
const formsUpdate = vi.hoisted(() => vi.fn())
const formsPublish = vi.hoisted(() => vi.fn())
const emptyList = vi.hoisted(() => async () => ({ success: true, data: [] as never[] }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchApi: vi.fn(async () => ({ success: true, data: [{ id: 'tag-1', name: 'アンケート回答' }] })),
    bookingApi: {
      ...actual.bookingApi,
      listMenus: vi.fn(async () => ({ menus: [{ id: 'bm-1', name: 'トリミング（小型犬）', duration_minutes: 60, is_active: 1 }] })),
      listMenuStaff: vi.fn(async () => ({ staff: [] })),
    },
    api: {
      ...actual.api,
      forms: { ...actual.api.forms, get: formsGet, update: formsUpdate, publish: formsPublish },
      // 下書きの自動保存は閲覧のみの人には動かさないため、役割を読む（通信させない）。
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { role: 'owner' } }) },
      friendFields: { ...actual.api.friendFields, list: emptyList },
      scenarios: { ...actual.api.scenarios, list: emptyList },
      reminders: { ...actual.api.reminders, list: emptyList },
      templates: { ...actual.api.templates, list: emptyList },
    },
  }
})

import FormEditPage from '@/app/form-submissions/edit/page'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import { ApiError } from '@/lib/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const layout: FormLayout = (() => {
  const l = emptyLayout()
  l.sections = [
    { id: 's1', name: '来店について', blocks: [
      { id: 'h1', kind: 'heading', text: '来店アンケート', level: 1 },
      { id: 'q1', kind: 'input', type: 'radio', name: 'purpose', label: '今日のご来店の目的は？', required: true, choiceMode: 'tag', choices: [{ id: 'c1', label: 'トリミング' }, { id: 'c2', label: 'ご相談' }] },
    ] },
    { id: 's2', name: '次回について', blocks: [
      { id: 'q2', kind: 'input', type: 'booking', name: 'next', label: '次回のご希望の日時を選んでください', booking: { menuId: 'bm-1', staffId: null, daysAhead: 14 } },
    ] },
  ]
  l.options = { ...l.options, afterActions: [{ kind: 'send_text', text: 'ご回答ありがとうございます' }] }
  return l
})()

const formData = {
  id: 'form-1', name: '来店アンケート', description: '', isActive: true, submitCount: 1284, onSubmitTagId: null,
  layout, ogTitle: null, ogDescription: null, ogImageUrl: null, contentRevision: 7, publishedVersionId: 'v3', publishedContentRevision: 6,
}

let host: HTMLDivElement
let root: Root
const render = async (query: string) => {
  navigation.query = query
  act(() => { root.render(<><FormEditPage /><ToastHost /></>) })
  for (let i = 0; i < 12; i++) await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  formsGet.mockImplementation(async () => ({ success: true, data: structuredClone(formData) }))
  formsUpdate.mockImplementation(async () => ({ success: true, data: { id: 'form-1', contentRevision: 8, updatedAt: '' } }))
  formsPublish.mockImplementation(async () => ({ success: true, data: { id: 'v4', versionNumber: 4, contentRevision: 8, publishedAt: '', replayed: false } }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  clearToastsForTest()
  delete document.documentElement.dataset.theme
  vi.clearAllMocks()
})

describe('回答フォームの編集（V8）', () => {
  it('V8 では src/v8 の画面が出て、最初のページの最初の質問の設定が開いている', async () => {
    await render('id=form-1')
    expect(await screen.findByRole('tab', { name: '中身' })).toBeTruthy()
    expect(document.querySelector('[data-page-template="create"]')).toBeTruthy()
    expect(screen.getByText('ページ1 のブロック')).toBeTruthy()
    // 開いている設定（質問文の欄）に質問の文が入っている
    expect(screen.getByDisplayValue('今日のご来店の目的は？')).toBeTruthy()
    expect(screen.getByText('下書き・公開中の版と違うところがあります')).toBeTruthy()
  })

  it('押せない（disabled の）ボタンを置いていない', async () => {
    await render('id=form-1')
    await screen.findByText('ページ1 のブロック')
    const disabled = [...host.querySelectorAll('button')].filter((b) => b.disabled).map((b) => b.textContent || b.getAttribute('aria-label'))
    expect(disabled).toEqual([])
  })

  it('?page=2 で2ページ目を開き、予約を入れるブロックの設定が出る', async () => {
    await render('id=form-1&page=2')
    expect(await screen.findByText('ページ2 のブロック')).toBeTruthy()
    expect(screen.getByDisplayValue('次回のご希望の日時を選んでください')).toBeTruthy()
    expect(screen.getByText('予約の設定を開く').closest('a')?.getAttribute('href')).toBe('/booking/menus')
  })

  it('?tab= で答え終わったあと・受付と見た目を開け、タブでも切り替わる', async () => {
    await render('id=form-1&tab=after')
    expect(await screen.findByText('答え終わったら行うこと')).toBeTruthy()
    expect(screen.getByText('テキストを送る「ご回答ありがとうございます」')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '受付と見た目' }))
    expect(await screen.findByText('受付のきまり（つづき）')).toBeTruthy()
    expect(screen.getByDisplayValue('来店アンケート')).toBeTruthy()
  })

  it('ほかの人が先に保存していたら（409）帯を出し、主のボタンは「比べてから保存」になる', async () => {
    formsUpdate.mockImplementation(async () => { throw new ApiError(409, 'conflict', 'VERSION_CONFLICT', { updatedAt: '' }) })
    // 再送の見分けで読み直したとき、中身が違う＝ほかの人の保存。
    formsGet.mockImplementationOnce(async () => ({ success: true, data: structuredClone(formData) }))
      .mockImplementation(async () => ({ success: true, data: { ...structuredClone(formData), name: '来店アンケート（マサト）' } }))
    await render('id=form-1')
    await screen.findByText('ページ1 のブロック')
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(formsUpdate).toHaveBeenCalled())
    const title = await screen.findByText(/^ほかの人が.*フォーム「来店アンケート.*」を保存しました$/)
    const band = title.closest('[data-design-node="J1pdB"]') as HTMLElement
    expect(band).toBeTruthy()
    expect(within(band).getByRole('button', { name: '違いを比べる' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '比べてから保存' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'この版を公開' })).toBeNull()
  })

  it('「この版を公開」で確かめの窓を出し、窓の中で押すと保存してから公開する', async () => {
    await render('id=form-1')
    await screen.findByText('ページ1 のブロック')
    fireEvent.click(screen.getByRole('button', { name: 'この版を公開' }))
    const dialog = await screen.findByRole('dialog', { name: 'この版を公開する' })
    expect(within(dialog).getByText(/すでに集まった回答（1,284件）は消えません/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'この版を公開' }))
    await waitFor(() => expect(formsPublish).toHaveBeenCalledWith('form-1', 'acc-1', 8))
    expect(formsUpdate.mock.invocationCallOrder[0]).toBeLessThan(formsPublish.mock.invocationCallOrder[0])
  })

  it('ブロックを足すと、その設定が開いて並びの最後に入る', async () => {
    await render('id=form-1')
    await screen.findByText('ページ1 のブロック')
    fireEvent.click(screen.getByRole('button', { name: /5段階の評価/ }))
    expect(await screen.findByText('5段階の評価', { selector: '[class*="openType"]' })).toBeTruthy()
  })
})

describe('回答フォームの下書き自動保存（一斉配信と同じ形）', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }) })
  afterEach(() => { vi.useRealTimers() })
  const wait = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
  const status = () => host.querySelector('[data-autosave-status]')?.textContent ?? null

  it('打って2秒止まると下書きへ静かに保存し、次の手の保存は新しい版で送る', async () => {
    await render('id=form-1')
    fireEvent.change(screen.getByDisplayValue('今日のご来店の目的は？'), { target: { value: '今日のご来店の目的を教えてください' } })
    expect(status()).toBe('下書きはまだ保存していません')
    await wait(1900)
    expect(formsUpdate).not.toHaveBeenCalled()
    await wait(200)
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
    expect(formsUpdate).toHaveBeenCalledTimes(1)
    expect(formsUpdate.mock.calls[0][2]).toEqual(expect.objectContaining({ expectedContentRevision: 7 }))
    expect(formsPublish).not.toHaveBeenCalled()
    expect(status()).toBe('下書き保存済み・0秒前')
    // 自動保存ではトースト・緑の帯を出さない。
    expect(document.body.textContent).not.toContain('下書きを保存しました')

    formsUpdate.mockImplementation(async () => ({ success: true, data: { id: 'form-1', contentRevision: 9, updatedAt: '' } }))
    fireEvent.change(screen.getByDisplayValue('今日のご来店の目的を教えてください'), { target: { value: '今日の目的は？' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
    expect(formsUpdate).toHaveBeenCalledTimes(2)
    expect(formsUpdate.mock.calls[1][2]).toEqual(expect.objectContaining({ expectedContentRevision: 8 }))
  })

  it('保存に失敗したら帯に出し、赤い帯は出さない', async () => {
    formsUpdate.mockImplementation(async () => { throw new Error('network') })
    await render('id=form-1')
    fireEvent.change(screen.getByDisplayValue('今日のご来店の目的は？'), { target: { value: '今日の目的は？' } })
    await wait(2100)
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() })
    expect(status()).toContain('自動保存できませんでした')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
