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

describe('ROOT-18 精算の一連の見本', () => {
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
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/__mock-fingerprint`)
        if (response.ok) return
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw lastError ?? new Error('Visual QA モックが起動しませんでした')
  }, 15000)

  afterAll(() => {
    child?.kill('SIGTERM')
  })

  it('ROOT-18 確認した額と件数が確定・振込で変わらない', async () => {
    const preview = (await (await fetch(`${baseUrl}/api/affiliate-settlements/preview`)).json()).data
    const closed = (await (await fetch(`${baseUrl}/api/affiliate-settlements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: preview.lineAccountId, periodFrom: preview.periodFrom, periodTo: preview.periodTo, expectedPreviewVersion: preview.previewVersion })
    })).json()).data
    expect(closed.totalAmount).toBe(preview.totalAmount)
    expect(closed.conversionCount).toBe(preview.conversionCount)
    const batch = (await (await fetch(`${baseUrl}/api/affiliate-payout-batches`, { method: 'POST', body: JSON.stringify({ settlementId: closed.settlementId, expectedVersion: closed.version }) })).json()).data
    expect(batch.totalAmount).toBe(closed.totalAmount)
    expect(batch.lineCount).toBe(closed.conversionCount)
    expect(batch.settlementId).toBe(closed.settlementId)
  })
})
