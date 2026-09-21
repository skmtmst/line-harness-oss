// @vitest-environment happy-dom
/*
 * SCENARIO-15: 対象条件・同時購読などの設定を保存し直したあと、
 * 「新規開始予定」などの試算表示が取り直されるかを、実画面を描いて確かめる。
 *
 * ここではソースの文字列ではなく挙動を見る：
 *   - 設定を保存 → 試算を取り直し、新しい人数が出る
 *   - 取り直しているあいだは古い人数ではなく「計算しています」が出る
 *   - 遅れて届いた旧世代の試算は、新しい版を上書きしない
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
    deliveryMode: 'elapsed',
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

const network = vi.hoisted(() => ({
  /** simulate の呼び出し回数。 */
  simulateCalls: 0,
  /** 'auto' なら plannedNow で即答、'manual' なら試験側が解決するまで待つ。 */
  simulateMode: 'auto' as 'auto' | 'manual',
  plannedNow: 10,
  /** 手動モードで保留中の応答。呼び出し順に解決する。 */
  pendingSimulate: [] as Array<(planned: number) => void>,
  updateBodies: [] as Record<string, unknown>[],
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
/* SCENARIO-20 でフォルダ候補の取得にアカウントを使うようになったため、
 * この試験では固定の選択アカウントを返す。 */
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', accounts: [{ id: 'acc-1', name: '検証A' }] }),
}))

/* 本試験は試算の取り直しだけを見る。開かない窓・見せない部品は空の部品に替える。 */
vi.mock('@/components/flex-preview', () => ({ default: () => null }))
vi.mock('@/components/scenarios/bulk-preview-modal', () => ({ default: () => null }))
vi.mock('@/components/scenarios/trigger-editor', () => ({ default: () => null }))
vi.mock('@/components/scenarios/action-editor', () => ({ default: () => null }))
vi.mock('@/components/scenarios/carousel-picker', () => ({ default: () => null }))
vi.mock('@/components/scenarios/insert-toolbar', () => ({ default: () => null }))
vi.mock('@/components/scenarios/step-preview', () => ({ default: () => null }))
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
  /* 「対象を保存」を押すと条件を保存して閉じる、だけの窓。 */
  ConditionDialog: ({
    onSave,
    onClose,
  }: {
    onSave: (condition: unknown) => Promise<void>
    onClose: () => void
  }) => (
    <button
      type="button"
      onClick={() => {
        void onSave({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag-1' }] }).then(() =>
          onClose(),
        )
      }}
    >
      対象を保存
    </button>
  ),
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

const simulationBody = (planned: number) => ({
  scenarioId: SCENARIO_ID,
  lineAccountId: 'acc-1',
  computedAt: '2026-09-21T00:00:00.000Z',
  sideEffects: false,
  audience: {
    accountTotal: 100,
    matched: planned,
    alreadySubscribed: 0,
    newStartPlanned: planned,
    excluded: 0,
  },
  steps: [],
})

vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const { pathname } = new URL(url)
  const method = init?.method ?? 'GET'

  if (pathname === `/api/scenarios/${SCENARIO_ID}/simulate`) {
    network.simulateCalls += 1
    if (network.simulateMode === 'auto') return json({ success: true, data: simulationBody(network.plannedNow) })
    return new Promise<Response>((resolve) => {
      network.pendingSimulate.push((planned) => resolve(json({ success: true, data: simulationBody(planned) })))
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
  if (pathname === `/api/scenarios/${SCENARIO_ID}` && method === 'PUT') {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    network.updateBodies.push(body)
    Object.assign(fixture.scenario, body)
    return json({ success: true, data: fixture.scenario })
  }
  if (pathname === `/api/scenarios/${SCENARIO_ID}`) {
    return json({ success: true, data: fixture.scenario })
  }
  if (pathname === '/api/folders') return json({ success: true, data: [] })
  if (pathname === '/api/templates') return json({ success: true, data: [] })
  if (pathname === '/api/tags') return json({ success: true, data: [] })
  return json({ success: false, error: `未用意の経路: ${method} ${pathname}` }, 404)
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

async function clickText(text: string) {
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent === text)
  expect(button, `ボタンが見つかりません: ${text}`).toBeTruthy()
  await act(async () => {
    button!.click()
  })
}

/** 指定した呼び出し番号（0始まり）の手動試算を、人数つきで解決する。 */
async function resolveSimulate(callIndex: number, planned: number) {
  const resolve = network.pendingSimulate[callIndex]
  expect(resolve, `試算の呼び出し ${callIndex} が保留されていません`).toBeTruthy()
  await act(async () => {
    resolve(planned)
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(async () => {
  network.simulateCalls = 0
  network.simulateMode = 'auto'
  network.plannedNow = 10
  network.pendingSimulate = []
  network.updateBodies = []
  fixture.scenario.allowConcurrent = true
  fixture.scenario.audienceCondition = null
  // 参照キャッシュは画面と同じ実物を使う。前の試験の結果を残さない。
  scenarioReferenceData.invalidateScenario(SCENARIO_ID)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mounted = true
  act(() => {
    root.render(<ScenarioDetailClient scenarioId={SCENARIO_ID} />)
  })
  // マウント時の読み込み（シナリオ・きっかけ件数・試算）をここで流し切る。
  await flush()
})

afterEach(() => {
  if (mounted) {
    act(() => root.unmount())
    mounted = false
  }
  host.remove()
})

describe('SCENARIO-15: 設定を保存し直すと試算を取り直す', () => {
  it('対象条件の保存で新しい人数へ更新される', async () => {
    await flush()
    expect(host.textContent).toContain('新規開始予定 10人')
    const before = network.simulateCalls
    expect(before).toBeGreaterThan(0)

    network.plannedNow = 42
    // 「対象の絞り込み」の窓を開いて保存する。
    await clickText('対象：全員')
    await clickText('対象を保存')
    await flush()

    expect(network.updateBodies.length).toBe(1)
    expect(network.updateBodies[0]).toHaveProperty('audienceCondition')
    expect(network.simulateCalls).toBeGreaterThan(before)
    expect(host.textContent).toContain('新規開始予定 42人')
    expect(host.textContent).not.toContain('新規開始予定 10人')
  })

  it('同時購読の切替保存でも取り直す', async () => {
    await flush()
    expect(host.textContent).toContain('新規開始予定 10人')
    const before = network.simulateCalls

    network.plannedNow = 7
    await clickText('同時購読を許可中')
    await flush()

    expect(network.simulateCalls).toBeGreaterThan(before)
    expect(host.textContent).toContain('新規開始予定 7人')
  })

  it('取り直し中は古い人数を出さず、遅い旧試算は新しい版を上書きしない', async () => {
    await flush()
    expect(host.textContent).toContain('新規開始予定 10人')

    network.simulateMode = 'manual'
    // 1回目の保存 → 取り直しが走る（新しい呼び出しが pending に乗る）
    const pendingBefore = network.pendingSimulate.length
    await clickText('同時購読を許可中')
    await flush(3)
    // 古い「10人」は確定値として残らず、計算中と分かる。
    expect(host.textContent).toContain('計算しています')
    expect(host.textContent).not.toContain('新規開始予定 10人')

    // 2回目の保存（同時購読を元に戻す）→ さらに新しい世代の取り直し。
    await clickText('同時に購読できるシナリオは 1つ')
    await flush(3)
    const latestIndex = network.pendingSimulate.length - 1
    expect(latestIndex).toBeGreaterThanOrEqual(pendingBefore + 1)

    // 新しい世代が先に届く → その値を出す。
    await resolveSimulate(latestIndex, 42)
    await flush(2)
    expect(host.textContent).toContain('新規開始予定 42人')

    // 遅れて届いた旧世代（pending の先頭）を解決しても上書きされない。
    await resolveSimulate(pendingBefore, 999)
    await flush(2)
    expect(host.textContent).toContain('新規開始予定 42人')
    expect(host.textContent).not.toContain('999人')
  })
})
