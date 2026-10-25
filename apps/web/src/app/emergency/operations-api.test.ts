// 機能32（運用状態）の画面が叩く口を、fetch に渡る中身で見る。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const { api } = await import('@/lib/api')

type Sent = { url: URL; method: string; headers: Headers; body: unknown }
let sent: Sent[] = []

beforeEach(() => {
  sent = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : null
    sent.push({
      url: new URL(String(input)),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: new Headers(init?.headers),
      body: raw ? JSON.parse(raw) : null,
    })
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('健全性の口', () => {
  it('保存済みの健全性は選んだアカウントで読み、手動の確認は同じアカウントで走らせる', async () => {
    await api.operations.health('account a/1')
    await api.operations.runHealth('account a/1')
    expect(sent[0]).toMatchObject({ method: 'GET' })
    expect(sent[0].url.pathname).toBe('/api/operations/health')
    expect(sent[0].url.searchParams.get('account_id')).toBe('account a/1')
    expect(sent[1]).toMatchObject({ method: 'POST', body: { lineAccountId: 'account a/1' } })
    expect(sent[1].url.pathname).toBe('/api/operations/health/runs')
  })
})

describe('停止と復旧の口', () => {
  it('本人確認は運用操作の用途で一回限りの証明を取りに行く（6桁でもパスワードでも）', async () => {
    await api.operations.stepUp({ method: 'totp', value: '481516' })
    await api.operations.stepUp({ method: 'password', value: 'pass-1' })
    expect(sent.map((item) => item.url.pathname)).toEqual(['/api/auth/step-up', '/api/auth/step-up'])
    expect(sent[0]).toMatchObject({ method: 'POST', body: { code: '481516', purpose: 'operations.control' } })
    expect(sent[1]).toMatchObject({ method: 'POST', body: { password: 'pass-1', purpose: 'operations.control' } })
  })

  it('停止は証明・再実行キー・取り消せない操作の印を付けて送る', async () => {
    await api.operations.stop({
      lineAccountId: null, capabilities: ['broadcast_dispatch'], reason: '誤配信', confirmation: '停止', expectedVersion: 3,
    }, 'step-up-token', 'key-stop-1')
    expect(sent[0]).toMatchObject({ method: 'POST', body: { reason: '誤配信', confirmation: '停止', expectedVersion: 3 } })
    expect(sent[0].url.pathname).toBe('/api/operations/incidents')
    expect(sent[0].headers.get('X-Step-Up-Token')).toBe('step-up-token')
    expect(sent[0].headers.get('Idempotency-Key')).toBe('key-stop-1')
    expect(sent[0].headers.get('X-Confirm-Irreversible')).toBe('operation-stop')
  })

  it('復旧も証明・再実行キー・取り消せない操作の印を付けて、その停止へ送る', async () => {
    await api.operations.restore('incident/9', { confirmation: '復旧', expectedVersion: 4 }, 'step-up-token', 'key-restore-1')
    expect(sent[0]).toMatchObject({ method: 'POST', body: { confirmation: '復旧', expectedVersion: 4 } })
    expect(sent[0].url.pathname).toBe('/api/operations/incidents/incident%2F9/restore')
    expect(sent[0].headers.get('X-Step-Up-Token')).toBe('step-up-token')
    expect(sent[0].headers.get('Idempotency-Key')).toBe('key-restore-1')
    expect(sent[0].headers.get('X-Confirm-Irreversible')).toBe('operation-restore')
  })
})
