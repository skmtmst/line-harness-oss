/*
 * デリバリー受注の読み口が、共通の仮サーバー（`mock-api.mjs`）で本物と同じ形で
 * 返ることを確かめる。ここが無いと `bodyFor` の既定の器（`{ success: true, data: … }`）
 * が返り、`success` が真なので画面は例外を捕まえられず、`data.store.id`・
 * `data.services`・`data.orders` を回したところで落ちて
 * 「画面を表示できませんでした」になる（題の測定が /restaurant-test/delivery で止まる）。
 * 対照試験：`mock-api.mjs` の `/api/restaurant-test/delivery/*` を消すと、
 * `data` を持つ既定の器が返るのでこの試験が落ちる。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('デリバリー受注：共通の仮サーバーの応答契約', () => {
  let child: ChildProcess
  let baseUrl: string

  beforeAll(async () => {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') return reject(new Error('空きポートを取得できませんでした'))
        server.close((error) => error ? reject(error) : resolve(address.port))
      })
    })
    baseUrl = `http://127.0.0.1:${port}`
    child = spawn(process.execPath, [fileURLToPath(new URL('./mock-api.mjs', import.meta.url))], {
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
    })
    const startupDeadline = Date.now() + 5000
    while (Date.now() < startupDeadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`偽 API が起動前に終了しました: ${child.exitCode ?? child.signalCode}`)
      }
      try {
        if ((await fetch(`${baseUrl}/__mock-fingerprint`, { signal: AbortSignal.timeout(500) })).ok) return
      } catch { /* 起動待ち */ }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('偽 API が起動しませんでした')
  })

  afterAll(() => { child?.kill('SIGTERM') })

  async function get(path: string) {
    const response = await fetch(`${baseUrl}${path}`)
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    // 既定の器は `data` で包むので、包まれていないことが本物と同じ形の証。
    expect(body).not.toHaveProperty('data')
    expect(body.success).toBe(true)
    return body
  }

  it('注文一覧は店・連携先・表の数・注文を平らに返す', async () => {
    const body = await get('/api/restaurant-test/delivery/orders?account_id=visual-qa-account&tab=new') as {
      store: { id: string; name: string }
      services: Array<{ service: string; connectionStatus: string; intakeStatus: string }>
      kpis: Record<string, number>
      tab: string
      tabCounts: Record<string, number>
      orders: Array<{ id: string; service: string; status: string; urgency: string }>
    }
    expect(body.store.id).toBeTruthy()
    expect(body.store.name).toBeTruthy()
    expect(body.services.map((row) => row.service)).toEqual(['ubereats', 'demaecan', 'rocketnow'])
    for (const row of body.services) {
      expect(['connected', 'disconnected', 'error']).toContain(row.connectionStatus)
      expect(['open', 'stopped']).toContain(row.intakeStatus)
    }
    expect(typeof body.kpis.todayCount).toBe('number')
    expect(body.tab).toBe('new')
    expect(body.tabCounts.new).toBe(body.orders.length)
    expect(body.orders.length).toBeGreaterThan(0)
    for (const order of body.orders) {
      expect(order.status).toBe('new')
      expect(['urgent', 'watch', 'normal']).toContain(order.urgency)
    }
  })

  it('表の選び取りと連携先の絞り込みが効く', async () => {
    const all = await get('/api/restaurant-test/delivery/orders?account_id=visual-qa-account&tab=all') as {
      orders: Array<{ id: string; service: string; status: string }>
    }
    expect(new Set(all.orders.map((order) => order.status)).size).toBeGreaterThan(1)
    const cooking = await get('/api/restaurant-test/delivery/orders?account_id=visual-qa-account&tab=cooking&service=ubereats') as {
      orders: Array<{ service: string; status: string }>
    }
    expect(cooking.orders.length).toBeGreaterThan(0)
    for (const order of cooking.orders) {
      expect(order.status).toBe('cooking')
      expect(order.service).toBe('ubereats')
    }
  })

  it('注文の詳細は注文と品目を返す', async () => {
    const list = await get('/api/restaurant-test/delivery/orders?account_id=visual-qa-account&tab=new') as {
      orders: Array<{ id: string }>
    }
    const body = await get(`/api/restaurant-test/delivery/orders/${list.orders[0].id}?account_id=visual-qa-account`) as {
      order: { id: string; serviceLabel: string; statusLabel: string }
      items: Array<{ name: string; quantity: number; amount: number }>
    }
    expect(body.order.id).toBe(list.orders[0].id)
    expect(body.order.serviceLabel).toBeTruthy()
    expect(body.order.statusLabel).toBeTruthy()
    expect(body.items.length).toBeGreaterThan(0)
    for (const item of body.items) {
      expect(item.name).toBeTruthy()
      expect(typeof item.quantity).toBe('number')
      expect(typeof item.amount).toBe('number')
    }
  })

  it('注文履歴は期間・合計・注文を返す', async () => {
    const body = await get('/api/restaurant-test/delivery/history?account_id=visual-qa-account') as {
      range: { from: string; to: string }
      totals: { count: number; amount: number; byService: Array<{ service: string; count: number }> }
      orders: Array<{ id: string; receivedAt: string }>
    }
    expect(body.range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.totals.byService.map((row) => row.service)).toEqual(['ubereats', 'demaecan', 'rocketnow'])
    expect(body.orders.length).toBeGreaterThan(0)
  })

  it('品切れ一括の品目は連携先の印を持つ', async () => {
    const body = await get('/api/restaurant-test/delivery/menu-items?account_id=visual-qa-account') as {
      store: { id: string }
      items: Array<{ id: string; name: string; soldOut: boolean; services: Array<{ service: string; label: string }> }>
    }
    expect(body.store.id).toBeTruthy()
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.some((item) => item.soldOut)).toBe(true)
    for (const item of body.items) {
      expect(item.name).toBeTruthy()
      expect(item.services.length).toBeGreaterThan(0)
    }
  })
})
