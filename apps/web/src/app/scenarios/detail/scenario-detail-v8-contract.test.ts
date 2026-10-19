// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ScenarioResultsV8 from '@/v8/scenarios/results'
import fs from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * ★V8 シナリオ配信の編集・配信結果の契約（#1161）。
 *
 * 文字の契約ではなく「Pencil の板と受け口が繋がっているか」の契約。
 * - detail-v8.tsx … （有効）/ （始めた直後）/ （停止中）、
 *   小窓 （開始の確認）・（停止の確認）・（複製）
 * - results-v8.tsx … （配信結果）
 * - page.tsx 2 つ … 現役 V8 に固定
 *
 * 動きの契約（API・確認キー・購読操作）はここに固定する。
 * 板の文言の一字一句は固定しない（V8 の直しで文言が変わるたびに
 * 試験を書き換えることになるため）。
 */

const V8_DETAIL_CSS = fs.readFileSync(path.join(__dirname, '../../../v8/scenario-detail/detail.module.css'), 'utf8')
const RESULTS_CURRENT = fs.readFileSync(path.join(__dirname, '../../../v8/scenarios/results.tsx'), 'utf8')
const V8_RESULTS = fs.readFileSync(
  path.join(__dirname, '../../../v8/scenarios/results.tsx'),
  'utf8',
)
const V8_RESULTS_CSS = fs.readFileSync(
  path.join(__dirname, '../../../v8/scenarios/results.module.css'),
  'utf8',
)

const resultFixture = vi.hoisted(() => ({
  stats: { enrolledTotal: 10, activeNow: 3, completed: 5, paused: 1, steps: [] },
  scenario: { id: 'sc-1', name: '新規登録フォロー', lineAccountId: 'account-a', steps: [] },
  runs: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id=sc-1'), usePathname: () => '/scenarios/results' }))
vi.mock('next/link', () => ({ default: ({ children, href }: React.ComponentProps<'a'>) => React.createElement('a', { href }, children) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', loading: false }) }))
vi.mock('@/lib/use-feature-access', () => ({ useFeatureAccess: () => true }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/components/scenarios/scenario-reference-data', () => ({ scenarioReferenceData: {
  scenario: () => Promise.resolve({ success: true, data: resultFixture.scenario }),
  stats: () => Promise.resolve({ success: true, data: resultFixture.stats }),
} }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, scenarios: { ...actual.api.scenarios, runs: resultFixture.runs } } }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
async function renderResults() {
  resultFixture.runs.mockResolvedValue({ success: true, data: {
    summary: { active: 2, paused: 1, completed: 5, delivering: 1 },
    subscriptions: [], pagination: { total: 0, limit: 50, cursor: '', nextCursor: null },
    steps: [{ stepOrder: 1, failed: { state: 'available', value: 2 } }],
  } })
  const result = render(React.createElement(ScenarioResultsV8))
  await waitFor(() => expect(screen.getByRole('heading', { name: '配信結果：新規登録フォロー' })).toBeTruthy())
  await waitFor(() => expect(screen.getByText('始まった')).toBeTruthy())
  return result
}

describe('★V8 シナリオ配信結果（X4STXS）の契約', () => {

  it('配信結果の数の帯は人数と購読の件数を分けて描く', async () => {
    const { container } = await renderResults()
    const band = container.querySelector('[data-design="KPIs"]')!
    const expected = [['始まった', '10', '人'], ['読み終えた', '5', '件'], ['途中', '4', '件'], ['離れた', '—', '人']]
    for (const [label, value, unit] of expected) {
      const cell = within(band as HTMLElement).getByText(label).closest('[data-kpi-presentation]')!
      expect(cell.querySelector('[data-kpi-number]')?.textContent).toBe(value)
      expect(cell.textContent).toContain(value + unit)
    }
  })

  it('失敗した記録から停止中の購読へ絞り込み、送信中は別に知らせる', async () => {
    await renderResults()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('いま送っています（送信中の購読 1 件）'))
    fireEvent.click(screen.getByRole('button', { name: '送れなかった記録 2 件・止まっている購読だけを見る' }))
    await waitFor(() => expect(resultFixture.runs).toHaveBeenLastCalledWith('sc-1', 'account-a', expect.objectContaining({ status: 'paused' })))
  })

  it('購読操作（止める・再開・失敗を再送・移す）は既存の口を使う', () => {
    expect(V8_RESULTS).toContain('api.scenarios.subscriptionOps[op]')
    expect(V8_RESULTS).toContain('api.scenarios.subscriptionOps.move')
    // 確認キー（Idempotency-Key）は購読ごとの署名で持つ。
    expect(V8_RESULTS).toContain('IdempotencyKeyStore')
    // pauseReason で「再開」と「失敗を再送」を出し分ける。
    expect(V8_RESULTS).toContain("sub.pauseReason === 'delivery_failed'")
  })

  it('取得失敗・未取得・0件を分けて出す（SCENARIO-10）', () => {
    expect(V8_RESULTS).toContain("runsState === 'idle'")
    expect(V8_RESULTS).toContain("runsState === 'loading'")
    expect(V8_RESULTS).toContain("runsState === 'error'")
  })
})

describe('★V8 シナリオの CSS モジュールの契約', () => {

  it("既存の見た目 に効かせる指定を持たない（data-theme セレクタの直書きは無い）", () => {
    /*
     * V8 の画面は component 側の分岐でだけ出るので、CSS 側で
     * [data-theme] を条件にする必要は無い。付いていたら 管理画面 の
     * 見た目へ漏れ出す危険があるので契約で止める。
     */
    expect(V8_DETAIL_CSS.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('[data-theme')
    expect(V8_RESULTS_CSS).not.toContain('[data-theme')
  })
  it('通ごとの結果と友だちごとの記録を持つ', () => {
    expect(RESULTS_CURRENT).toContain('通ごとの反応')
    expect(RESULTS_CURRENT).toContain('参加中の友だち')
    expect(RESULTS_CURRENT).toContain('予定を見る')
    expect(RESULTS_CURRENT).toContain('さらに読み込む')
  })

})
