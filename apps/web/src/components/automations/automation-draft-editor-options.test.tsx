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
 * ここは本物のReactで `AutomationDraftEditor` をmountし、共有を本物で
 * import して振る舞いを見張る。文字列の有無だけ見る試験は置かない。
 *
 * - E1: きっかけの選択肢が共有の10件と一致する(順番まで)
 * - E2: することの選択肢が共有の3件と一致する
 * - E3: 新規作成で作った注文確定の下書きが、正しい名前で出る(先頭落ちしない)
 * - E4: 欄の無い設定(formId)は開いて保存しただけで消えない
 * - E5: きっかけを切り替えて戻すと、入力中の設定が残る
 * - E6: 日時が空のまま保存できない
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
// 権限フックは happy-dom の localStorage を読むため、固定で通す(表示の目安であり本当の可否はサーバが決める)。
vi.mock('@/components/automations/use-automation-permission', () => ({ useCanManageAutomations: () => true }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      automations: {
        ...actual.api.automations,
        draftResources: vi.fn(),
        getDraft: vi.fn(),
        updateDraft: vi.fn(),
      },
    },
  }
})

import { api } from '@/lib/api'
import AutomationDraftEditor from './automation-draft-editor'

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
  vi.clearAllMocks()
})

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

async function mountWithDraft(eventType: string, triggerConfig: Record<string, unknown>): Promise<HTMLDivElement> {
  mockGetDraft.mockResolvedValue(ok(draftOf(eventType, triggerConfig)))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<AutomationDraftEditor draftId="draft-1" accountId="account-1" onSaved={() => {}} onDeleted={() => {}} />)
  })
  await act(async () => { await drainMicrotasks() })
  if (!container.textContent?.includes('きっかけ')) throw new Error('下書き編集が出ませんでした')
  return container
}

function openSelect(el: HTMLDivElement, buttonId: string): HTMLLIElement[] {
  const button = el.querySelector(`#${buttonId}`)
  if (!button) throw new Error(`#${buttonId} が見つかりません`)
  act(() => { (button as HTMLButtonElement).click() })
  const options = Array.from(el.querySelectorAll('li[role="option"]')) as HTMLLIElement[]
  if (options.length === 0) throw new Error('選択肢が出ませんでした')
  return options
}

function saveButton(el: HTMLDivElement): HTMLButtonElement {
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === '下書きを保存')
  if (!button) throw new Error('「下書きを保存」ボタンが見つかりません')
  return button as HTMLButtonElement
}

describe('下書き編集の選択可能一覧(#734)', () => {
  it('E1: きっかけの選択肢が共有の10件と一致する', async () => {
    const el = await mountWithDraft('friend_add', {})
    const labels = openSelect(el, 'au-event').map((option) => option.textContent)
    expect(labels).toEqual(AUTOMATION_DRAFT_TRIGGER_OPTIONS.map((option) => option.label))
  })

  it('E2: することの選択肢が共有の3件と一致する', async () => {
    const el = await mountWithDraft('friend_add', {})
    const labels = openSelect(el, 'au-action').map((option) => option.textContent)
    expect(labels).toEqual(AUTOMATION_DRAFT_ACTION_OPTIONS.map((option) => option.label))
  })

  it('E3: 注文確定の下書きが正しい名前で出る', async () => {
    const el = await mountWithDraft('ec.order.confirmed', {})
    const button = el.querySelector('#au-event')
    expect(button?.textContent).toContain('注文が確定したとき')
    expect(button?.textContent).not.toContain('友だちになったとき')
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
    const keyword = el.querySelector('#au-trigger-keyword') as HTMLInputElement
    // Reactの制御入力へは native setter で値を入れる
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(keyword, '予約')
      keyword.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect((el.querySelector('#au-trigger-keyword') as HTMLInputElement).value).toBe('予約')
    // 別のきっかけへ切り替えて戻す(押せるのは項目の中のボタン)
    const first = openSelect(el, 'au-event')
    await act(async () => { first[0].querySelector('button')!.click() })
    const second = openSelect(el, 'au-event')
    const back = second.find((option) => option.textContent === 'メッセージを受け取ったとき')
    await act(async () => { back!.querySelector('button')!.click() })
    expect((el.querySelector('#au-trigger-keyword') as HTMLInputElement).value).toBe('予約')
  })

  it('E6: 日時が空のまま保存できない', async () => {
    const el = await mountWithDraft('datetime', { at: '', friendIds: [] })
    await act(async () => { saveButton(el).click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdateDraft).not.toHaveBeenCalled()
    expect(el.textContent).toContain('実行日時を入力してください')
  })
})
