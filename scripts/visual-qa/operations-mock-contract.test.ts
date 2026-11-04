/*
 * 運用状態（機能32）の目視用の偽 API を実際に起動して叩く。
 *
 * 撮影で確認の窓・復旧の流れ・更新履歴の「管理画面の更新」欄まで進めるには、
 * 偽 API が停止・復旧・手動チェックの POST に本物と同じ形で答え、
 * 履歴に停止と配備の両方の記録（historyKind と occurredAt つき）を返す必要がある。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOCK_API = join(HERE, 'mock-api.mjs')

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('空きポートを取得できませんでした'))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

describe('運用状態の目視用の偽 API', () => {
  let child: ChildProcess
  let baseUrl: string

  beforeAll(async () => {
    const port = await availablePort()
    baseUrl = `http://127.0.0.1:${port}`
    child = spawn(process.execPath, [MOCK_API], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let lastError: unknown
    for (let attempt = 0; attempt < 250; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/__mock-fingerprint`)
        if (response.ok) return
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw lastError ?? new Error('Visual QA モックが起動しませんでした')
  })

  afterAll(() => {
    child?.kill('SIGTERM')
  })

  const post = async (path: string, body: unknown = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() as { success: boolean; data?: Record<string, unknown> } }
  }

  it('手動チェックは保存済みの健全性と同じ形で答える', async () => {
    const result = await post('/api/operations/health/runs', { lineAccountId: 'account-1' })
    expect(result.status).toBe(200)
    expect(result.body.success).toBe(true)
    expect(result.body.data).toHaveProperty('overallStatus')
    expect(result.body.data).toHaveProperty('latestRun')
  })

  it('停止は停止中の状態と停止の記録を返し、その記録から復旧できる', async () => {
    const stop = await post('/api/operations/incidents', { reason: '目視確認', confirmation: '停止' })
    expect(stop.status).toBe(200)
    expect(stop.body.data).toMatchObject({ status: 'changed', control: { activeIncidentId: expect.any(String) }, incident: { id: expect.any(String) } })

    const incidentId = (stop.body.data as { incident: { id: string } }).incident.id
    const restore = await post(`/api/operations/incidents/${encodeURIComponent(incidentId)}/restore`, { confirmation: '復旧' })
    expect(restore.status).toBe(200)
    expect(restore.body.data).toMatchObject({ incident: { id: incidentId, status: 'resolved' } })
  })

  it('履歴は停止と配備の両方を、種類と起きた時刻つきで返す', async () => {
    const response = await fetch(`${baseUrl}/api/operations/history?limit=200`)
    expect(response.status).toBe(200)
    const body = await response.json() as { data: Array<{ historyKind?: string; occurredAt?: string }> }
    const kinds = new Set(body.data.map((entry) => entry.historyKind))
    expect(kinds.has('incident')).toBe(true)
    expect(kinds.has('deployment')).toBe(true)
    expect(body.data.every((entry) => typeof entry.occurredAt === 'string' && !Number.isNaN(Date.parse(entry.occurredAt)))).toBe(true)
  })
})
