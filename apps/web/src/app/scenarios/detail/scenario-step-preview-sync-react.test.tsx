// @vitest-environment happy-dom
/*
 * #616 SC-02b の回帰試験。
 *
 * 通の編集で配信時間を「1分」へ変えると、右の柱の「設定内容」は
 * 「1分後」へ更新されるのに、同じ柱の「配信の流れ」「設定サマリー」は
 * 「すぐに」のまま残っていた。原因は StepPreview へ分（relative では
 * delayMinutes 自体）が渡っていなかったこと。
 *
 * ここでは実画面を描いて、入力 → プレビューの連動を確かめる：
 *   - elapsed で「分」を 1 にすると、プレビューが「1分後」になる
 *   - relative で「遅延（分）」を 1 にすると、同じく「1分後」になる
 *   - どちらも「すぐに」の表示は残らない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SCENARIO_ID = 'sc-1'

const fixture = vi.hoisted(() => ({
  scenario: {
    id: 'sc-1',
    name: 'テストシナリオ',
    description: null,
    triggerType: 'friend_add',
    triggerTagId: null,
    isActive: true,
    allowConcurrent: true,
    folderId: null,
    lineAccountId: 'acc-1',
    deliveryMode: 'elapsed' as 'elapsed' | 'relative',
    audienceCondition: null as unknown,
    onCompleteMode: 'pause',
    onCompleteScenarioId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    steps: [
      {
        id: 'st-1',
        scenarioId: 'sc-1',
        stepOrder: 1,
        delayMinutes: 0,
        offsetDays: 0,
        offsetMinutes: 0,
        deliveryTime: '09:00',
        templateId: null,
        onReachTagId: null,
        afterSend: 'continue',
        messageType: 'text',
        messageContent: '本文です',
        targetCondition: null,
        question: null,
        isDraft: false,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  },
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children?: React.ReactNode
    className?: string
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', accounts: [{ id: 'acc-1', name: '検証A' }] }),
}))

/*
 * 本題は右の柱（StepPreview）と入力の連動。StepPreview は実物を描く。
 * 開かない窓・本題と関係ない重い部品は空に替える。
 */
vi.mock('@/components/flex-preview', () => ({ default: () => null }))
vi.mock('@/components/scenarios/bulk-preview-modal', () => ({ default: () => null }))
vi.mock('@/components/scenarios/trigger-editor', () => ({ default: () => null }))
vi.mock('@/components/scenarios/action-editor', () => ({ default: () => null }))
vi.mock('@/components/scenarios/carousel-picker', () => ({ default: () => null }))
vi.mock('@/components/scenarios/insert-toolbar', () => ({ default: () => null }))
vi.mock('@/components/scenarios/message-kind-fields', () => ({
  default: () => null,
  emptyMessageKindState: () => ({}),
  parseMessageKind: () => ({}),
  serializeMessageKind: () => null,
}))
vi.mock('@/components/scenarios/question-editor', () => ({
  default: () => null,
  emptyQuestion: () => ({}),
  isUriOnlyBehavior: () => false,
  deadAnswerSettings: () => [],
}))
vi.mock('@/components/scenarios/scenario-dialogs', () => ({
  ConditionDialog: () => null,
  OnCompleteDialog: () => null,
  TestSendDialog: () => null,
  ON_COMPLETE_LABEL: { pause: '一時停止', resume_previous: '前へ戻す', move: '別のシナリオへ' },
  describeCondition: (condition: unknown) => (condition ? '詳細条件あり' : '全員'),
}))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const { pathname } = new URL(url)

  if (pathname === `/api/scenarios/${SCENARIO_ID}/simulate`) {
    return json({
      success: true,
      data: {
        scenarioId: SCENARIO_ID,
        lineAccountId: 'acc-1',
        computedAt: '2026-09-21T00:00:00.000Z',
        sideEffects: false,
        audience: { accountTotal: 0, matched: 0, alreadySubscribed: 0, newStartPlanned: 0, excluded: 0 },
        steps: [],
      },
    })
  }
  if (pathname === `/api/scenarios/${SCENARIO_ID}/runs`) {
    return json({
      success: true,
      data: {
        summary: { active: 0, paused: 0, completed: 0, delivering: 0 },
        subscriptions: [],
        pagination: { total: 0, limit: 50, cursor: '', nextCursor: null },
        testSends: [],
        quota: { limit: null, used: null, remaining: null, state: 'unavailable', reason: null, asOf: '' },
        concurrentBroadcasts: [],
        scenarioClickTotal: 0,
        steps: [],
      },
    })
  }
  if (pathname === `/api/scenarios/${SCENARIO_ID}/stats`) {
    return json({
      success: true,
      data: { enrolledTotal: 0, activeNow: 0, completed: 0, paused: 0, steps: [] },
    })
  }
  if (pathname === `/api/scenarios/${SCENARIO_ID}/actions`) return json({ success: true, data: [] })
  if (pathname === `/api/scenarios/${SCENARIO_ID}/triggers`) return json({ success: true, data: [] })
  if (pathname === `/api/scenarios/${SCENARIO_ID}`) {
    return json({ success: true, data: fixture.scenario })
  }
  if (pathname === '/api/folders') return json({ success: true, data: [] })
  if (pathname === '/api/templates') return json({ success: true, data: [] })
  if (pathname === '/api/tags') return json({ success: true, data: [] })
  return json({ success: false, error: `未用意の経路: ${init?.method ?? 'GET'} ${pathname}` }, 404)
})

const { default: ScenarioDetailClient } = await import('./scenario-detail-client')
const { scenarioReferenceData } = await import('@/components/scenarios/scenario-reference-data')

let host: HTMLDivElement
let root: Root
let mounted = false

/** 溜まった Promise と描画を流し切る。 */
async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mount() {
  mounted = true
  act(() => {
    root.render(<ScenarioDetailClient scenarioId={SCENARIO_ID} />)
  })
  await flush()
}

async function unmount() {
  if (mounted) {
    act(() => root.unmount())
    mounted = false
  }
}

async function openStepEdit() {
  // 行の「編集」は通の編集フォームを開く。シナリオ名の札にも「編集」が
  // あるので、表の行のものを title で拾う。
  const button = [...host.querySelectorAll('button')].find(
    (el) => el.textContent === '本文です',
  )
  expect(button, '通の編集を開く入口が見つかりません').toBeTruthy()
  await act(async () => {
    button!.click()
  })
  await flush(2)
}

/** 数字入力欄へ値を流す（React の制御付き入力を通す）。 */
async function typeNumber(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  fixture.scenario.deliveryMode = 'elapsed'
  fixture.scenario.steps[0].delayMinutes = 0
  fixture.scenario.steps[0].offsetDays = 0
  fixture.scenario.steps[0].offsetMinutes = 0
  scenarioReferenceData.invalidateScenario(SCENARIO_ID)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await unmount()
  host.remove()
})

describe('SC-02b: 配信時間の変更は配信の流れ・設定サマリーへ届く', () => {
  it('elapsed で「分」を 1 にすると、プレビューが「1分後」になり「すぐに」は残らない', async () => {
    await mount()
    await openStepEdit()

    // elapsed の ScheduleInput は 日・時間・分の順。「分後に配信」の直前の欄が分。
    const minutesInput = [...host.querySelectorAll<HTMLInputElement>('input[type=number]')].find(
      (el) => el.nextElementSibling?.textContent === '分後に配信',
    )
    expect(minutesInput, '分の入力欄が見つかりません').toBeTruthy()
    await typeNumber(minutesInput!, '1')

    expect(host.textContent).toContain('1分後に届きます（1通目）')
    // 「配信の流れ」の帯と「設定サマリー」の配信日時は「1分後・日時」の形。
    expect(host.textContent).toContain('1分後・')
    expect(host.textContent).not.toContain('すぐに')
  })

  it('relative で「遅延（分）」を 1 にすると、プレビューが「1分後」になる', async () => {
    fixture.scenario.deliveryMode = 'relative'
    await mount()
    await openStepEdit()

    // relative の ScheduleInput は「遅延 (分)」1欄だけ（説明文は「前のステップから」）。
    const delayInput = [...host.querySelectorAll<HTMLInputElement>('input[type=number]')].find(
      (el) => el.parentElement?.textContent?.includes('前のステップから'),
    )
    expect(delayInput, '遅延（分）の入力欄が見つかりません').toBeTruthy()
    await typeNumber(delayInput!, '1')

    expect(host.textContent).toContain('1分後に届きます（1通目）')
    expect(host.textContent).toContain('1分後・')
    expect(host.textContent).not.toContain('すぐに')
  })
})
