// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTOMATION_DRAFT_ACTION_OPTIONS,
  AUTOMATION_DRAFT_TRIGGER_OPTIONS,
} from '@line-crm/shared'

/*
 * #734: 下書き編集の選択肢は共有の正本から描く。新規作成と同じ一覧。
 * ここは現役のV8下書き仕上げを描き、共有を本物で
 * import して振る舞いを見張る。文字列の有無だけ見る試験は置かない。
 *
 * - E1: すべてのきっかけが共有の正本と一致する(順番まで)
 * - E2: 行うことを足す選択肢が共有の正本の編集可能な処理と一致する
 * - E3: 新規作成で作った注文確定の下書きが、正しい名前で出る(先頭落ちしない)
 * - E4: 欄の無い設定(formId)は開いて保存しただけで消えない
 * - E5: きっかけを切り替えて戻すと、入力中の設定が残る
 * - E6: 日時が空のまま保存できない
 */

vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
// 権限フックは happy-dom の localStorage を読むため、固定で通す(表示の目安であり本当の可否はサーバが決める)。
vi.mock('@/components/automations/use-common-action-permission', () => ({ useCanManageCommonActions: () => true }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      friends: { ...actual.api.friends, get: vi.fn().mockResolvedValue({ success: true, data: { displayName: '友だち' } }) },
      forms: { ...actual.api.forms, list: vi.fn().mockResolvedValue({ success: true, data: [] }) },
      automations: {
        ...actual.api.automations,
        list: vi.fn().mockResolvedValue({ success: true, data: [] }),
        audiencePreview: vi.fn().mockResolvedValue({ success: true, data: { matched: 1, total: 1 } }),
        draftResources: vi.fn(),
        getDraft: vi.fn(),
        updateDraft: vi.fn(),
      },
    },
  }
})

import { api } from '@/lib/api'
import { NewAutomationV8 } from '@/v8/automations/create/create'

const mockResources = api.automations.draftResources as unknown as ReturnType<typeof vi.fn>
const mockGetDraft = api.automations.getDraft as unknown as ReturnType<typeof vi.fn>
const mockUpdateDraft = api.automations.updateDraft as unknown as ReturnType<typeof vi.fn>

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function ok<T>(data: T) {
  return { success: true, data }
}

function draftOf(eventType: string, triggerConfig: Record<string, unknown>) {
  return {
    id: 'draft-1',
    draftVersionId: 'v1',
    name: '確認用ルール',
    description: null,
    eventType,
    triggerConfig,
    conditions: {},
    actions: [{ id: 'step-1', type: 'send_message', params: { messageType: 'text', content: 'こんにちは' }, onFailure: 'stop' }],
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/automations/drafts?id=draft-1')
  mockResources.mockReset()
  mockGetDraft.mockReset()
  mockUpdateDraft.mockReset()
  mockResources.mockResolvedValue(ok({ tags: [{ id: 'tag-1', name: '予約' }], scenarios: [] }))
  mockUpdateDraft.mockResolvedValue(ok({ draftVersionId: 'v2' }))
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  if (container) container.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  delete document.documentElement.dataset.theme
  vi.clearAllMocks()
})

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

async function mountWithDraft(eventType: string, triggerConfig: Record<string, unknown>, actions?: Array<{ id: string; type: string; params: Record<string, unknown>; onFailure: string }>): Promise<HTMLDivElement> {
  const draft = { ...draftOf(eventType, triggerConfig), ...(actions ? { actions } : {}) }
  mockGetDraft.mockImplementation(async () => ok(mockUpdateDraft.mock.calls.length
    ? { ...draft, ...mockUpdateDraft.mock.calls.at(-1)![2], draftVersionId: 'v2' }
    : draft))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<NewAutomationV8 initialDraftId="draft-1" chrome="draft" />)
  })
  await act(async () => { await drainMicrotasks() })
  if (!container.textContent?.includes('きっかけ')) throw new Error('下書き編集が出ませんでした')
  return container
}

function saveButton(el: HTMLDivElement): HTMLButtonElement {
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === '下書きを保存')
  if (!button) throw new Error('「下書きを保存する」ボタンが見つかりません')
  return button as HTMLButtonElement
}

describe('下書き編集の選択可能一覧(#734)', () => {
  it('E1: すべてのきっかけが共有の正本と一致する', async () => {
    const el = await mountWithDraft('friend_add', {})
    const expand = Array.from(el.querySelectorAll('button')).find(button => button.textContent?.includes('ほかのきっかけもすべて見る'))!
    await act(async () => { expand.click() })
    const radios = Array.from(el.querySelectorAll<HTMLInputElement>('input[name="v8-trigger"]'))
    expect(radios.map(input => input.value)).toEqual(AUTOMATION_DRAFT_TRIGGER_OPTIONS.map(option => option.value))
    for (const option of AUTOMATION_DRAFT_TRIGGER_OPTIONS) {
      expect(radios.find(input => input.value === option.value)?.parentElement?.textContent).toContain(option.label)
    }
  })

  it('E2: 行うことを足す選択肢が共有の正本の編集可能な処理と一致する', async () => {
    const notification = { id: 'notify-1', type: 'notify_staff', params: { notificationRuleId: 'rule-1', message: '相談が来ました' }, onFailure: 'stop' }
    const el = await mountWithDraft('friend_add', {}, [notification])
    const add = Array.from(el.querySelectorAll('button')).find(button => button.textContent?.includes('行うことを足す'))!
    await act(async () => { add.click() })
    const labels = Array.from(document.querySelectorAll('[role="menuitem"]')).map(option => option.textContent)
    // 通知は旧編集で選んでも通常の本文へ化けていた。現役では既存通知の中身を保持し、新規の選び口には出さない。
    expect(labels).toEqual(AUTOMATION_DRAFT_ACTION_OPTIONS.filter(option => option.value !== 'notify_staff').map(option => option.label))
    expect(el.textContent).toContain(AUTOMATION_DRAFT_ACTION_OPTIONS.find(option => option.value === 'notify_staff')!.label)
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { saveButton(el).click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdateDraft).toHaveBeenCalledTimes(1)
    expect(mockUpdateDraft.mock.calls[0][2].actions).toEqual([notification])
  })

  it('E3: 注文確定の下書きが正しい名前で出る', async () => {
    const el = await mountWithDraft('ec.order.confirmed', {})
    const selected = el.querySelector<HTMLInputElement>('input[name="v8-trigger"]:checked')
    expect(selected?.value).toBe('ec.order.confirmed')
    expect(selected?.parentElement?.textContent).toContain('注文が確定したとき')
  })

  it('E4: 欄の無い設定は開いて保存しただけで消えない', async () => {
    const el = await mountWithDraft('form_submitted', { formId: 'form-9' })
    await act(async () => { saveButton(el).click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdateDraft).toHaveBeenCalledTimes(1)
    expect(mockUpdateDraft.mock.calls[0][2]).toMatchObject({
      eventType: 'form_submitted',
      triggerConfig: { formId: 'form-9' },
    })
  })

  it('E5: きっかけを切り替えて戻すと入力中の設定が残る', async () => {
    const el = await mountWithDraft('message_received', {})
    const keyword = el.querySelector('#v8-rule-keyword') as HTMLInputElement
    // Reactの制御入力へは native setter で値を入れる
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(keyword, '予約')
      keyword.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect((el.querySelector('#v8-rule-keyword') as HTMLInputElement).value).toBe('予約')
    // 別のきっかけへ切り替えて戻す(押せるのは項目の中のボタン)
    await act(async () => { el.querySelector<HTMLInputElement>('input[name="v8-trigger"][value="friend_add"]')!.click() })
    await act(async () => { el.querySelector<HTMLInputElement>('input[name="v8-trigger"][value="message_received"]')!.click() })
    expect((el.querySelector('#v8-rule-keyword') as HTMLInputElement).value).toBe('予約')
  })

  it('E6: 日時が空のまま保存できない', async () => {
    const el = await mountWithDraft('datetime', { at: '', friendIds: [] })
    await act(async () => { saveButton(el).click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdateDraft).not.toHaveBeenCalled()
    expect(el.textContent).toContain('実行日時を入力してください')
  })

  it('飲食のきっかけの店の指定を開いて保存しても消さない', async () => {
    const el = await mountWithDraft('restaurant.arrived', { storeId: 'store-1' })
    expect(el.querySelector<HTMLInputElement>('input[name="v8-trigger"]:checked')?.value).toBe('restaurant.arrived')
    await act(async () => { saveButton(el).click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdateDraft).toHaveBeenCalledTimes(1)
    expect(mockUpdateDraft.mock.calls[0][2]).toMatchObject({ eventType: 'restaurant.arrived', triggerConfig: { storeId: 'store-1' } })
  })

  it('きっかけのタグが未選択なら保存せず欄の理由を出す', async () => {
    const el = await mountWithDraft('tag_change', { tagId: '', action: 'add' })
    await act(async () => { saveButton(el).click() })
    expect(mockUpdateDraft).not.toHaveBeenCalled()
    expect(el.textContent).toContain('きっかけのタグを選んでください')
    expect(el.querySelector('#v8-trigger-tag')?.getAttribute('aria-invalid')).toBe('true')
  })
})
