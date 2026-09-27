// @vitest-environment happy-dom
/*
 * #838 第2段: Google Sheets 連携パネルの契約。
 * 本物のReactで、接続状態ごとの見え方と操作を確かめる。
 *
 * - 未接続: 接続ボタンを出し、押すとOAuth開始口を呼ぶ
 * - 出力先未設定（pending_target）: URL/IDの入力を開いた状態で見せる
 * - 接続中: シート名・前回同期・「今すぐ同期」を出す
 * - 認可切れ（expired）: 同期を止めて「再接続する」を出す
 * - 権限なし（canManage=false）: 変更ボタンを出さず案内だけ
 * - OAuthの戻り（?sheets=…）: 結果を人の言葉で帯に出す
 * - 解除は ConfirmDialog を通す（口側は confirmed 必須）
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const searchParams = { value: '' }
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(searchParams.value),
}))

import GoogleSheetsPanel from './google-sheets-panel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const calls: Array<{ path: string; method: string; body?: unknown }> = []
let handler: (path: string, method: string) => Promise<unknown> | unknown

function connectionBody(status: string, extra: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      connection: {
        status,
        googleAccountEmail: 'owner@example.com',
        spreadsheetId: status === 'pending_target' ? null : 'sheet-123',
        spreadsheetTitle: status === 'pending_target' ? null : 'LINE連携シート',
        spreadsheetUrl: status === 'pending_target' ? null : 'https://docs.google.com/spreadsheets/d/sheet-123',
        lastSyncedAt: status === 'connected' ? '2026-09-26T03:00:00.000Z' : null,
        lastSyncStatus: status === 'connected' ? 'ok' : null,
        lastSyncError: null,
        consecutiveFailures: 0,
        connectedAt: '2026-09-20T00:00:00.000Z',
      },
      oauthConfigured: true,
      syncRunning: false,
      canManage: true,
      ...extra,
    },
  }
}

function text(): string {
  return host.textContent ?? ''
}
/** ConfirmDialog は body 直下の portal に描くので、ページ本文とは別に見る。 */
function dialogText(): string {
  return document.body.textContent ?? ''
}
function button(label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((el) => el.textContent?.includes(label))
}
function dialogButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button'))
    .filter((el) => !host.contains(el))
    .find((el) => el.textContent?.includes(label))
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}
async function render() {
  await act(async () => {
    root.render(<GoogleSheetsPanel />)
  })
  await settle()
}

beforeEach(() => {
  calls.length = 0
  searchParams.value = ''
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : (input as Request).url
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost')
    const path = url.pathname + url.search
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, method, body })
    const responseBody = await handler(path, method)
    return new Response(JSON.stringify(responseBody ?? { success: false, error: 'unhandled' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))
  // Googleの同意画面へ飛ぶ `location.assign` はテスト内では記録だけする。
  vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

describe('#838 Google Sheets 連携パネル', () => {
  it('未接続: 接続ボタンを出し、押すとOAuth開始を呼ぶ', async () => {
    handler = async (path, method) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) return connectionBody('disconnected')
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      if (path === '/api/integrations/google-sheets/connect/start' && method === 'POST') {
        return { success: true, data: { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', mode: 'connect' } }
      }
      return { success: false, error: 'unhandled' }
    }
    await render()

    expect(text()).toContain('まだ接続されていません')
    const connectButton = button('Googleアカウントを接続する')
    expect(connectButton).toBeTruthy()

    await act(async () => { connectButton!.click() })
    await settle()
    const startCall = calls.find((c) => c.path === '/api/integrations/google-sheets/connect/start' && c.method === 'POST')
    expect(startCall?.body).toEqual({ accountId: 'acc-1' })
  })

  it('出力先未設定: 接続済みだがURL入力フォームが開いている', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) return connectionBody('pending_target')
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      return { success: false, error: 'unhandled' }
    }
    await render()

    expect(host.querySelector('#sheets-target')).toBeTruthy()
    expect(text()).toContain('未設定')
  })

  it('接続中: シート名リンク・前回同期・「今すぐ同期」を出し、同期を呼ぶ', async () => {
    handler = async (path, method) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) return connectionBody('connected')
      if (path.startsWith('/api/integrations/google-sheets/runs')) {
        return {
          success: true,
          data: {
            runs: [{
              id: 'run-1', kind: 'scheduled', dataType: 'friends', status: 'ok',
              rowsWritten: 120, error: null, startedAt: '2026-09-26T03:00:00.000Z', finishedAt: '2026-09-26T03:01:00.000Z',
            }],
          },
        }
      }
      if (path === '/api/integrations/google-sheets/sync' && method === 'POST') {
        return { success: true, data: { status: 'ok', results: [] } }
      }
      return { success: false, error: 'unhandled' }
    }
    await render()

    const link = host.querySelector('a[href="https://docs.google.com/spreadsheets/d/sheet-123"]')
    expect(link?.textContent).toContain('LINE連携シート')
    expect(text()).toContain('接続中')
    expect(text()).toContain('同期の記録')

    const syncButton = button('今すぐ同期')
    expect(syncButton).toBeTruthy()
    await act(async () => { syncButton!.click() })
    await settle()
    expect(calls.some((c) => c.path === '/api/integrations/google-sheets/sync' && c.method === 'POST')).toBe(true)
  })

  it('認可切れ: 「要再接続」を出し、同期ボタンではなく再接続を出す', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) return connectionBody('expired')
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      return { success: false, error: 'unhandled' }
    }
    await render()

    expect(text()).toContain('要再接続')
    expect(text()).toContain('許可が切れています')
    expect(button('再接続する')).toBeTruthy()
    expect(button('今すぐ同期')).toBeFalsy()
  })

  it('権限なし: 変更ボタンを出さず案内だけ出す', async () => {
    handler = async (path) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) {
        const body = connectionBody('disconnected') as { data: { canManage: boolean } }
        body.data.canManage = false
        return body
      }
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      return { success: false, error: 'unhandled' }
    }
    await render()

    expect(button('Googleアカウントを接続する')).toBeFalsy()
    expect(text()).toContain('統括の管理者だけが変更できます')
  })

  it('OAuthの戻り: 成功・失敗を人の言葉で出す', async () => {
    searchParams.value = 'tab=sheets&sheets=error%3Ainvalid_state'
    handler = async (path) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) return connectionBody('disconnected')
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      return { success: false, error: 'unhandled' }
    }
    await render()
    expect(text()).toContain('もう一度最初からお試しください')
  })

  it('解除は確認ダイアログを通し、confirmed 付きでPOSTする', async () => {
    handler = async (path, method) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) return connectionBody('connected')
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      if (path === '/api/integrations/google-sheets/disconnect' && method === 'POST') {
        return { success: true, data: { revoked: true } }
      }
      return { success: false, error: 'unhandled' }
    }
    await render()

    await act(async () => { button('接続を解除')!.click() })
    await settle()
    expect(dialogText()).toContain('接続を解除しますか')
    // 全ポップアップに右上の×がある（共有 Dialog 経由。アイコンなのでaria-labelで探す）。
    expect(document.body.querySelector('button[aria-label="閉じる"]')).toBeTruthy()

    await act(async () => { dialogButton('接続を解除する')!.click() })
    await settle()
    const disconnectCall = calls.find((c) => c.path === '/api/integrations/google-sheets/disconnect')
    expect(disconnectCall?.body).toEqual({ accountId: 'acc-1', confirmed: true })
  })
})
