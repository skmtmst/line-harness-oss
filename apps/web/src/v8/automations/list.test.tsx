// @vitest-environment happy-dom
/*
 * V8 オートメーション（src/v8/automations）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * V8 のテーマで表示し、ルール一覧・閲覧のみ・動いた記録・共通アクションを確かめる。
 * 閲覧のみでは、作る・編集・フォルダを追加などの押せないボタンを置かない（隠す）。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/automations',
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [{ id: 'account-a', name: '本店' }], loading: false }),
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

// 1440 の板で見る（1152 の板 En14p は狭い幅のとき）。
vi.mock('@/lib/use-narrow-viewport', () => ({ useNarrowViewport: () => false }))

const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
vi.mock('@/lib/staff-role', async (importOriginal: () => Promise<typeof import('@/lib/staff-role')>) => {
  const actual = await importOriginal()
  return { ...actual, useStaffRole: () => role.value }
})

import AutomationListV8 from './list'
import AutomationRunsV8 from './runs'
import CommonActionsV8 from './common-actions'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const automation = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, description: null, eventType: 'message_received', triggerConfig: {}, conditions: {},
  actions: [{ type: 'notify_staff', params: {} }, { type: 'add_tag', params: {} }],
  isActive: true, priority: 1, lineAccountId: 'account-a', status: 'active', versionId: `${id}-v`, version: 1,
  executionCount30d: 312, failureCount30d: 0, lastRunAt: null,
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', ...extra,
})

const automations = [
  automation('au-1', '問い合わせを担当へ知らせる'),
  automation('au-6', '旧キャンペーンの自動返信', {
    isActive: false, status: 'stopped', triggerConfig: { keyword: 'キャンペーン' }, executionCount30d: 0, updatedAt: '2026-09-01T00:00:00.000Z',
  }),
]

const commonActions = [
  { id: 'ca-2', name: '購入のお礼', description: '買ってくれた人へのお礼', status: 'published', draftVersion: null, publishedVersion: 3, actionCount: 3, bindingCount: 3, oldVersionBindingCount: 0, executionCountThisMonth: 52, failureCountThisMonth: 0, lastRunAt: null, updatedAt: '2026-09-30T00:00:00.000Z' },
]

const run = {
  id: 'run-2', automationId: 'au-1', occurredAt: '2026-09-30T02:05:00.000Z', subject: 'Masato S.', accountLabel: '然 本店',
  triggerLabel: 'メッセージが届いたとき', status: 'permanent_failed', detail: 'ブロック中で送れず', durationMs: 300,
  automationName: '購入のお礼とフォロー', canRetry: false, versionNumber: 2, isTest: false, canCancel: false, friendId: 'friend-1',
  successfulActions: ['購入のお礼'], failureReason: 'ブロック中で送れず',
}

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  role.value = 'owner'
  push.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/automations') {
      return json({ success: true, data: automations, summary: { active: 1, stopped: 1, executionCount30d: 312, failureCount30d: 0 } })
    }
    if (url.pathname === '/api/automation-runs') {
      return json({ success: true, data: { summary: { total: 9666, executed: 2988, skipped: 1240, failed: 6, mostRunName: null, mostRunCount: null }, items: [run], pagination: { total: 1, limit: 20, offset: 0 } } })
    }
    if (url.pathname === '/api/automation-templates') return json({ success: true, data: [{ key: 'a' }, { key: 'b' }] })
    if (url.pathname === '/api/common-actions') {
      return json({ success: true, data: commonActions, pagination: { total: 1, limit: 20, offset: 0 }, summary: { total: 1, published: 1, draft: 0, oldVersion: 0, unused: 0, archived: 0, actions: 3, bindings: 3, outdated: 0, outdatedItems: 0, executions: 52, failures: 0 } })
    }
    if (url.pathname === '/api/folders') return json({ success: true, data: [] })
    return json({ success: true, data: null })
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

async function render(node: React.ReactElement) {
  await act(async () => { root.render(node) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

/** 読み込みが終わるまで待つ（動いた記録は 400ms 待ってから読む）。 */
async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 60; i += 1) {
    if (check()) return
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })
  }
  throw new Error(`待ちきれませんでした：${label}`)
}

const buttons = () => [...host.querySelectorAll('button, a')] as HTMLElement[]
const named = (text: string) => buttons().filter((element) => (element.textContent ?? '').trim() === text)

describe('V8 オートメーションのルール一覧（LWQXd）', () => {
  it('V8 のテーマで、タブ・数の帯・行・行の右端の「編集する」と「…」を出す', async () => {
    await render(<AutomationListV8 />)
    await waitFor(() => host.textContent?.includes('問い合わせを担当へ知らせる') ?? false, 'ルールの行')
    expect(document.documentElement.dataset.theme).toBe('v8')
    expect(host.querySelector('[data-design-node="LWQXd"]')).not.toBeNull()
    expect(host.textContent).toContain('ルール 2')
    expect(host.textContent).toContain('動いている 1・止めている 1')
    // きっかけは言葉まで（「〇〇」と送られた）。止めているルールは最後に変えた日。
    expect(host.textContent).toContain('「キャンペーン」と送られた')
    expect(host.textContent).toContain('止めています')
    expect(named('編集する')).toHaveLength(2)
    expect(host.querySelector('[aria-label="ルール「問い合わせを担当へ知らせる」の操作"]')).not.toBeNull()
    expect(named('ルールを作る').length).toBeGreaterThan(0)
  })

  it('閲覧のみでは、帯を出し、作る・編集・フォルダを追加・見本から作るを置かない（押せないボタンも無い）', async () => {
    role.value = 'staff'
    await render(<AutomationListV8 />)
    await waitFor(() => host.textContent?.includes('問い合わせを担当へ知らせる') ?? false, 'ルールの行')
    expect(host.querySelector('[data-design-node="nH9L8"]')).not.toBeNull()
    expect(host.textContent).toContain('閲覧のみで見ています。変える操作は管理者に頼んでください。')
    expect(named('編集する')).toHaveLength(0)
    expect(named('ルールを作る')).toHaveLength(0)
    expect(named('フォルダを追加')).toHaveLength(0)
    expect(named('見本から作る')).toHaveLength(0)
    const disabled = buttons().filter((element) => element.matches(':disabled, [aria-disabled="true"]'))
    expect(disabled.map((element) => element.textContent)).toEqual([])
    // 「…」は動いた記録を見るだけ。
    const menu = host.querySelector('[aria-label="ルール「問い合わせを担当へ知らせる」の操作"]') as HTMLButtonElement
    await act(async () => { menu.click() })
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((element) => element.textContent?.trim())
    expect(items).toEqual(['動いた記録を見る'])
  })
})

describe('V8 オートメーションの動いた記録（g98F9）', () => {
  it('結果の札と理由・したことの数・かかった時間を出す', async () => {
    await render(<AutomationRunsV8 />)
    await waitFor(() => host.textContent?.includes('Masato S.') ?? false, '記録の行')
    expect(host.querySelector('[data-design-node="g98F9"]')).not.toBeNull()
    expect(host.textContent).toContain('失敗ブロック中で送れず')
    expect(host.textContent).toContain('1 つ')
    expect(host.textContent).toContain('0.3 秒')
    expect(host.textContent).toContain('動いた 2,988')
    expect(host.textContent).toContain('1件中 1〜1件')
  })
})

describe('V8 オートメーションの共通アクション（LnGNw）', () => {
  it('行の「中身を見る」は版と使われている場所へ。閲覧のみでは作るボタンを置かない', async () => {
    await render(<CommonActionsV8 />)
    await waitFor(() => host.textContent?.includes('購入のお礼') ?? false, '共通アクションの行')
    const open = named('中身を見る')[0] as HTMLAnchorElement
    expect(open.getAttribute('href')).toBe('/common-actions/versions?id=ca-2')
    expect(named('共通アクションを作る').length).toBeGreaterThan(0)

    act(() => root.unmount())
    root = createRoot(host)
    role.value = 'staff'
    await render(<CommonActionsV8 />)
    await waitFor(() => host.textContent?.includes('購入のお礼') ?? false, '共通アクションの行（閲覧のみ）')
    expect(named('共通アクションを作る')).toHaveLength(0)
    expect(named('フォルダを追加')).toHaveLength(0)
    expect(host.textContent).toContain('閲覧のみで見ています')
  })
})
