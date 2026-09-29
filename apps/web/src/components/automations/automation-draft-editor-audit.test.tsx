// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R481: 名前だけの編集で2件目以降の処理が消えない。
 * R482: 日本以外の端末でも日時がずれない。
 * 本物のReactで `AutomationDraftEditor` をmountし、保存に送る中身を見る。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-1' }) }))
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
import { isoToJstDatetimeLocal } from './automation-datetime'

const mockResources = api.automations.draftResources as unknown as ReturnType<typeof vi.fn>
const mockGetDraft = api.automations.getDraft as unknown as ReturnType<typeof vi.fn>
const mockUpdateDraft = api.automations.updateDraft as unknown as ReturnType<typeof vi.fn>

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function ok<T>(data: T) {
  return { success: true, data }
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

async function mountWithDraft(draft: Record<string, unknown>): Promise<HTMLDivElement> {
  mockGetDraft.mockResolvedValue(ok(draft))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<AutomationDraftEditor draftId="draft-1" />)
  })
  await act(async () => { await drainMicrotasks() })
  if (!container.textContent?.includes('ルール名')) throw new Error('下書き編集が出ませんでした')
  return container
}

function setInputValue(el: HTMLDivElement, id: string, value: string): void {
  const input = el.querySelector(`#${CSS.escape(id)}`) as HTMLInputElement
  if (!input) throw new Error(`#${id} が見つかりません`)
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function saveButton(el: HTMLDivElement): HTMLButtonElement {
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === '下書きを保存')
  if (!button) throw new Error('「下書きを保存」ボタンが見つかりません')
  return button as HTMLButtonElement
}

const twoActionDraft = () => ({
  id: 'draft-1',
  draftVersionId: 'v1',
  name: '確認用ルール',
  description: null,
  eventType: 'tag_change',
  triggerConfig: { tagId: 'tag-1', action: 'add' },
  conditions: { operator: 'and', rules: [] },
  actions: [
    { id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' },
    { id: 'msg', type: 'send_message', params: { messageType: 'text', content: 'こんにちは' }, onFailure: 'stop' },
  ],
})

describe('R481: 名前だけ変えても処理・順序・ID・入力値が残る', () => {
  it('2処理のルールを名前だけ変えて保存しても2処理のまま', async () => {
    const el = await mountWithDraft(twoActionDraft())
    expect(el.textContent).toContain('ほかに1件の処理があります')
    setInputValue(el, 'au-name', '名前を変えたルール')
    await act(async () => { saveButton(el).click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdateDraft).toHaveBeenCalledTimes(1)
    expect(mockUpdateDraft.mock.calls[0][2]).toMatchObject({
      name: '名前を変えたルール',
      actions: [
        { id: 'tag', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' },
        { id: 'msg', type: 'send_message', params: { messageType: 'text', content: 'こんにちは' }, onFailure: 'stop' },
      ],
    })
  })
})

describe('R482: 端末の時差で日時がずれない', () => {
  const zones = ['Asia/Tokyo', 'Asia/Ho_Chi_Minh', 'UTC'] as const
  it.each(zones)('%s の端末でも日本時間で読む', (zone) => {
    process.env.TZ = zone
    // 2099-10-10T03:00Z ＝ 日本12時。端末によらず日本時間で出す。
    expect(isoToJstDatetimeLocal('2099-10-10T03:00:00.000Z')).toBe('2099-10-10T12:00')
  })

  it('未変更のまま保存すると絶対時刻が一致する', async () => {
    process.env.TZ = 'UTC'
    const el = await mountWithDraft({
      id: 'draft-1',
      draftVersionId: 'v1',
      name: '日時ルール',
      description: null,
      eventType: 'datetime',
      triggerConfig: { at: '2099-10-10T03:00:00.000Z', friendIds: ['friend-1'] },
      conditions: {},
      actions: [{ id: 'step-1', type: 'send_message', params: { messageType: 'text', content: 'こんにちは' }, onFailure: 'stop' }],
    })
    // DateTimeField はボタンの見た目で出す。日本時間12時が出ることを見る。
    const field = el.querySelector('#au-trigger-at')
    expect(field?.textContent).toContain('12:00')
    await act(async () => { saveButton(el).click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdateDraft).toHaveBeenCalledTimes(1)
    expect(mockUpdateDraft.mock.calls[0][2]).toMatchObject({
      triggerConfig: { at: '2099-10-10T03:00:00.000Z', friendIds: ['friend-1'] },
    })
    process.env.TZ = 'Asia/Tokyo'
  })
})
