// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R532: 再開する下書きの取得に失敗したら保存を止める。
 *
 * - 通信断では同じ下書きの再試行だけを出し、Aの更新も新規作成も実行されない。
 * - 対象なし・権限なしでは白紙への作り直しを明示の選択にする。
 * - 再試行でAを読めた後だけ保存できる。
 */

const account = vi.hoisted(() => ({ id: 'account-1' }))
const routerPush = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: account.id }) }))
vi.mock('@/components/automations/use-common-action-permission', () => ({ useCanManageCommonActions: () => true }))

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

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      tags: { ...actual.api.tags, list: vi.fn() },
      scenarios: { ...actual.api.scenarios, list: vi.fn() },
      friendFields: { ...actual.api.friendFields, list: vi.fn() },
      supportMarks: { ...actual.api.supportMarks, list: vi.fn() },
      featureSettings: { ...actual.api.featureSettings, visibility: vi.fn() },
      segments: { ...actual.api.segments, count: vi.fn() },
      automations: {
        ...actual.api.automations,
        list: vi.fn(),
        draftResources: vi.fn(),
        createDraftFromTemplate: vi.fn(),
        updateDraft: vi.fn(),
        getDraft: vi.fn(),
        audiencePreview: vi.fn(),
        publishDraft: vi.fn(),
        test: vi.fn(),
        getRun: vi.fn(),
      },
    },
  }
})

import { api, ApiError } from '@/lib/api'
import NewAutomationPage from './page'

const mockList = api.automations.list as unknown as ReturnType<typeof vi.fn>
const mockResources = api.automations.draftResources as unknown as ReturnType<typeof vi.fn>
const mockCreate = api.automations.createDraftFromTemplate as unknown as ReturnType<typeof vi.fn>
const mockGet = api.automations.getDraft as unknown as ReturnType<typeof vi.fn>
const mockPreview = api.automations.audiencePreview as unknown as ReturnType<typeof vi.fn>

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function ok<T>(data: T) {
  return { success: true, data }
}

const draftDetail = {
  id: 'draft-9', draftVersionId: 'v2', name: '確認用', description: null,
  eventType: 'message_received', triggerConfig: {}, conditions: {},
  actions: [{ id: 'step-1', type: 'start_scenario', params: { scenarioId: 'scenario-1' }, onFailure: 'stop' }],
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  account.id = 'account-1'
  routerPush.mockReset()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/automations/new?draft=draft-9')
  vi.stubGlobal('sessionStorage', window.sessionStorage)
  mockList.mockReset()
  mockResources.mockReset()
  mockCreate.mockReset()
  mockGet.mockReset()
  mockPreview.mockReset()
  mockList.mockResolvedValue(ok([]))
  mockResources.mockResolvedValue(ok({
    tags: [{ id: 'tag-1', name: '予約' }],
    scenarios: [{ id: 'scenario-1', name: '予約後' }],
  }))
  ;(api.tags.list as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok([{ id: 'tag-1', name: '予約' }]))
  ;(api.scenarios.list as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok([{ id: 'scenario-1', name: '予約後' }]))
  ;(api.friendFields.list as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]))
  ;(api.supportMarks.list as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok([]))
  ;(api.featureSettings.visibility as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok({ features: {} }))
  ;(api.segments.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, count: 0 })
  mockCreate.mockResolvedValue(ok({ id: 'draft-new', draftVersionId: 'v1' }))
  mockGet.mockResolvedValue(ok(draftDetail))
  mockPreview.mockResolvedValue(ok({ automationId: 'draft-9', versionId: 'v2', matched: 3, total: 10, freshness: 'available', calculatedAt: '2026-09-14T00:00:00+09:00' }))
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

async function mountPage(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<NewAutomationPage />) })
  await act(async () => { await drainMicrotasks() })
  if (!container.textContent?.includes('きっかけ')) throw new Error('新規作成が出ませんでした')
  return container
}

function saveButton(el: HTMLDivElement): HTMLButtonElement {
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === '下書きを保存する')
  if (!button) throw new Error('保存ボタンが見つかりません')
  return button as HTMLButtonElement
}

function findButton(el: HTMLDivElement, text: string): HTMLButtonElement | null {
  return Array.from(el.querySelectorAll('button')).find((node) => node.textContent === text) as HTMLButtonElement ?? null
}

describe('R532 再開の取得失敗中は保存させない', () => {
  it('通信断では再試行だけが出て、保存は押せない', async () => {
    mockGet.mockRejectedValueOnce(new Error('network down'))
    const el = await mountPage()
    expect(el.textContent).toContain('下書きを読み込めませんでした')
    // 通信断では同じ下書きの再試行だけ。白紙への作り直しは出さない。
    expect(findButton(el, '下書きをもう一度読み込む')).toBeTruthy()
    expect(findButton(el, '白紙から作り直す')).toBeNull()
    // 保存は止まる（Aの更新も新規作成も実行されない）。
    expect(saveButton(el).disabled).toBe(true)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('再試行で読めた後だけ保存できる', async () => {
    mockGet.mockRejectedValueOnce(new Error('network down'))
    const el = await mountPage()
    expect(saveButton(el).disabled).toBe(true)

    mockGet.mockResolvedValueOnce(ok(draftDetail))
    const retry = findButton(el, '下書きをもう一度読み込む')
    expect(retry).toBeTruthy()
    await act(async () => { retry!.click() })
    await act(async () => { await drainMicrotasks() })

    expect(el.textContent).toContain('保存した下書きを読み込みました')
    expect(saveButton(el).disabled).toBe(false)
    // 再試行は同じ下書きの再取得で、新規作成は走らない。
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockGet).toHaveBeenCalledWith('draft-9', 'account-1')
  })

  it('対象なし（404）では白紙への作り直しを選べる', async () => {
    mockGet.mockRejectedValueOnce(new ApiError(404, 'not found'))
    const el = await mountPage()
    expect(el.textContent).toContain('指定された下書きは見つかりませんでした')
    expect(saveButton(el).disabled).toBe(true)
    expect(findButton(el, '白紙から作り直す')).toBeTruthy()

    const fresh = findButton(el, '白紙から作り直す')
    await act(async () => { fresh!.click() })
    await act(async () => { await drainMicrotasks() })

    // URLの指定が外れて保存が止まらなくなる。失敗中の自動作成は無い。
    expect(window.location.pathname + window.location.search).toBe('/automations/new')
    expect(saveButton(el).disabled).toBe(false)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
