// @vitest-environment happy-dom
/*
 * V8 テンプレートの作る・編集（src/v8/template-edit）の動きの試験。V8 のテーマで描いて確かめる。
 * 保存の口・断り方・保存の 409 の帯（NCbYn）・差し込み・閲覧のみ（押せない操作を置かない）・クーポン／リサーチの保存。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const templatesApi = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), update: vi.fn(), publish: vi.fn() }))
const assetsCreate = vi.hoisted(() => vi.fn())
const listFolders = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const search = vi.hoisted(() => ({ value: '' }))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    api: {
      ...api,
      templates: { ...api.templates, ...templatesApi },
      broadcastMessageAssets: { ...api.broadcastMessageAssets, create: assetsCreate },
      folders: { ...api.folders, list: listFolders },
      friendFields: { list: async () => ({ success: true, data: [{ fieldKey: 'plan', name: 'プラン', canInsertText: true, defaultValue: '定期便' }] }) },
      commonVars: { list: async () => ({ success: true, data: [] }) },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(search.value),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '然 - NEN -' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})
const narrow = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => narrow.value }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ status: 'ready', enabled: () => true }) }))
vi.mock('@/components/auto-replies/inline-action-list', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [], notificationRules: [] }),
}))

import { ApiError } from '@/lib/api'
import TemplateEditV8 from './edit'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const detail = (patch: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    id: 'template-1', name: '予約前日のご案内', category: 'general', folderId: null, messageType: 'text',
    messageContent: '明日のご予約です。', accountId: 'account-a', publishedVersion: 3, draftRevision: 2,
    updatedAt: '2026-10-06T05:02:00Z',
    usedBy: { autoReplies: [], automations: [], scenarioSteps: [], reminderSteps: [], richMenuAreas: [], trackedLinks: [] },
    ...patch,
  },
})

async function flush() {
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve() })
}
async function mount(query = '') {
  search.value = query
  await act(async () => { root.render(<TemplateEditV8 />) })
  await flush()
}
const type = (el: Element, value: string) => fireEvent.change(el, { target: { value } })

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'v8')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  role.value = 'owner'
  narrow.value = false
  push.mockReset()
  for (const fn of Object.values(templatesApi)) fn.mockReset()
  assetsCreate.mockReset()
  listFolders.mockReset()
  listFolders.mockResolvedValue({ success: true, data: [{ id: 'fol-1', kind: 'template', name: '予約', itemCount: 1 }] })
  templatesApi.get.mockResolvedValue(detail())
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
})

describe('V8 メッセージを作る・編集', () => {
  it('作る：名前と本文を書いて下書きを保存すると、選んでいるアカウントで作って一覧へ戻る', async () => {
    templatesApi.create.mockResolvedValue({ success: true, data: { id: 'template-new' } })
    await mount()
    expect(document.querySelector('[data-design-node="u5YC6"]')).toBeTruthy()
    type(screen.getByLabelText('テンプレート名'), '予約前日のご案内')
    type(screen.getByLabelText('本文'), 'こんにちは')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
    await flush()
    expect(templatesApi.create).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'account-a', name: '予約前日のご案内', messageContent: 'こんにちは', folderId: null }))
    expect(push).toHaveBeenCalledWith('/templates')
  })

  it('1152 の幅では板 a1k3d の印を付け、見え方は「LINEでの見え方を見る」の窓で開く', async () => {
    narrow.value = true
    await mount()
    expect(document.querySelector('[data-design-node="a1k3d"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'LINEでの見え方を見る' }))
    await flush()
    expect(screen.getByRole('dialog', { name: 'LINEでの見え方' })).toBeTruthy()
  })

  it('名前が空なら保存の口を呼ばず、理由を出す', async () => {
    await mount()
    type(screen.getByLabelText('本文'), 'こんにちは')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
    await flush()
    expect(templatesApi.create).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('名前を入力してください')
  })

  it('差し込む「名前」を押すと本文へ {{name}} が入り、数が増える', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '名前' }))
    await flush()
    expect((screen.getByLabelText('本文') as HTMLTextAreaElement).value).toBe('{{name}}')
    expect(screen.getByText('8 / 5,000')).toBeTruthy()
  })

  it('編集で保存が 409 なら、競合の帯（NCbYn）を出し、主ボタンは「比べてから保存」、比べると違いが出る', async () => {
    templatesApi.update.mockRejectedValue(new ApiError(409, '下書きが書き換わっています'))
    await mount('id=template-1')
    templatesApi.get.mockResolvedValue(detail({ name: '店舗のご案内', messageContent: '最新の本文' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
    await flush()
    const band = document.querySelector('[data-design-node="NCbYn"][role="alert"]')
    expect(band?.textContent).toContain('テンプレート「店舗のご案内」を保存しました')
    expect(band?.textContent).toContain('14:02')
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '比べてから保存' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '違いを比べる' })) })
    await flush()
    expect(document.body.textContent).toContain('本文が違います')
    expect(document.body.textContent).toContain('テンプレート名が違います')
  })

  it('閲覧のみ（staff）では保存・公開・キャンセルを置かず、帯で知らせる。押せないボタンも置かない', async () => {
    role.value = 'staff'
    await mount('id=template-1')
    expect(screen.getByText(/閲覧のみ：テンプレートの作成・変更はオーナーと管理者だけができます/)).toBeTruthy()
    for (const name of ['下書きを保存', '保存して公開', 'キャンセル']) expect(screen.queryByRole('button', { name })).toBeNull()
    const disabled = [...document.querySelectorAll('button')].filter((b) => (b as HTMLButtonElement).disabled)
    expect(disabled).toEqual([])
  })
})

describe('V8 クーポン・リサーチを作る', () => {
  it('クーポン：期間が無ければ保存の口を呼ばない', async () => {
    await mount('kind=coupon')
    expect(document.querySelector('[data-design-node="S6FEuB"]')).toBeTruthy()
    type(screen.getByLabelText('テンプレート名'), '夏の20%オフ')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
    await flush()
    expect(assetsCreate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('使える期間の開始と終了')
  })

  it('クーポン：見本の中身で保存すると、資産の口へクーポン名・期間・フォルダ名を送る', async () => {
    assetsCreate.mockResolvedValue({ success: true, data: { id: 'asset-1' } })
    await mount('kind=coupon&visual=1')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存して公開' })) })
    await flush()
    expect(assetsCreate).toHaveBeenCalledWith(expect.objectContaining({
      lineAccountId: 'account-a',
      kind: 'coupon',
      name: '夏の20%オフ',
      payload: expect.objectContaining({ title: '夏の20%オフ', startsAt: '2026-08-01T00:00', endsAt: '2026-08-31T23:59', oncePerFriend: true, folder: '03_販促・クーポン' }),
    }))
    expect(push).toHaveBeenCalledWith('/templates')
  })

  it('リサーチ：質問を足す・消すと問の数が変わり、選択肢の無い質問は保存を断る', async () => {
    await mount('kind=research')
    expect(document.querySelector('[data-design-node="EsYo4"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /質問を足す/ }))
    await flush()
    expect(screen.getByRole('region', { name: '問 2' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '問 2 を消す' }))
    await flush()
    expect(screen.queryByRole('region', { name: '問 2' })).toBeNull()
    type(screen.getByLabelText('テンプレート名'), '満足度')
    type(screen.getByLabelText('質問文'), '続けますか？')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
    await flush()
    expect(assetsCreate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('質問 1 の選択肢を1つ以上入力してください')
  })
})
