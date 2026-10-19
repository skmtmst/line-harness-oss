import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerManageTrafficPools } from '../src/tools/manage-traffic-pools.js'

type Result = { isError?: boolean; content: Array<{ type: string; text: string }> }
type Args = Record<string, unknown>

function handler() {
  const tool = vi.fn()
  registerManageTrafficPools({ tool } as unknown as McpServer)
  return tool.mock.calls[0][3] as (args: Args) => Promise<Result>
}

const actions = [
  [{ action: 'list' }, 'GET', '/api/traffic-pools', undefined],
  [{ action: 'create', slug: 'main', name: 'Main', activeAccountId: 'acc-1' }, 'POST', '/api/traffic-pools', { slug: 'main', name: 'Main', activeAccountId: 'acc-1' }],
  [{ action: 'update', poolId: 'p1', name: 'New', isActive: false }, 'PUT', '/api/traffic-pools/p1', { name: 'New', isActive: false }],
  [{ action: 'delete', poolId: 'p1' }, 'DELETE', '/api/traffic-pools/p1', undefined],
  [{ action: 'list_accounts', poolId: 'p1' }, 'GET', '/api/traffic-pools/p1/accounts', undefined],
  [{ action: 'add_account', poolId: 'p1', lineAccountId: 'acc-2' }, 'POST', '/api/traffic-pools/p1/accounts', { lineAccountId: 'acc-2' }],
  [{ action: 'remove_account', poolId: 'p1', poolAccountId: 'pa1' }, 'DELETE', '/api/traffic-pools/p1/accounts/pa1', undefined],
  [{ action: 'toggle_account', poolId: 'p1', poolAccountId: 'pa1', isActive: false }, 'PUT', '/api/traffic-pools/p1/accounts/pa1', { isActive: false }],
] as const

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('traffic pool tool HTTP results', () => {
  it.each(actions)('preserves the request and response for %j', async (args, method, path, body) => {
    vi.stubEnv('LINE_HARNESS_API_URL', 'https://fake.example')
    vi.stubEnv('LINE_HARNESS_API_KEY', 'fake-key')
    const data = { success: true, data: { id: 'p1' } }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(data))
    vi.stubGlobal('fetch', fetchMock)
    const result = await handler()(args)
    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text)).toEqual(data)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`https://fake.example${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-key' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  })

  it.each([403, 500])('marks HTTP %i as an error for every action without retrying', async (status) => {
    vi.stubEnv('LINE_HARNESS_API_URL', 'https://fake.example')
    vi.stubEnv('LINE_HARNESS_API_KEY', 'fake-key')
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ success: false, error: 'Rejected' }, { status }))
    vi.stubGlobal('fetch', fetchMock)
    const run = handler()
    for (const [args] of actions) {
      const result = await run(args)
      expect(result.isError).toBe(true)
      expect(JSON.parse(result.content[0].text)).toEqual({ success: false, error: 'Rejected' })
    }
    expect(fetchMock).toHaveBeenCalledTimes(actions.length)
  })

  it('marks a non-JSON failure as an error', async () => {
    vi.stubEnv('LINE_HARNESS_API_URL', 'https://fake.example')
    vi.stubEnv('LINE_HARNESS_API_KEY', 'fake-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 500 })))
    expect((await handler()({ action: 'list' })).isError).toBe(true)
  })
})
