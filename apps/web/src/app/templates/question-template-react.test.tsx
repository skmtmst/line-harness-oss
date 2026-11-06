// @vitest-environment happy-dom
/*
 * 質問を作る・編集（l87p1J）を本物の画面で開き、押して確かめる。
 *
 * 題・使う場所と届き方・「押されたら」の窓・下書きと公開の保存・保存の失敗の文・
 * フォルダの候補の読み方と保存するフォルダを、画面に出たものと API の呼び方で見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  folders: vi.fn(),
  title: vi.fn(),
  params: new URLSearchParams(''),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  const api = (actual as unknown as { api: Record<string, object> }).api
  return {
    ...actual,
    api: {
      ...api,
      templates: { ...api.templates, get: calls.get, create: calls.create, update: calls.update, list: calls.list },
      folders: { ...api.folders, list: calls.folders },
      tags: { ...api.tags, list: async () => ({ success: true, data: [] }) },
      scenarios: { ...api.scenarios, list: async () => ({ success: true, data: [] }) },
    },
  }
})
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => calls.params,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: calls.title, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))

import { ApiError } from '@/lib/api'
import { describeApiFailure } from '@/components/shared/api-error-message'
import QuestionNewV8 from '@/v8/templates/question-new'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

async function mount(query = '') {
  calls.params = new URLSearchParams(query)
  await act(async () => { root.render(<QuestionNewV8 />) })
  await flush()
}

async function fillRequired() {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('テンプレート名'), { target: { value: '続けるか聞く' } })
    fireEvent.change(screen.getByLabelText('質問文（160文字まで）'), { target: { value: '来月も続けますか？' } })
  })
}

const saved = { success: true, data: { id: 'q-1', publishedVersion: 1, draftRevision: 1 } }

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'v8')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  for (const fn of [calls.get, calls.create, calls.update, calls.list, calls.folders, calls.title]) fn.mockReset()
  calls.folders.mockResolvedValue({ success: true, data: [{ id: 'fol-q', kind: 'template', name: '好み', itemCount: 0 }] })
  calls.create.mockResolvedValue(saved)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-theme')
})

describe('質問テンプレートの画面', () => {
  it('新しく作るときは「質問を作る」、直すときは「質問を編集」の題で、質問の板（l87p1J）を開く', async () => {
    await mount()
    expect(calls.title).toHaveBeenLastCalledWith('質問を作る')
    expect(document.querySelector('[data-design-node="l87p1J"]')).not.toBeNull()
    act(() => root.unmount())
    root = createRoot(host)
    calls.get.mockResolvedValue({
      success: true,
      data: {
        id: 'q-1', name: '続けるか聞く', category: '未分類', folderId: null, accountId: 'account-a',
        question: { text: '続けますか？', tapMode: 'single', choices: [{ key: 'a', label: 'はい', behavior: 'none' }] },
        publishedVersion: 1, draftRevision: 1,
        usedBy: { autoReplies: [], automations: [], scenarioSteps: [], reminderSteps: [], richMenuAreas: [], trackedLinks: [] },
      },
    })
    await mount('id=q-1')
    expect(calls.title).toHaveBeenLastCalledWith('質問を編集')
  })

  it('使う場所と届き方を同じ画面で見られ、入れた質問文がLINEの見え方に出る。「押されたら」は今の質問の部品を窓で開く', async () => {
    await mount()
    expect(document.body.textContent).toContain('この質問を使う場所')
    expect(document.body.textContent).toContain('答えをどこに残すかを、選択肢ごとに決めます')
    await fillRequired()
    const phone = host.querySelector('[data-line-preview-part="phone"]')
    expect(phone?.textContent).toContain('来月も続けますか？')
    expect(phone?.textContent).toContain('本店')
    expect(phone?.textContent).not.toContain('公式アカウント')
    expect(phone?.textContent).toContain('今日')
    expect(phone?.textContent).not.toContain('配信日 10:00')
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /選択肢 1 の押されたら/ })[0]) })
    const dialog = screen.getByRole('dialog', { name: /選択肢 1「.*」を押されたら/ })
    expect(within(dialog).getByText('タグ・記録などの詳しい設定')).toBeTruthy()
  })

  it('「下書きを保存」は下書きとして、「保存して公開」は公開として送る', async () => {
    await mount()
    await fillRequired()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
    await flush()
    expect(calls.create).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 'account-a', name: '続けるか聞く', questionStatus: 'draft' }))

    act(() => root.unmount())
    root = createRoot(host)
    await mount()
    await fillRequired()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存して公開' })) })
    await flush()
    expect(calls.create).toHaveBeenLastCalledWith(expect.objectContaining({ questionStatus: 'published' }))
  })

  it('保存が投げられて失敗したら、原因どおりの文（権限と一時的な失敗を言い分ける）で出す', async () => {
    const broken = new ApiError(500, 'internal')
    const forbidden = new ApiError(403, 'forbidden')
    expect(describeApiFailure(broken, '保存', { scope: 'store' })).not.toBe(describeApiFailure(forbidden, '保存', { scope: 'store' }))
    for (const failure of [broken, forbidden]) {
      act(() => root.unmount())
      root = createRoot(host)
      calls.create.mockRejectedValueOnce(failure)
      await mount()
      await fillRequired()
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
      await flush()
      expect(document.body.textContent).toContain(describeApiFailure(failure, '保存', { scope: 'store' }))
    }
  })

  it('フォルダの候補は選んでいるアカウントの置き場から読み、テンプレートを全部は読まない。選んだフォルダで保存する', async () => {
    await mount()
    expect(calls.folders).toHaveBeenCalledWith('template', 'account-a')
    expect(calls.list).not.toHaveBeenCalled()
    await fillRequired()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'フォルダ' })) })
    const option = await screen.findByRole('option', { name: /好み/ })
    await act(async () => { fireEvent.click(within(option).getByRole('button')) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下書きを保存' })) })
    await flush()
    expect(calls.create).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: 'fol-q', category: '好み' }))
  })
})
