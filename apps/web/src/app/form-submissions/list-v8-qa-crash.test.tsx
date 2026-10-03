// @vitest-environment happy-dom
/*
 * 2026-10-03 点検：管理者確認（担当未割り当て）を開くと
 * `e is not iterable` で落ちていた。再発防止。
 *
 * 未割り当て口は配列で返す契約だが、配列でない応答が来ても
 * 一覧を空にして描く（`[...forms]` で落とさない）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FormSubmissionsListV8 from './list-v8'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const FORM_PAGE = {
  items: [
    {
      id: 'form-1', lineAccountId: 'visual-qa-account', name: '来店アンケート',
      description: '説明', folderId: null, fields: [], layout: { blocks: [] },
      onSubmitTagId: null, onSubmitScenarioId: null, onSubmitMessageType: null,
      onSubmitMessageContent: null, onSubmitWebhookUrl: null, onSubmitWebhookHeaders: null,
      onSubmitWebhookFailMessage: null, saveToMetadata: true, isActive: true,
      status: 'active', archivedAt: null, revision: 1, submitCount: 10,
      monthlySubmitCount: 5, monthlyOpenCount: 8, monthlyCompletionRate: 60,
      createdAt: '2026-08-21T03:00:00.000Z', updatedAt: '2026-08-21T03:00:00.000Z',
      lastSubmittedAt: '2026-08-21T03:00:00.000Z', usedByAccounts: [],
      accountScopeReviewRequired: false, destinationCount: 5,
      destinationSummary: { friendFieldCount: 3, tagCount: 2 },
    },
  ],
  total: 18, page: 1, limit: 20,
}

/* 試験ごとに差し替える未割り当て口の応答 */
let unassignedData: unknown = []
const formsDeleteImpact = vi.hoisted(() => vi.fn())
const formsUpdate = vi.hoisted(() => vi.fn())
const foldersCreate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    fetchApi: async (path: string) => {
      if (path.startsWith('/api/forms/unassigned')) return { success: true, data: unassignedData }
      if (path.startsWith('/api/forms?')) return { success: true, data: FORM_PAGE }
      throw new Error(`unexpected GET ${path}`)
    },
    api: {
      ...actual.api,
      folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }), create: foldersCreate },
      forms: { ...actual.api.forms, deleteImpact: formsDeleteImpact, update: formsUpdate },
      listStats: { get: async () => ({ success: true, data: null }) },
    },
  }
})
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'visual-qa-account', loading: false }),
}))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/form-submissions',
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

let host: HTMLDivElement
let root: Root
const errors: unknown[] = []
let spy: ReturnType<typeof vi.spyOn> | null = null
const flush = async (n = 20) => {
  for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 25)) })
}
beforeEach(() => {
  unassignedData = []
  formsDeleteImpact.mockReset()
  formsUpdate.mockReset()
  foldersCreate.mockReset()
  formsDeleteImpact.mockResolvedValue({ success: true, data: { contentRevision: 7 } })
  formsUpdate.mockResolvedValue({ success: true, data: {} })
  foldersCreate.mockResolvedValue({ success: true, data: { id: 'f1', name: '箱' } })
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); delete document.documentElement.dataset.theme
  spy?.mockRestore(); errors.length = 0
})

describe('管理者確認の切り替え', () => {
  it('配列でない応答でも落ちずに空の一覧を出す', async () => {
    await act(async () => { root.render(<FormSubmissionsListV8 />) })
    await flush()
    expect(host.textContent).toContain('来店アンケート')
    /* 偽 API の修正前は既定のページ形が返り、ここで落ちていた */
    unassignedData = { items: [], total: 0, page: 1, limit: 20 }
    const toggle = [...host.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('管理者確認'))
    expect(toggle).toBeTruthy()
    await act(async () => { fireEvent.click(toggle!) })
    await flush()
    expect(errors.map(String).join('\n')).toBe('')
    expect(host.textContent).toContain('通常の一覧に戻る')
  })

  it('配列の応答では未割り当ての行を出す', async () => {
    unassignedData = FORM_PAGE.items
    await act(async () => { root.render(<FormSubmissionsListV8 />) })
    await flush()
    const toggle = [...host.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('管理者確認'))
    await act(async () => { fireEvent.click(toggle!) })
    await flush()
    expect(errors.map(String).join('\n')).toBe('')
    expect(host.textContent).toContain('来店アンケート')
  })
})

/* V8「サクサク感」C①・D・E：行→詳細パネル・右クリック・つながる移り変わり。 */
describe('行の詳細パネルと右クリック', () => {
  const detailButton = () => {
    const found = [...host.querySelectorAll('button')]
      .find((b) => b.getAttribute('aria-label') === '「来店アンケート」の詳細を見る')
    expect(found, '行名のボタンがある').toBeTruthy()
    return found!
  }

  it('行を押すと右の詳細パネルが開く', async () => {
    await act(async () => { root.render(<FormSubmissionsListV8 />) })
    await flush()
    await act(async () => { fireEvent.click(detailButton()) })
    await flush()
    const panel = host.querySelector('[data-design-part="detail-panel"]')
    expect(panel, '詳細パネルが開く').toBeTruthy()
    expect(panel?.textContent).toContain('来店アンケート')
    expect(panel?.textContent).toContain('友だち情報')
    expect(errors.map(String).join('\n')).toBe('')
  })

  it('行を右クリックすると「…」と同じ操作が出る', async () => {
    await act(async () => { root.render(<FormSubmissionsListV8 />) })
    await flush()
    await act(async () => {
      fireEvent.contextMenu(detailButton(), { clientX: 60, clientY: 120 })
    })
    await flush()
    const menu = document.body.querySelector('[data-context-menu]')
    expect(menu, '右クリックメニューが出る').toBeTruthy()
    expect(menu?.textContent).toContain('集まった回答')
    expect(menu?.textContent).toContain('フォルダへ移す')
    expect(errors.map(String).join('\n')).toBe('')
  })

  it('詳細パネルの名前をその場で変えると版付きで更新口へ届く', async () => {
    await act(async () => { root.render(<FormSubmissionsListV8 />) })
    await flush()
    await act(async () => { fireEvent.click(detailButton()) })
    await flush()
    const panel = host.querySelector('[data-design-part="detail-panel"]')
    const edit = [...panel!.querySelectorAll('button')]
      .find((b) => b.getAttribute('aria-label') === 'フォーム名を変更する')
    expect(edit, '名前の変更ボタンがある').toBeTruthy()
    await act(async () => { fireEvent.click(edit!) })
    await flush()
    const input = host.querySelector('[data-design-part="detail-panel"] input[aria-label="フォーム名"]') as HTMLInputElement | null
    expect(input, '入力欄が出る').toBeTruthy()
    await act(async () => {
      fireEvent.change(input!, { target: { value: '改名アンケート' } })
    })
    await act(async () => {
      fireEvent.keyDown(input!, { key: 'Enter' })
    })
    await flush()
    expect(formsUpdate, '版付きで更新口へ届く').toHaveBeenCalledWith(
      'form-1', 'visual-qa-account', { name: '改名アンケート', expectedContentRevision: 7 },
    )
    expect(host.textContent).toContain('改名アンケート')
    expect(errors.map(String).join('\n')).toBe('')
  })
})

/* V8「サクサク感」：入力の窓は右のパネルへ（確認の窓は残す）。 */
describe('入力の右パネル移設', () => {
  it('フォルダへ移すは右のパネルで選べる', async () => {
    await act(async () => { root.render(<FormSubmissionsListV8 />) })
    await flush()
    const menuButton = [...host.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('「来店アンケート」のその他の操作'))
    expect(menuButton, '行末の「…」がある').toBeTruthy()
    await act(async () => { fireEvent.click(menuButton!) })
    await flush()
    const moveItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((m) => m.textContent?.includes('フォルダへ移す'))
    expect(moveItem, '移動の項目がある').toBeTruthy()
    await act(async () => { fireEvent.click(moveItem!) })
    await flush()
    const panel = host.querySelector('[data-design-part="detail-panel"]')
    expect(panel, '右のパネルが開く').toBeTruthy()
    expect(panel?.textContent).toContain('どのフォルダへ移しますか')
    expect(panel?.textContent).toContain('未分類')
    const moveButton = [...panel!.querySelectorAll('button')].find((b) => b.textContent === '移動する')
    expect(moveButton, '移動するボタンがある').toBeTruthy()
    expect(errors.map(String).join('\n')).toBe('')
  })

  it('複製は右のパネルで名前を入れられる', async () => {
    await act(async () => { root.render(<FormSubmissionsListV8 />) })
    await flush()
    const menuButton = [...host.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('「来店アンケート」のその他の操作'))
    await act(async () => { fireEvent.click(menuButton!) })
    await flush()
    const duplicateItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((m) => m.textContent === '複製')
    expect(duplicateItem, '複製の項目がある').toBeTruthy()
    await act(async () => { fireEvent.click(duplicateItem!) })
    await flush()
    const panel = host.querySelector('[data-design-part="detail-panel"]')
    expect(panel, '右のパネルが開く').toBeTruthy()
    expect(panel?.textContent).toContain('複製しますか')
    expect(panel?.textContent).toContain('複製の名前')
    expect(errors.map(String).join('\n')).toBe('')
  })
})
