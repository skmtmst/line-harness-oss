// @vitest-environment happy-dom
/*
 * R399/R400/R401: 人が見つからなかった届物（未照合の箱）の直し。
 * 本物のReactで描いて確かめる（失敗表示・保留の表示・50件超え）。
 *
 * R399: 「結び付ける」「確認した」が 403/409/500/通信断で落ちても、
 *       未処理のPromise拒否を残さず、行に理由と次の行動を出す。
 * R400: onNotFound=do_nothing でも保留があれば欄を出し、取得失敗を見せる。
 * R401: 50件超えは「さらに表示」で全件へ辿り着き、残件と空表示を矛盾させない。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IncomingOverview } from './webhook-overviews'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

type StubOptions = {
  onNotFound?: 'do_nothing' | 'unmatched_box' | 'create_candidate'
  pending?: number
  unmatchedStatus?: number
  unmatchedItems?: Array<Record<string, unknown>>
  unmatchedTotal?: number
  resolveStatus?: number
}

let stub: StubOptions
let resolveCalls: string[]

function item(id: string, receivedAt: string) {
  return {
    id,
    kind: 'unmatched',
    status: 'pending',
    identityAttempts: [{ kind: 'harness_friend_id', path: '$.friendId', value: 'missing' }],
    maskedShape: null,
    candidates: [],
    resolvedFriendId: null,
    resolvedAt: null,
    receivedAt,
  }
}

function detailBody() {
  return {
    success: true,
    data: {
      id: 'iwh-1',
      name: '受け取り口 1',
      sourceType: 'form',
      hasSecret: true,
      isActive: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      version: 2,
      identityMatching: {
        methods: [{ kind: 'harness_friend_id', path: '$.friendId' }],
        onNotFound: stub.onNotFound ?? 'unmatched_box',
      },
      actions: [],
      actionExecution: { state: 'not_configured', reason: null },
      latestSample: null,
      templateFields: [],
      pendingUnmatched: stub.pending ?? 1,
      previousSecretUsableUntil: null,
    },
  }
}

function installFetch() {
  resolveCalls = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    const raw = typeof input === 'string' ? input : String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && raw.includes('/api/webhooks/unmatched/')) {
      resolveCalls.push(raw)
      const status = stub.resolveStatus ?? 200
      const body = status === 200
        ? { success: true, data: { id: 'u-1', status: 'dismissed' } }
        : { success: false, error: status === 403 ? 'Forbidden' : 'Internal server error' }
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    }
    if (raw.includes('/unmatched')) {
      const status = stub.unmatchedStatus ?? 200
      if (status !== 200) {
        return new Response(JSON.stringify({ success: false, error: 'temporary failure' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const items = stub.unmatchedItems ?? [item('u-1', '2026-09-28T10:00:00.000Z')]
      const body: Record<string, unknown> = { success: true, data: items }
      if (stub.unmatchedTotal !== undefined) body.total = stub.unmatchedTotal
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (raw.includes('/api/webhooks/incoming/iwh-1?')) {
      return new Response(JSON.stringify(detailBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))
}

function renderOverview(canResolveUnmatched = true) {
  root.render(
    <IncomingOverview
      items={[{
        id: 'iwh-1',
        name: '受け取り口 1',
        sourceType: 'form',
        hasSecret: true,
        isActive: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }]}
      status="ready"
      showCreate={false}
      lineAccountId="acc-1"
      endpointUrl={(id) => `https://api.test/api/webhooks/incoming/${id}/receive`}
      onReload={() => {}}
      onToggle={() => {}}
      togglingIds={[]}
      onRotate={() => {}}
      onDelete={() => {}}
      canManage
      canResolveUnmatched={canResolveUnmatched}
    />,
  )
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

function clickButton(text: string) {
  const button = [...host.querySelectorAll('button')].find((el) => el.textContent === text)
  expect(button, `ボタン「${text}」`).toBeDefined()
  act(() => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('R399 未照合の操作失敗を行に表示する', () => {
  beforeEach(() => {
    stub = {}
    installFetch()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('「確認した」が500で落ちたら行に理由と再試行の案内を出し、ボタンは戻す', async () => {
    stub = { pending: 1, resolveStatus: 500 }
    await act(async () => {
      renderOverview()
    })
    await settle()
    expect(host.textContent).toContain('人が見つからなかった届物')
    clickButton('確認した')
    await settle()
    expect(resolveCalls).toHaveLength(1)
    // 行は残り、ボタンだけ再び有効になるだけでは足りない。理由を出す。
    expect(host.textContent).toContain('人が見つからなかった届物')
    expect(host.textContent).toMatch(/保存できませんでした|もう一度|読み直し/)
    const button = [...host.querySelectorAll('button')].find((el) => el.textContent === '確認した')
    expect(button?.hasAttribute('disabled')).toBe(false)
  })

  it('「結び付ける」が403で落ちたら権限の引き継ぎ案内を出す', async () => {
    stub = {
      pending: 1,
      resolveStatus: 403,
      unmatchedItems: [{
        ...item('u-2', '2026-09-28T10:00:00.000Z'),
        kind: 'ambiguous',
        candidates: [{ friendId: 'f-1', displayName: '候補者' }],
      }],
    }
    await act(async () => {
      renderOverview()
    })
    await settle()
    clickButton('この人に結び付ける')
    await settle()
    expect(resolveCalls).toHaveLength(1)
    expect(host.textContent).toMatch(/統括|管理者/)
  })

  it('処理済み409なら最新を読み直す案内を出す', async () => {
    stub = { pending: 1, resolveStatus: 409 }
    await act(async () => {
      renderOverview()
    })
    await settle()
    clickButton('確認した')
    await settle()
    expect(host.textContent).toMatch(/処理済み|読み直/)
  })

  it('結び付け・確認の権限がなければボタンを出さず依頼案内にする', async () => {
    stub = { pending: 1 }
    await act(async () => {
      renderOverview(false)
    })
    await settle()
    expect(host.textContent).toContain('人が見つからなかった届物')
    expect(host.textContent).not.toContain('確認した')
    expect(host.textContent).toMatch(/統括|管理者/)
  })
})

describe('R400 何もしない設定でも保留と取得失敗を見せる', () => {
  beforeEach(() => {
    stub = {}
    installFetch()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('do_nothingでも未確認があれば欄を出し、取得失敗は理由と読み直しを出す', async () => {
    stub = { onNotFound: 'do_nothing', pending: 1, unmatchedStatus: 503 }
    await act(async () => {
      renderOverview()
    })
    await settle()
    // 保留欄ごと消えると、読込障害自体に気付けない。
    expect(host.textContent).toContain('人が見つからなかった届物')
    expect(host.textContent).toContain('未確認 1件')
    expect(host.textContent).toMatch(/表示できませんでした/)
    expect([...host.querySelectorAll('button')].some((el) => el.textContent === '届物だけ読み直す')).toBe(true)
  })
})

describe('R401 50件超えは次の一覧へ辿り着く', () => {
  beforeEach(() => {
    stub = {}
    installFetch()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('51件中50件の表示では残りを示し、処理後は次が出て空表示と矛盾しない', async () => {
    const fifty = Array.from({ length: 50 }, (_, index) => item(`u-${index}`, '2026-09-28T10:00:00.000Z'))
    stub = { pending: 51, unmatchedItems: fifty, unmatchedTotal: 51 }
    await act(async () => {
      renderOverview()
    })
    await settle()
    expect(host.textContent).toContain('未確認 51件')
    // 次の届物へ辿り着く導線が要る。
    expect(host.textContent).toMatch(/ほか1件|さらに表示/)
    expect(host.textContent).not.toContain('いま確認が必要な届物はありません')
  })

  it('残り0件のときだけ空表示を出す', async () => {
    stub = { pending: 0, unmatchedItems: [], unmatchedTotal: 0 }
    await act(async () => {
      renderOverview()
    })
    await settle()
    expect(host.textContent).toContain('いま確認が必要な届物はありません')
  })
})
