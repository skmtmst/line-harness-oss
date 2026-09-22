// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * DETAIL-13/14/15 の回帰テスト（追加詳細監査・#1001）。
 * 本物のReactで新規作成ページをmountし、下書きの結び付き方を見張る。
 *
 * - D13a: 素の /automations/new は常に新規。保存済み控えがあっても
 *         前の下書きを読まず・更新せず、新しい下書きを作る。
 * - D13b: ?draft=<番号> だけが再開。番号・中身・版を一緒に読み、
 *         読み込み中は保存できず、保存は同じ下書きの更新になる。
 * - D14 : 店を切り替えると入力はその店の控えへ。別の店の文面が
 *         残ったまま保存されることはなく、戻れば自分の入力が戻る。
 * - D15 : 保存できたあとに「まだ保存していません」が残らない。
 */

const account = vi.hoisted(() => ({ id: 'account-1' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: account.id }) }))

// 権限フックは happy-dom の localStorage を読むため、固定で通す。
vi.mock('@/components/automations/use-common-action-permission', () => ({ useCanManageCommonActions: () => true }))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      // 条件部品が選択肢を読みに行く口。本物へ飛ばさない。
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
      },
    },
  }
})

import { api } from '@/lib/api'
import NewAutomationPage from './page'

const mockList = api.automations.list as unknown as ReturnType<typeof vi.fn>
const mockResources = api.automations.draftResources as unknown as ReturnType<typeof vi.fn>
const mockCreate = api.automations.createDraftFromTemplate as unknown as ReturnType<typeof vi.fn>
const mockUpdate = api.automations.updateDraft as unknown as ReturnType<typeof vi.fn>
const mockGet = api.automations.getDraft as unknown as ReturnType<typeof vi.fn>
const mockPreview = api.automations.audiencePreview as unknown as ReturnType<typeof vi.fn>
const mockPublish = api.automations.publishDraft as unknown as ReturnType<typeof vi.fn>

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function ok<T>(data: T) {
  return { success: true, data }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  account.id = 'account-1'
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/automations/new')
  vi.stubGlobal('sessionStorage', window.sessionStorage)
  mockList.mockReset()
  mockResources.mockReset()
  mockCreate.mockReset()
  mockUpdate.mockReset()
  mockGet.mockReset()
  mockPreview.mockReset()
  mockPublish.mockReset()
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
  mockCreate.mockResolvedValue(ok({ id: 'draft-9', draftVersionId: 'v1' }))
  mockUpdate.mockResolvedValue(ok({ draftVersionId: 'v2' }))
  mockGet.mockResolvedValue(ok({
    id: 'draft-9', draftVersionId: 'v2', name: '確認用', description: null,
    eventType: 'message_received', triggerConfig: {}, conditions: {},
    actions: [{ id: 'step-1', type: 'start_scenario', params: { scenarioId: 'scenario-1' }, onFailure: 'stop' }],
  }))
  mockPreview.mockResolvedValue(ok({ automationId: 'draft-9', versionId: 'v2', matched: 3, total: 10, freshness: 'available', calculatedAt: '2026-09-14T00:00:00+09:00' }))
  mockPublish.mockResolvedValue(ok({ id: 'draft-9', versionId: 'v2', versionNumber: 1, status: 'active' }))
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

/** ネイティブselectへ値を入れる。 */
async function chooseOption(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function typeText(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickButton(el: HTMLElement, text: string): Promise<void> {
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === text)
  if (!button) throw new Error(`ボタンが見つかりません: ${text}`)
  await act(async () => { (button as HTMLButtonElement).click() })
}

function findButton(el: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === text)
  if (!button) throw new Error(`ボタンが見つかりません: ${text}`)
  return button as HTMLButtonElement
}

describe('AUDIT automation draft identity and data', () => {
  it('D13a: 素の新規URLは保存済み控えを復元せず、新しい下書きを作る', async () => {
    sessionStorage.setItem('lh-automation-new-draft-v1', JSON.stringify({ 'account-1': { id: 'previous-draft', draftVersionId: 'saved-v1' } }))
    const el = await mountPage()
    // 素のURLでは前の下書きを読みに行かない（再開は ?draft= だけ）。
    expect(mockGet).not.toHaveBeenCalled()
    const name = el.querySelector('input[id="au-name"]') as HTMLInputElement
    expect(name.value).toBe('')
    await typeText(name, '別の新しいルール')
    const tag = el.querySelector('select[aria-label="自動化で付けるタグ"]') as HTMLSelectElement
    await chooseOption(tag, 'tag-1')
    await clickButton(el, '下書きに保存')
    // 前の下書きを上書きせず、新しい下書きを作ってそこへ保存する。
    expect(mockCreate).toHaveBeenCalledWith('received-message-tag', 'account-1')
    expect(mockUpdate).not.toHaveBeenCalledWith('previous-draft', expect.anything(), expect.anything())
    expect(mockUpdate).toHaveBeenCalledWith('draft-9', 'account-1', expect.objectContaining({ name: '別の新しいルール' }))
  })

  it('D13b: ?draft= を付けた再開は番号・中身・版を一緒に読み、同じ下書きを更新する', async () => {
    sessionStorage.setItem('lh-automation-new-draft-v1', JSON.stringify({ 'account-1': { id: 'previous-draft', draftVersionId: 'saved-v1' } }))
    mockGet.mockResolvedValue(ok({
      id: 'previous-draft', draftVersionId: 'v7', name: '途中のルール', description: null,
      eventType: 'message_received', triggerConfig: { keyword: '予約' }, conditions: {},
      actions: [{ id: 'step-1', type: 'add_tag', params: { tagId: 'tag-1' }, onFailure: 'stop' }],
    }))
    window.history.pushState(null, '', '/automations/new?draft=previous-draft')
    const el = await mountPage()
    expect(mockGet).toHaveBeenCalledWith('previous-draft', 'account-1')
    // 名前と中身がフォームへ戻る。
    expect((el.querySelector('input[id="au-name"]') as HTMLInputElement).value).toBe('途中のルール')
    await clickButton(el, '下書きに保存')
    // 新しい下書きは作らず、読んだ版を条件に同じ下書きを更新する。
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith('previous-draft', 'account-1', expect.objectContaining({ expectedDraftVersionId: 'v7' }))
  })

  it('D13c: 再開の読み込みが終わるまで保存ボタンは押せない', async () => {
    sessionStorage.setItem('lh-automation-new-draft-v1', JSON.stringify({ 'account-1': { id: 'previous-draft', draftVersionId: 'saved-v1' } }))
    mockGet.mockReturnValue(new Promise(() => {}))
    window.history.pushState(null, '', '/automations/new?draft=previous-draft')
    const el = await mountPage()
    expect(mockGet).toHaveBeenCalledWith('previous-draft', 'account-1')
    const saveButton = findButton(el, '下書きに保存')
    expect(saveButton.disabled).toBe(true)
    expect(el.textContent).toContain('下書きを読み込んでいます')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('D14: 店を切り替えると入力はその店の控えへ。別店の文面は残らず、戻れば復元する', async () => {
    const el = await mountPage()
    await typeText(el.querySelector('#au-name') as HTMLInputElement, 'A店専用ルール')
    const action = el.querySelector('select[id^="au-action"]') as HTMLSelectElement
    await chooseOption(action, 'send_message')
    const message = el.querySelector('textarea')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(message, 'A店限定のお知らせ')
      message.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // A店 → B店。A店の文面がB店の画面へ残らない。
    account.id = 'account-2'
    await act(async () => { root!.render(<NewAutomationPage />) })
    expect((el.querySelector('#au-name') as HTMLInputElement).value).toBe('')
    expect(el.textContent).toContain('そのアカウントを選び直すと戻ります')
    // B店でB店の内容を入れて保存すると、B店の下書きとして作られる。
    await typeText(el.querySelector('#au-name') as HTMLInputElement, 'B店のルール')
    await chooseOption(el.querySelector('select[aria-label="自動化で付けるタグ"]') as HTMLSelectElement, 'tag-1')
    await clickButton(el, '下書きに保存')
    expect(mockCreate).toHaveBeenCalledWith('received-message-tag', 'account-2')
    expect(mockUpdate).toHaveBeenCalledWith('draft-9', 'account-2', expect.objectContaining({ name: 'B店のルール' }))
    // B店 → A店。A店の入力がそのまま戻る。
    account.id = 'account-1'
    await act(async () => { root!.render(<NewAutomationPage />) })
    expect((el.querySelector('#au-name') as HTMLInputElement).value).toBe('A店専用ルール')
    expect(el.querySelector('textarea')!.value).toBe('A店限定のお知らせ')
  })

  it('D15: 保存できたあとに「まだ保存していません」は残らない', async () => {
    const el = await mountPage()
    await typeText(el.querySelector('#au-name') as HTMLInputElement, '保存済みルール')
    await chooseOption(el.querySelector('select[aria-label="自動化で付けるタグ"]') as HTMLSelectElement, 'tag-1')
    await clickButton(el, '下書きに保存')
    expect(el.textContent).toContain('下書きに保存しました')
    expect(el.textContent).not.toContain('まだ保存していません')
    // 保存のあとで直すと、ふたたび未保存側へ戻る。
    await typeText(el.querySelector('#au-name') as HTMLInputElement, '保存済みルール・改')
    expect(el.textContent).toContain('保存したあとに内容を変更しています')
  })
})
