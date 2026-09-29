// @vitest-environment happy-dom
/*
 * R434: 外部連携「API接続」パネルの契約。本物のReactで見え方と操作を確かめる。
 *
 * - 正常：一覧に名前・できること・最終利用・作成日が出る。平文は出ない
 * - 空：まだ無い旨と「接続を作る」
 * - 失敗：読み込めなかった旨と再試行
 * - 停止中（外部連携オフ）：止まっている旨。鍵の操作は出さない
 * - 発行：一度だけ平文が出て、写せる。一覧には平文が出ない
 * - 入れ替え・停止：確認を挟み、口を叩く
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

import ApiTokensPanel from './api-tokens-panel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const calls: Array<{ path: string; method: string; body?: unknown }> = []
let handler: (path: string, method: string, body?: unknown) => Promise<{ status: number; body: unknown }>

function token(id: string, name: string, scopes: string[]) {
  return {
    id,
    name,
    tokenPrefix: 'lhp_test',
    scopes,
    createdBy: 'owner-1',
    lastUsedAt: '2026-09-27T10:00:00.000+09:00',
    rotatedFromId: null,
    createdAt: '2026-09-26T10:00:00.000+09:00',
  }
}

function text(): string {
  return host.textContent ?? ''
}
/** ConfirmDialog は body 直下の portal に描くので、ページ本文とは別に見る。 */
function dialogButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button'))
    .filter((el) => !host.contains(el))
    .find((el) => el.textContent?.includes(label))
}
function button(label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((el) => el.textContent?.includes(label))
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}
async function render() {
  await act(async () => {
    root.render(<ApiTokensPanel />)
  })
  await settle()
}

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : (input as Request).url
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost')
    const path = url.pathname + url.search
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, method, body })
    const response = await handler(path, method, body)
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('R434 API接続パネル', () => {
  it('正常：一覧に名前とできることだけが出て、平文は出ない', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/webhooks/api-tokens')) {
        return { status: 200, body: { success: true, data: [token('t1', '予約連携', ['tags:read', 'tags:write'])] } }
      }
      return { status: 500, body: { success: false, error: 'unhandled' } }
    }
    await render()
    expect(text()).toContain('予約連携')
    expect(text()).toContain('タグを見る・タグを付ける')
    expect(text()).not.toContain('lhp_')
  })

  it('空：まだ無い旨と「接続を作る」', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/webhooks/api-tokens')) {
        return { status: 200, body: { success: true, data: [] } }
      }
      return { status: 500, body: { success: false, error: 'unhandled' } }
    }
    await render()
    expect(text()).toContain('まだ接続がありません')
    expect(button('接続を作る')).toBeTruthy()
  })

  it('失敗：読み込めなかった旨と再試行', async () => {
    let first = true
    handler = async (path) => {
      if (path.startsWith('/api/webhooks/api-tokens')) {
        if (first) {
          first = false
          throw new Error('network down')
        }
        return { status: 200, body: { success: true, data: [] } }
      }
      return { status: 500, body: { success: false, error: 'unhandled' } }
    }
    await render()
    const retry = button('もう一度')
    expect(retry).toBeTruthy()
    await act(async () => { retry!.click() })
    await settle()
    expect(text()).toContain('まだ接続がありません')
  })

  it('停止中：外部連携オフの旨。鍵の操作は出さない', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/webhooks/api-tokens')) {
        return {
          status: 403,
          body: { success: false, error: 'この機能は設定でオフになっています', code: 'FEATURE_DISABLED', featureId: 'external_integrations' },
        }
      }
      return { status: 500, body: { success: false, error: 'unhandled' } }
    }
    await render()
    expect(text()).toContain('外部連携が止まっています')
    expect(button('接続を作る')).toBeFalsy()
  })

  it('発行：一度だけ平文が出る。閉じたら一覧に戻る', async () => {
    handler = async (path, method, body) => {
      if (path.startsWith('/api/webhooks/api-tokens') && method === 'GET') {
        return { status: 200, body: { success: true, data: [] } }
      }
      if (path === '/api/webhooks/api-tokens' && method === 'POST') {
        const payload = body as { name: string; scopes: string[] }
        return {
          status: 201,
          body: { success: true, data: { ...token('t9', payload.name, payload.scopes), token: 'lhp_issued_once' } },
        }
      }
      return { status: 500, body: { success: false, error: 'unhandled' } }
    }
    await render()
    await act(async () => { button('接続を作る')!.click() })
    await settle()
    const nameInput = host.querySelector('#api-token-name') as HTMLInputElement
    expect(nameInput).toBeTruthy()
    await act(async () => {
      nameInput.focus()
      // React の非制御に寄せない：値を直接入れて input 扱いにする。
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(nameInput, '予約連携')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()
    await act(async () => { button('発行する')!.click() })
    await settle()
    // 平文はこの1回だけ。
    expect(text()).toContain('lhp_issued_once')
    expect(text()).toContain('今だけ表示')
    const createCall = calls.find((c) => c.path === '/api/webhooks/api-tokens' && c.method === 'POST')
    expect(createCall?.body).toMatchObject({ name: '予約連携' })
    await act(async () => { button('閉じる')!.click() })
    await settle()
    expect(text()).not.toContain('lhp_issued_once')
  })

  it('入れ替えと停止：確認を挟んで口を叩く', async () => {
    handler = async (path, method) => {
      if (path.startsWith('/api/webhooks/api-tokens') && method === 'GET') {
        return { status: 200, body: { success: true, data: [token('t1', '予約連携', ['tags:read'])] } }
      }
      if (path.includes('/rotate') && method === 'POST') {
        return {
          status: 200,
          body: { success: true, data: { ...token('t2', '予約連携', ['tags:read']), token: 'lhp_rotated_once' } },
        }
      }
      if (path.includes('/revoke') && method === 'POST') {
        return { status: 200, body: { success: true, data: { id: 't1' } } }
      }
      return { status: 500, body: { success: false, error: 'unhandled' } }
    }
    await render()
    await act(async () => { button('入れ替え')!.click() })
    await settle()
    await act(async () => { dialogButton('入れ替える')!.click() })
    await settle()
    expect(calls.some((c) => c.path.includes('/rotate') && c.method === 'POST')).toBe(true)
    expect(text()).toContain('lhp_rotated_once')
    await act(async () => { button('閉じる')!.click() })
    await settle()
    await act(async () => { button('止める')!.click() })
    await settle()
    await act(async () => { dialogButton('止める')!.click() })
    await settle()
    expect(calls.some((c) => c.path.includes('/revoke') && c.method === 'POST')).toBe(true)
  })
})
