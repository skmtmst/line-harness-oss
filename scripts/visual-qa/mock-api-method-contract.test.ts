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

describe('Visual QA モックの HTTP method 受け渡し', () => {
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
    for (let attempt = 0; attempt < 50; attempt += 1) {
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

  it('計測鍵を待たせず返し、同じアカウントは同じ鍵・別アカウントは別の鍵', async () => {
    const key = async (account: string) => {
      const response = await fetch(`${baseUrl}/api/site/tracking-key?account_id=${account}`, { signal: AbortSignal.timeout(2000) })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ success: true, data: { accountId: account } })
      expect(body.data.trackingKey).toMatch(/^hk_[a-f0-9]{32}$/)
      return body.data.trackingKey as string
    }
    const first = await key('visual-account-one')
    expect(await key('visual-account-one')).toBe(first)
    expect(await key('visual-account-two')).not.toBe(first)
  })

  it.each([
    ['GET', '/api/forms', 200],
    ['POST', '/api/forms/drafts', 200],
    ['PUT', '/api/forms/form-1', 200],
    ['DELETE', '/api/forms/form-1', 200],
  ])('%s %s が未定義変数で止まらない', async (method, pathname, status) => {
    const response = await fetch(`${baseUrl}${pathname}`, { method })
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ success: true })
  })
})
