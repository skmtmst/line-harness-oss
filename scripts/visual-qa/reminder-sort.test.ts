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

describe('ROOT-15 リマインダの並び', () => {
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

  it.each(['next', 'order', 'created', 'updated', 'name'])('ROOT-15 sort=%s を本物と同じ並びとmetaで返す', async sort => {
    const response = await fetch(`${baseUrl}/api/reminders?page=1&limit=200&sort=${sort}`)
    const { data } = await response.json()
    const all = (await (await fetch(`${baseUrl}/api/reminders`)).json()).data
    const keys: Record<string, string[]> = { next: ['nextScheduledAt', 'id'], order: ['displayOrder', 'createdAt', 'id'], created: ['createdAt', 'id'], updated: ['updatedAt', 'id'], name: ['name', 'id'] }
    const expected = [...all].sort((a, b) => {
      if (sort === 'next') return Number(a.nextScheduledAt == null) - Number(b.nextScheduledAt == null) || String(a.nextScheduledAt ?? '').localeCompare(String(b.nextScheduledAt ?? '')) || a.id.localeCompare(b.id)
      if (sort === 'order') return (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
      if (sort === 'name') return (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0) || a.id.localeCompare(b.id)
      const key = sort === 'created' ? 'createdAt' : 'updatedAt'
      return b[key].localeCompare(a[key]) || a.id.localeCompare(b.id)
    })
    expect(data.items.map((r: { id: string }) => r.id)).toEqual(expected.map(r => r.id))
    expect(data.sort.map((v: { field: string }) => v.field)).toEqual(keys[sort])
  })
  it('sortだけの指定も一覧の器を返す', async () => {
    const { data } = await (await fetch(`${baseUrl}/api/reminders?sort=next`)).json()
    expect(data.items).toBeInstanceOf(Array)
  })
  it('未知の並び指定は本物同様400にする', async () => {
    expect((await fetch(`${baseUrl}/api/reminders?page=1&sort=unknown`)).status).toBe(400)
  })
})
