// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * R484・R485・R488・R490・R491 の回帰テスト。
 * 本物のReactで新規作成ページをmountし、確認・送信・公開の振る舞いを見張る。
 *
 * - R484: 同じ確認の再試行は同じ要求キー。確認を開くたび新しい鍵。
 * - R485: 送信前の読み取り待ちに「やめる」を押したら送信しない。
 * - R488: 受け付けた実行は日本語の状態と結果への導線で出す。
 * - R490: 公開の応答消失→再試行で404なら公開済みを照合し、作り直さない。
 * - R491: 公開待ちの店切替→戻りは公開済み案内。同じ内容の作り直しはしない。
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
const mockUpdate = api.automations.updateDraft as unknown as ReturnType<typeof vi.fn>
const mockGet = api.automations.getDraft as unknown as ReturnType<typeof vi.fn>
const mockPreview = api.automations.audiencePreview as unknown as ReturnType<typeof vi.fn>
const mockPublish = api.automations.publishDraft as unknown as ReturnType<typeof vi.fn>
const mockTest = api.automations.test as unknown as ReturnType<typeof vi.fn>
const mockGetRun = api.automations.getRun as unknown as ReturnType<typeof vi.fn>

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
  window.history.replaceState(null, '', '/automations/new')
  vi.stubGlobal('sessionStorage', window.sessionStorage)
  mockList.mockReset()
  mockResources.mockReset()
  mockCreate.mockReset()
  mockUpdate.mockReset()
  mockGet.mockReset()
  mockPreview.mockReset()
  mockPublish.mockReset()
  mockTest.mockReset()
  mockGetRun.mockReset()
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
  mockGet.mockResolvedValue(ok(draftDetail))
  mockPreview.mockResolvedValue(ok({ automationId: 'draft-9', versionId: 'v2', matched: 3, total: 10, freshness: 'available', calculatedAt: '2026-09-14T00:00:00+09:00' }))
  mockPublish.mockResolvedValue(ok({ id: 'draft-9', versionId: 'v2', versionNumber: 1, status: 'active' }))
  mockTest.mockResolvedValue(ok({ runId: 'run-1', versionId: 'v2', status: 'waiting' }))
  mockGetRun.mockResolvedValue(ok({ runId: 'run-1', status: 'success' }))
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

async function typeText(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function chooseOption(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function clickButton(el: HTMLElement, text: string): Promise<void> {
  // 確認窓は最上層（document.body）に出ることがある。器になければ全体から探す。
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === text)
    ?? Array.from(document.querySelectorAll('button')).find((node) => node.textContent === text)
  if (!button) throw new Error(`ボタンが見つかりません: ${text}`)
  await act(async () => { (button as HTMLButtonElement).click() })
  await act(async () => { await drainMicrotasks() })
}

/** 下書きを保存して1人テストの確認まで開く。確認文が出た器を返す。 */
async function openTestConfirmation(el: HTMLDivElement): Promise<void> {
  await typeText(el.querySelector('input[id="au-name"]') as HTMLInputElement, '試すルール')
  await chooseOption(el.querySelector('select[aria-label="自動化で付けるタグ"]') as HTMLSelectElement, 'tag-1')
  await clickButton(el, '下書きを保存する')
  await typeText(el.querySelector('input[aria-label="1人テストの友だちID"]') as HTMLInputElement, 'friend-1')
  await clickButton(el, '1人で試す')
  if (!el.textContent?.includes('送る前に確認してください')) throw new Error('1人テストの確認が出ませんでした')
}

/** 「つくって動かす」→確認窓→「保存して動かし始める」。 */
async function activateRule(el: HTMLDivElement): Promise<void> {
  await typeText(el.querySelector('input[id="au-name"]') as HTMLInputElement, '動かすルール')
  await chooseOption(el.querySelector('select[aria-label="自動化で付けるタグ"]') as HTMLSelectElement, 'tag-1')
  await clickButton(el, 'つくって動かす')
  await clickButton(el, '保存して動かし始める')
}

describe('R484・R485・R488: 1人テストの確認と実行', () => {
  it('R485: 送信前の読み取り待ちに「やめる」を押したら送信しない', async () => {
    const el = await mountPage()
    await openTestConfirmation(el)
    // 送信直前の読み取りを止める。
    let releaseRead!: (value: unknown) => void
    mockGet.mockReturnValueOnce(new Promise((resolve) => { releaseRead = resolve as (value: unknown) => void }))
    const send = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === 'この内容で送る') as HTMLButtonElement
    await act(async () => { send.click() })
    // 読み取り中にやめる。確認窓が消える。
    await clickButton(el, 'キャンセル')
    expect(el.textContent).not.toContain('送る前に確認してください')
    await act(async () => { releaseRead(ok(draftDetail)) })
    await act(async () => { await drainMicrotasks() })
    // 取り消した送信はPOSTへ進まない。
    expect(mockTest).not.toHaveBeenCalled()
  })

  it('R484: 同じ確認の再試行は同じ要求キー。新しい確認は別の鍵。', async () => {
    const el = await mountPage()
    await openTestConfirmation(el)
    mockTest.mockRejectedValueOnce(new Error('network down'))
    await clickButton(el, 'この内容で送る')
    // 失敗しても確認は残り、同じ確認で送り直せる。
    expect(el.textContent).toContain('送る前に確認してください')
    await clickButton(el, 'この内容で送る')
    expect(mockTest).toHaveBeenCalledTimes(2)
    const firstKey = mockTest.mock.calls[0]?.[4]
    expect(firstKey).toEqual(expect.stringMatching(/^[A-Za-z0-9._-]{8,128}$/))
    expect(mockTest.mock.calls[1]?.[4]).toBe(firstKey)
    // 確認を開き直すと別の鍵になる（意図的な再送は新しい確認）。
    await clickButton(el, '1人で試す')
    await clickButton(el, 'この内容で送る')
    expect(mockTest).toHaveBeenCalledTimes(3)
    expect(mockTest.mock.calls[2]?.[4]).not.toBe(firstKey)
  })

  it('R488: 受け付けた実行は日本語の状態と結果への導線で出す', async () => {
    const el = await mountPage()
    await openTestConfirmation(el)
    await clickButton(el, 'この内容で送る')
    expect(el.textContent).toContain('試した実行：待機中')
    expect(el.textContent).not.toContain('状態: waiting')
    await clickButton(el, '結果を読み直す')
    expect(mockGetRun).toHaveBeenCalledWith('run-1')
    expect(el.textContent).toContain('試した実行：終わりました')
  })
})

describe('R490・R491: 公開の再試行と店切替', () => {
  it('R490: 公開の応答消失→再試行の404では公開済みを照合し、作り直さない', async () => {
    mockPublish.mockRejectedValueOnce(new Error('network down'))
    const el = await mountPage()
    await activateRule(el)
    // 結果不明の案内が出る。
    expect(el.textContent).toContain('公開されているか一覧で確認してから')
    // やり直す。再試行は同じ下書きの更新から入り、404で公開済みを照合する。
    mockUpdate.mockRejectedValueOnce(new ApiError(404, '編集中の下書きが見つかりません'))
    mockList.mockResolvedValue(ok([{ id: 'draft-9', status: 'active' }]))
    await activateRule(el)
    expect(el.textContent).toContain('すでに公開されています')
    // 新しい下書きは作らない（稼働ルールを2件にしない）。
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/automations?highlight=draft-9')
  })
})

describe('R486・R487・R489: 共通アクションの版と公開の照合', () => {
  /** 共通アクションを1件呼ぶ下書き。確認時の固定版は cv-1（第3版）。 */
  const draftWithCommonAction = {
    ...draftDetail,
    actions: [{ id: 'step-1', type: 'common_action', params: { commonActionId: 'ca-1' }, onFailure: 'stop' }],
    commonActionRefs: [{
      stepId: 'step-1', commonActionId: 'ca-1',
      name: 'お迎え一式', versionId: 'cv-1', versionNumber: 3,
    }],
    commonActionVersions: {
      'cv-1': {
        commonActionId: 'ca-1', name: 'お迎え一式', versionNumber: 3,
        actions: [
          { id: 's1', type: 'send_message', params: { content: 'お待ちしております' }, onFailure: 'stop' },
        ],
      },
      'cv-2': {
        commonActionId: 'ca-1', name: 'お迎え一式', versionNumber: 4,
        actions: [
          { id: 's1', type: 'send_message', params: { content: '別の文面です' }, onFailure: 'stop' },
        ],
      },
    },
  }

  it('R486: 確認には共通アクションの固定版と実際の本文を出す', async () => {
    mockGet.mockResolvedValue(ok(draftWithCommonAction))
    const el = await mountPage()
    await openTestConfirmation(el)
    expect(el.textContent).toContain('共通アクション「お迎え一式」第3版：メッセージ「お待ちしております」')
  })

  it('R487: 確認した版の一式を実行要求へ添える', async () => {
    mockGet.mockResolvedValue(ok(draftWithCommonAction))
    const el = await mountPage()
    await openTestConfirmation(el)
    await clickButton(el, 'この内容で送る')
    expect(mockTest).toHaveBeenCalledWith(
      'draft-9', 'account-1', 'friend-1', 'v2', expect.any(String),
      [{ stepId: 'step-1', commonActionId: 'ca-1', versionId: 'cv-1' }],
    )
  })

  it('R487: 確認後に利用版が切り替わっていたら送らない', async () => {
    mockGet.mockResolvedValue(ok(draftWithCommonAction))
    const el = await mountPage()
    await openTestConfirmation(el)
    // 送信直前の読み直しで、別担当が束を cv-2 へ切り替えている。
    // 版の札と中身の指紋は同じまま（束の切り替えは下書きを変えない）。
    mockGet.mockResolvedValue(ok({
      ...draftWithCommonAction,
      commonActionRefs: [{
        stepId: 'step-1', commonActionId: 'ca-1',
        name: 'お迎え一式', versionId: 'cv-2', versionNumber: 4,
      }],
    }))
    await clickButton(el, 'この内容で送る')
    expect(mockTest).not.toHaveBeenCalled()
    expect(el.textContent).toContain('もう一度、送る内容を確認してください')
    expect(el.textContent).not.toContain('送る前に確認してください')
  })

  it('R486: 共通アクションの版を確認できなければ確認画面を開かない', async () => {
    mockGet.mockResolvedValue(ok({
      ...draftWithCommonAction,
      commonActionRefs: [{
        stepId: 'step-1', commonActionId: 'ca-1',
        name: 'お迎え一式', versionId: null, versionNumber: null,
      }],
    }))
    const el = await mountPage()
    await typeText(el.querySelector('input[id="au-name"]') as HTMLInputElement, '試すルール')
    await chooseOption(el.querySelector('select[aria-label="自動化で付けるタグ"]') as HTMLSelectElement, 'tag-1')
    await clickButton(el, '下書きを保存する')
    await typeText(el.querySelector('input[aria-label="1人テストの友だちID"]') as HTMLInputElement, 'friend-1')
    await clickButton(el, '1人で試す')
    expect(el.textContent).not.toContain('送る前に確認してください')
    expect(el.textContent).toContain('共通アクションの内容を確認できませんでした')
  })

  it('R489: 保存と読み直しの間に別の人が保存していたら、確認せず公開しない', async () => {
    // PUTは自分の版（v2）を返すが、直後のGETは別担当の版（v3）を返す。
    mockGet.mockResolvedValue(ok({ ...draftDetail, draftVersionId: 'v3-other' }))
    const el = await mountPage()
    await activateRule(el)
    expect(mockPublish).not.toHaveBeenCalled()
    expect(el.textContent).toContain('ほかの人が同じ下書きを保存しました')
    // 自分の入力は消えず、相手の保存も消えない（双方保持）。
    expect((el.querySelector('input[id="au-name"]') as HTMLInputElement).value).toBe('動かすルール')
  })
})

describe('R491: 公開待ちの店切替', () => {
  it('R491: 公開待ちの店切替→戻りは公開済み案内。同じ内容の作り直しはしない', async () => {
    let releasePublish!: (value: unknown) => void
    mockPublish.mockReturnValueOnce(new Promise((resolve) => { releasePublish = resolve as (value: unknown) => void }))
    const el = await mountPage()
    await typeText(el.querySelector('input[id="au-name"]') as HTMLInputElement, '動かすルール')
    await chooseOption(el.querySelector('select[aria-label="自動化で付けるタグ"]') as HTMLSelectElement, 'tag-1')
    await clickButton(el, 'つくって動かす')
    await clickButton(el, '保存して動かし始める')
    // 公開待ちの間にB店へ。
    account.id = 'account-2'
    await act(async () => { root!.render(<NewAutomationPage />) })
    await act(async () => { await drainMicrotasks() })
    // A店の公開が済む。
    await act(async () => { releasePublish(ok({ id: 'draft-9', versionId: 'v2', versionNumber: 1, status: 'active' })) })
    await act(async () => { await drainMicrotasks() })
    // A店へ戻ると公開済みの案内。未公開の下書き扱いにしない。
    account.id = 'account-1'
    await act(async () => { root!.render(<NewAutomationPage />) })
    await act(async () => { await drainMicrotasks() })
    expect(el.textContent).toContain('この内容はすでに公開済みです')
    // 同じ内容のまま「つくって動かす」は作り直さず元のルールへ案内する。
    await clickButton(el, 'つくって動かす')
    await clickButton(el, '保存して動かし始める')
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/automations?highlight=draft-9')
  })
})
