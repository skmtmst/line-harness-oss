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
const accountState: { selectedAccountId: string | null; selectedAccount: { name?: string } | null } = {
  selectedAccountId: 'acc-1',
  selectedAccount: null,
}
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: accountState.selectedAccountId,
    selectedAccount: accountState.selectedAccount,
    loading: false,
  }),
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
  accountState.selectedAccountId = 'acc-1'
  accountState.selectedAccount = null
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

  it('形の違う応答でも読み込み中のままにせず、読み直せる', async () => {
    // 監査の再現：包みなしの古い形が来ると例外で止まり「読み込んでいます…」のままだった。
    // 判定で弾いて読み込めなかった表示へ逃がし、読み直しで復帰できる。
    let legacy = true
    handler = async (path) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) {
        return legacy
          ? { success: true, connection: { status: 'connected' } }
          : connectionBody('connected')
      }
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      return { success: false, error: 'unhandled' }
    }
    await render()

    expect(text()).not.toContain('読み込んでいます…')
    expect(text()).toContain('連携の状態を読み込めませんでした')
    expect(text()).toContain('確かめ方')
    expect(button('もう一度読み込む')).toBeTruthy()

    legacy = false
    await act(async () => { button('もう一度読み込む')!.click() })
    await settle()
    expect(text()).toContain('接続中')
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

  it('解除はできてもGoogle側の許可取り消しに失敗したら、そのことを伝える（R440）', async () => {
    handler = async (path, method) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) return connectionBody('connected')
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      if (path === '/api/integrations/google-sheets/disconnect' && method === 'POST') {
        return { success: true, data: { revoked: false, connection: { status: 'disconnected' } } }
      }
      return { success: false, error: 'unhandled' }
    }
    await render()

    await act(async () => { button('接続を解除')!.click() })
    await settle()
    await act(async () => { dialogButton('接続を解除する')!.click() })
    await settle()

    expect(text()).toContain('Google側の許可の取り消しに失敗しました')
    expect(text()).toContain('アクセスを取り消してください')
  })

  it('同期の記録だけ読み込めなかったとき、連携の表示は残し記録側に再読込を出す（R443）', async () => {
    let runsFail = true
    handler = async (path) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) return connectionBody('connected')
      if (path.startsWith('/api/integrations/google-sheets/runs')) {
        return runsFail ? { success: false, error: 'internal' } : { success: true, data: { runs: [{
          id: 'run-1', kind: 'manual', dataType: 'friends', status: 'ok',
          rowsWritten: 3, error: null, startedAt: '2026-09-26T03:00:00.000Z', finishedAt: '2026-09-26T03:01:00.000Z',
        }] } }
      }
      return { success: false, error: 'unhandled' }
    }
    await render()

    // 連携の状態は正常に出る
    expect(text()).toContain('接続中')
    expect(text()).toContain('同期の記録を読み込めませんでした')
    expect(button('記録を読み直す')).toBeTruthy()

    runsFail = false
    await act(async () => { button('記録を読み直す')!.click() })
    await settle()
    expect(text()).not.toContain('同期の記録を読み込めませんでした')
    expect(text()).toContain('3行')
  })

  it('30分以上前に始まった実行中の記録は、回収できることを伝え「今すぐ同期」を止めない（R444）', async () => {
    const staleStart = new Date(Date.now() - 45 * 60 * 1000).toISOString()
    handler = async (path) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) {
        return connectionBody('connected', { syncRunning: true })
      }
      if (path.startsWith('/api/integrations/google-sheets/runs')) {
        return { success: true, data: { runs: [{
          id: 'run-stale', kind: 'manual', dataType: 'friends', status: 'running',
          rowsWritten: 0, error: null, startedAt: staleStart, finishedAt: null,
        }] } }
      }
      return { success: false, error: 'unhandled' }
    }
    await render()

    expect(text()).toContain('途中で止まったまま残っています')
    const syncButton = button('今すぐ同期')!
    expect(syncButton).toBeTruthy()
    expect(syncButton.disabled).toBe(false)
  })

  it('出力先の保存は通ったが読み直しに失敗したとき、保存できたことと読込失敗を分けて出す（R445）', async () => {
    let connectionFails = false
    handler = async (path, method) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) {
        return connectionFails ? { success: false, error: 'internal' } : connectionBody('connected')
      }
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      if (path === '/api/integrations/google-sheets/target' && method === 'PUT') {
        connectionFails = true
        return { success: true, data: { connection: { status: 'connected' } } }
      }
      return { success: false, error: 'unhandled' }
    }
    await render()

    await act(async () => { button('出力先を変更')!.click() })
    await settle()
    const input = host.querySelector('#sheets-target') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'sheet-xyz')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { button('保存')!.click() })
    await settle()

    expect(text()).toContain('出力先を保存しましたが、最新の状態を読み込めませんでした')
    // 「保存に失敗した」旨は出さない（同じ値をもう一度保存させない）
    expect(text()).not.toContain('出力先を保存できませんでした')
  })

  it('解除の確認窓は対象アカウント名を見せ、アカウント切替で閉じる（R446/R447）', async () => {
    accountState.selectedAccount = { name: '一号店' }
    handler = async (path) => {
      if (path.startsWith('/api/integrations/google-sheets/connection')) return connectionBody('connected')
      if (path.startsWith('/api/integrations/google-sheets/runs')) return { success: true, data: { runs: [] } }
      return { success: false, error: 'unhandled' }
    }
    await render()

    await act(async () => { button('接続を解除')!.click() })
    await settle()
    expect(dialogText()).toContain('一号店')

    // 窓を開いたまま別アカウントへ切り替える → 確認窓は閉じる
    accountState.selectedAccountId = 'acc-2'
    accountState.selectedAccount = { name: '二号店' }
    await act(async () => { root.render(<GoogleSheetsPanel />) })
    await settle()
    expect(dialogText()).not.toContain('接続を解除しますか')
    // acc-2 の解除は送られていない
    expect(calls.some((c) => c.path === '/api/integrations/google-sheets/disconnect')).toBe(false)
  })
})
