// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountMigration from './migration'

/**
 * Issue #1012 FRIEND-14/15/16/33/36 の回帰試験。
 *
 * 本物のReactで本物の `AccountMigration` を mount し、`api.ts` も実物を通す。
 * 差し替えるのは通信(fetch)とルーティングだけ。
 *
 * - FRIEND-14: 「詳細を見る」は更新APIを呼ばない。承認だけが1回書き込む。
 * - FRIEND-16: 履歴切替で古い応答が後から届いても対応表が戻らない。
 * - FRIEND-33: 「本移行を実行」は確認画面を開くだけで、確定まで書き込まない。
 * - FRIEND-36: 完了・一部失敗の履歴から確認付きの切り戻しへ進める。
 */

vi.hoisted(() => {
  // api.ts はモジュール評価時に必須。実値は使わず fetch ごと差し替える。
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams('tab=migration'),
}))

const net = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; method: string }>,
  /** 履歴一覧に出す run。 */
  runs: [] as Array<Record<string, unknown>>,
  /** run id ごとの対応表応答を差し替える。 */
  detailResponders: new Map<string, () => Promise<Response>>(),
  /** 自分自身（実行権限の案内に使う）。 */
  me: { id: 'owner-2', role: 'owner' } as { id: string; role: string } | null,
}))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.push, replace: fixture.replace }),
  useSearchParams: () => fixture.params,
  usePathname: () => '/accounts',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))

const ACCOUNTS = [
  { id: 'acc-a', name: '移行元アカウント' },
  { id: 'acc-b', name: '移行先アカウント' },
]

const ITEM = {
  id: 'item-1', oldUid: 'UOLD-1', newUid: 'UNEW-1', candidateName: '候補 太郎',
  evidenceType: 'operator_csv' as const, classification: 'review' as const,
  conflictReason: null, decision: 'pending' as const, result: 'pending' as const,
  errorMessage: null,
}

function runFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1', fromAccountId: 'acc-a', toAccountId: 'acc-b', purpose: '移行A',
    sourceKind: 'csv', sourceFilename: 'map.csv', status: 'ready', dryRunRevision: 1,
    counts: { total: 1, auto: 0, review: 1, unmatched: 0, conflict: 0, applied: 0, failed: 0 },
    createdBy: 'owner-1', approvedBy: null, createdAt: '2026-09-20T00:00:00Z',
    reviewedAt: '2026-09-20T01:00:00Z', executedAt: null, completedAt: null,
    rolledBackAt: null, failureReason: null, rollbackable: false,
    ...overrides,
  }
}

function detailFixture(run: Record<string, unknown>) {
  return {
    ...run,
    items: [ITEM], itemTotal: 1, itemLimit: 20, itemOffset: 0,
    unresolved: 0,
    decisionCounts: { pending: 0, link: 1, create: 0, exclude: 0 },
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, data }), { status, headers: { 'Content-Type': 'application/json' } })

/** 通信そのものを差し替える。api・fetchApiは実物を通す。 */
function installFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : String(input)
    const url = new URL(raw.startsWith('http') ? raw : `https://test.local${raw}`)
    const path = url.pathname
    const method = init?.method ?? 'GET'
    net.calls.push({ path: path + url.search, method })
    if (path === '/api/line-accounts') return json(ACCOUNTS)
    if (path === '/api/staff/me') {
      return net.me ? json(net.me) : new Response(JSON.stringify({ success: false, error: 'x' }), { status: 500 })
    }
    if (path === '/api/friends/migrations' && method === 'GET') return json(net.runs)
    const itemMatch = path.match(/^\/api\/friends\/migrations\/[^/]+\/items\/[^/]+$/)
    if (itemMatch && method === 'PATCH') return json({ unresolved: 0 })
    if (path.endsWith('/execute') && method === 'POST') {
      return json(runFixture({ status: 'completed', counts: { total: 1, auto: 0, review: 1, unmatched: 0, conflict: 0, applied: 1, failed: 0 } }))
    }
    if (path.endsWith('/rollback') && method === 'POST') {
      return json({ ...runFixture({ status: 'rolled_back' }), rolledBack: 1 })
    }
    const detailMatch = path.match(/^\/api\/friends\/migrations\/([^/]+)$/)
    if (detailMatch && method === 'GET') {
      const responder = net.detailResponders.get(detailMatch[1])
      if (responder) return responder()
      const run = net.runs.find((entry) => entry.id === detailMatch[1]) ?? runFixture({ id: detailMatch[1] })
      return json(detailFixture(run))
    }
    return json(null)
  })
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  fixture.replace.mockClear()
  net.calls.length = 0
  net.runs = [runFixture()]
  net.detailResponders = new Map()
  net.me = { id: 'owner-2', role: 'owner' }
  installFetch()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => { root.render(<AccountMigration />) })
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  })
}

function buttonByText(text: string, scope: ParentNode = document.body): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)
  if (!found) throw new Error(`button "${text}" not found`)
  return found
}

/** 履歴行のように、目的の文字列を中に含むボタンを拾う。 */
function buttonContaining(text: string, scope: ParentNode = document.body): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find((button) => button.textContent?.includes(text))
  if (!found) throw new Error(`button containing "${text}" not found`)
  return found
}

function openDialog(): HTMLElement {
  const dialog = document.body.querySelector('[role="dialog"], [role="alertdialog"]')
  if (!dialog) throw new Error('dialog not open')
  return dialog as HTMLElement
}

const writes = () => net.calls.filter((call) => call.method !== 'GET')

describe('UID移行の詳細確認（FRIEND-14）', () => {
  it('「詳細を見る」は読み取り専用で、更新APIを呼ばない', async () => {
    await render()
    await flush()
    fireEvent.click(buttonByText('詳細を見る'))
    await flush()
    const dialog = openDialog()
    expect(dialog.textContent).toContain('UOLD-1')
    expect(dialog.textContent).toContain('候補 太郎')
    expect(writes()).toHaveLength(0)
  })

  it('承認だけが対象itemへ1回書き込む', async () => {
    await render()
    await flush()
    fireEvent.click(buttonByText('詳細を見る'))
    await flush()
    fireEvent.click(buttonByText('この組合せを承認', openDialog()))
    await flush()
    const patches = net.calls.filter((call) => call.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(patches[0].path).toBe('/api/friends/migrations/run-1/items/item-1')
  })

  it('閉じるだけなら書き込まない', async () => {
    await render()
    await flush()
    fireEvent.click(buttonByText('詳細を見る'))
    await flush()
    fireEvent.click(buttonByText('閉じる', openDialog()))
    await flush()
    expect(writes()).toHaveLength(0)
  })
})

describe('UID移行の本実行（FRIEND-33）', () => {
  it('「本移行を実行」は確認画面を開くだけで実行しない', async () => {
    await render()
    await flush()
    fireEvent.click(buttonByText('本移行を実行'))
    await flush()
    const dialog = openDialog()
    expect(dialog.textContent).toContain('移行元アカウント')
    expect(dialog.textContent).toContain('結び付け 1 件')
    expect(net.calls.some((call) => call.path.endsWith('/execute'))).toBe(false)
  })

  it('確認画面の確定だけが execute を1回呼ぶ', async () => {
    await render()
    await flush()
    fireEvent.click(buttonByText('本移行を実行'))
    await flush()
    fireEvent.click(buttonByText('本移行を実行', openDialog()))
    await flush()
    const executes = net.calls.filter((call) => call.path.endsWith('/execute') && call.method === 'POST')
    expect(executes).toHaveLength(1)
  })

  it('確認画面のキャンセルは書き込まない', async () => {
    await render()
    await flush()
    fireEvent.click(buttonByText('本移行を実行'))
    await flush()
    fireEvent.click(buttonByText('キャンセル', openDialog()))
    await flush()
    expect(net.calls.some((call) => call.path.endsWith('/execute'))).toBe(false)
  })

  it('作成者本人には確定ボタンを出さず理由を示す', async () => {
    net.me = { id: 'owner-1', role: 'owner' }
    await render()
    await flush()
    fireEvent.click(buttonByText('本移行を実行'))
    await flush()
    const dialog = openDialog()
    expect(dialog.textContent).toContain('別のownerが実行してください')
    const confirms = Array.from(dialog.querySelectorAll('button')).filter((button) => button.textContent?.trim() === '本移行を実行')
    expect(confirms).toHaveLength(0)
    expect(net.calls.some((call) => call.path.endsWith('/execute'))).toBe(false)
  })
})

describe('UID移行の切り戻し（FRIEND-36/15）', () => {
  it('完了履歴は「実データはまだ変更していません」と言わず切り戻しへ進める', async () => {
    net.runs = [runFixture({
      status: 'completed', rollbackable: true,
      counts: { total: 1, auto: 0, review: 1, unmatched: 0, conflict: 0, applied: 1, failed: 0 },
    })]
    await render()
    await flush()
    expect(document.body.textContent).not.toContain('実データはまだ変更していません')
    expect(document.body.textContent).toContain('本移行と照合が完了しています')
    fireEvent.click(buttonByText('この移行を切り戻す'))
    await flush()
    const dialog = openDialog()
    expect(dialog.textContent).toContain('1 件')
    expect(net.calls.some((call) => call.path.endsWith('/rollback'))).toBe(false)
    fireEvent.click(buttonByText('切り戻す', dialog))
    await flush()
    expect(net.calls.filter((call) => call.path.endsWith('/rollback') && call.method === 'POST')).toHaveLength(1)
  })

  it('一部失敗の履歴は成功分・失敗分を分け、切り戻せることを示す', async () => {
    net.runs = [runFixture({
      status: 'failed', rollbackable: true, failureReason: '一部失敗',
      counts: { total: 2, auto: 0, review: 0, unmatched: 0, conflict: 0, applied: 1, failed: 1 },
    })]
    await render()
    await flush()
    expect(document.body.textContent).toContain('一部だけ反映されました')
    expect(document.body.textContent).toContain('一部失敗')
    expect(document.body.textContent).not.toContain('本移行と照合が完了しています')
    buttonByText('この移行を切り戻す')
  })
})

describe('対応表の遅延応答（FRIEND-16）', () => {
  it('履歴を連続で切り替えても、最後に選んだ対応表だけが残る', async () => {
    const runB = runFixture({ id: 'run-b', purpose: '移行B', counts: { total: 22, auto: 0, review: 0, unmatched: 0, conflict: 0, applied: 0, failed: 0 } })
    const runC = runFixture({ id: 'run-c', purpose: '移行C', counts: { total: 33, auto: 0, review: 0, unmatched: 0, conflict: 0, applied: 0, failed: 0 } })
    net.runs = [runFixture(), runB, runC]
    // run-b の応答だけを後回しにする。B/Cの対応表はUIDで見分ける。
    let releaseB: (() => void) | null = null
    net.detailResponders.set('run-b', () => new Promise<Response>((resolve) => {
      releaseB = () => resolve(json({ ...detailFixture(runB), items: [{ ...ITEM, id: 'item-b', oldUid: 'U-B-999' }] }))
    }))
    net.detailResponders.set('run-c', async () => json({ ...detailFixture(runC), items: [{ ...ITEM, id: 'item-c', oldUid: 'U-C-888' }] }))
    await render()
    await flush()
    // 履歴B → 履歴C と連続で切り替える。
    fireEvent.click(buttonContaining('移行B'))
    await flush()
    fireEvent.click(buttonContaining('移行C'))
    await flush()
    expect(document.body.textContent).toContain('U-C-888')
    // 遅れていたBの応答が届いても、表示はCのまま。
    releaseB?.()
    await flush()
    expect(document.body.textContent).toContain('U-C-888')
    expect(document.body.textContent).not.toContain('U-B-999')
  })
})
