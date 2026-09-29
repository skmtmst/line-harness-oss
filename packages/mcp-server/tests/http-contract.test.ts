import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FriendsResource } from '../../sdk/src/resources/friends.js'
import { BroadcastsResource } from '../../sdk/src/resources/broadcasts.js'
import { ScenariosResource } from '../../sdk/src/resources/scenarios.js'
import { ConversationsResource } from '../../sdk/src/resources/conversations.js'
import { FormsResource } from '../../sdk/src/resources/forms.js'
import { RichMenusResource } from '../../sdk/src/resources/rich-menus.js'
import type { HttpClient } from '../../sdk/src/http.js'
import { LineHarnessError } from '../../sdk/src/errors.js'
import { registerAccountSummary } from '../src/tools/account-summary.js'
import { getClient } from '../src/client.js'
import { captureRegistrations } from './registration.test.js'

vi.mock('../src/client.js', () => ({ getClient: vi.fn() }))

const mockGetClient = vi.mocked(getClient)

function mockHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as HttpClient
}

const SAVED_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  process.env = { ...SAVED_ENV }
  vi.unstubAllGlobals()
})

// These tests lock the HTTP contract (URL + method + body + accountId)
// behind the MCP tools. They use a fake HttpClient, so no network happens.
// If the SDK changes a path or a body field, these fail on purpose.

describe('friends HTTP contract (POST /api/friends/:id/messages etc.)', () => {
  it('list() with accountId calls GET /api/friends with lineAccountId', async () => {
    const page = { items: [], total: 0, hasNextPage: false }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: page }) })
    const resource = new FriendsResource(http)
    await resource.list({ limit: 20, offset: 0, accountId: 'acc-9' })
    expect(http.get).toHaveBeenCalledWith('/api/friends?limit=20&offset=0&lineAccountId=acc-9')
  })

  it('sendMessage() calls POST /api/friends/:id/messages with the message body', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { messageId: 'm1' } }) })
    const resource = new FriendsResource(http)
    await resource.sendMessage('f1', 'hi', 'text', undefined, { trackLinks: true })
    expect(http.post).toHaveBeenCalledWith('/api/friends/f1/messages', {
      messageType: 'text',
      content: 'hi',
      trackLinks: true,
    })
  })
})

describe('broadcasts HTTP contract', () => {
  it('list() with accountId calls GET /api/broadcasts?lineAccountId=', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: [] }) })
    await new BroadcastsResource(http).list({ accountId: 'acc-1' })
    expect(http.get).toHaveBeenCalledWith('/api/broadcasts?lineAccountId=acc-1')
  })

  it('create() calls POST /api/broadcasts with lineAccountId in the body', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { id: 'b1' } }) })
    await new BroadcastsResource(http).create({
      title: 'Sale',
      messageType: 'text',
      messageContent: 'hi',
      targetType: 'all',
      lineAccountId: 'acc-1',
    })
    expect(http.post).toHaveBeenCalledWith('/api/broadcasts', {
      title: 'Sale',
      messageType: 'text',
      messageContent: 'hi',
      targetType: 'all',
      lineAccountId: 'acc-1',
    })
  })

  it('send() calls POST /api/broadcasts/:id/send', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { id: 'b1' } }) })
    await new BroadcastsResource(http).send('b1')
    expect(http.post).toHaveBeenCalledWith('/api/broadcasts/b1/send')
  })

  it('sendToSegment() calls POST /api/broadcasts/:id/send-segment with conditions', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { id: 'b1' } }) })
    const conditions = { operator: 'AND', rules: [] } as never
    await new BroadcastsResource(http).sendToSegment('b1', conditions)
    expect(http.post).toHaveBeenCalledWith('/api/broadcasts/b1/send-segment', { conditions })
  })
})

describe('scenarios HTTP contract', () => {
  it('create() calls POST /api/scenarios with lineAccountId in the body', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { id: 's1' } }) })
    await new ScenariosResource(http).create({ name: 'W', triggerType: 'manual', lineAccountId: 'acc-1' })
    expect(http.post).toHaveBeenCalledWith('/api/scenarios', {
      name: 'W',
      triggerType: 'manual',
      lineAccountId: 'acc-1',
    })
  })

  it('enroll() calls POST /api/scenarios/:id/enroll/:friendId', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { id: 'enr-1' } }) })
    await new ScenariosResource(http).enroll('s1', 'f1')
    expect(http.post).toHaveBeenCalledWith('/api/scenarios/s1/enroll/f1')
  })

  it('addStep() calls POST /api/scenarios/:id/steps', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { id: 'st-1' } }) })
    const step = { stepOrder: 1, delayMinutes: 30, messageType: 'text', messageContent: 'hi' } as never
    await new ScenariosResource(http).addStep('s1', step)
    expect(http.post).toHaveBeenCalledWith('/api/scenarios/s1/steps', step)
  })
})

describe('conversations HTTP contract', () => {
  it('list() calls GET /api/conversations with lineAccountId', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: { total: 0, items: [] } }) })
    await new ConversationsResource(http).list({ lineAccountId: 'acc-1', minHoursSince: 2, limit: 50, offset: 0 })
    expect(http.get).toHaveBeenCalledWith(
      '/api/conversations?lineAccountId=acc-1&minHoursSince=2&limit=50&offset=0',
    )
  })

  it('get() calls GET /api/conversations/:friendId with limit', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: { messages: [] } }) })
    await new ConversationsResource(http).get({ friendId: 'f7', limit: 50 })
    expect(http.get).toHaveBeenCalledWith('/api/conversations/f7?limit=50')
  })
})

describe('forms + rich menus HTTP contract', () => {
  it('forms.create() calls POST /api/forms', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { id: 'form-1' } }) })
    const input = { name: 'Survey', fields: [] } as never
    await new FormsResource(http).create(input)
    expect(http.post).toHaveBeenCalledWith('/api/forms', input)
  })

  it('forms.getSubmissions() calls GET /api/forms/:id/submissions', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: [] }) })
    await new FormsResource(http).getSubmissions('form-1')
    expect(http.get).toHaveBeenCalledWith('/api/forms/form-1/submissions')
  })

  it('richMenus.create/uploadImage/setDefault call their POST endpoints', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { richMenuId: 'rm-1' } }) })
    const resource = new RichMenusResource(http)
    const menu = { name: 'Main', chatBarText: 'menu', size: { width: 2500, height: 1686 }, selected: false, areas: [] } as never
    await resource.create(menu)
    expect(http.post).toHaveBeenCalledWith('/api/rich-menus', menu)
    await resource.uploadImage('rm-1', 'aGVsbG8=', 'image/png')
    expect(http.post).toHaveBeenCalledWith('/api/rich-menus/rm-1/image', {
      imageData: 'aGVsbG8=',
      contentType: 'image/png',
    })
    await resource.setDefault('rm-1')
    expect(http.post).toHaveBeenCalledWith('/api/rich-menus/rm-1/default')
  })
})

describe('error conversion source (SDK throws LineHarnessError with status + endpoint)', () => {
  it('keeps status/endpoint so MCP tools can render them into { success:false }', async () => {
    const http = mockHttp({
      get: vi.fn().mockRejectedValue(new LineHarnessError('HTTP 404', 404, 'GET /api/friends/f9')),
    })
    const error = await new FriendsResource(http).get('f9').catch((e) => e as LineHarnessError)
    expect(error).toBeInstanceOf(LineHarnessError)
    expect(error.status).toBe(404)
    expect(error.endpoint).toBe('GET /api/friends/f9')
    expect(String(error)).toContain('HTTP 404')
  })
})

describe('account_summary direct fetch contract (fake fetch, no network)', () => {
  function accountSummaryHandler() {
    const [tool] = captureRegistrations(registerAccountSummary)
    return tool.handler as (args: unknown) => Promise<unknown>
  }

  function sdkWithEmptyLists() {
    return {
      friends: { count: vi.fn().mockResolvedValue(5) },
      scenarios: { list: vi.fn().mockResolvedValue([]) },
      broadcasts: { list: vi.fn().mockResolvedValue([]) },
      tags: { list: vi.fn().mockResolvedValue([]) },
      forms: { list: vi.fn().mockResolvedValue([]) },
    } as unknown as ReturnType<typeof getClient>
  }

  it('calls GET /api/line-accounts with Bearer auth', async () => {
    process.env.LINE_HARNESS_API_URL = 'https://fake.example'
    process.env.LINE_HARNESS_API_KEY = 'fake-key'
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    mockGetClient.mockReturnValue(sdkWithEmptyLists())
    const result = (await accountSummaryHandler()({ accountId: undefined })) as {
      content: Array<{ text: string }>
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, { method?: string; headers: Record<string, string> }]
    expect(url).toBe('https://fake.example/api/line-accounts')
    expect(init.method ?? 'GET').toBe('GET')
    expect(init.headers.Authorization).toBe('Bearer fake-key')
    const summary = JSON.parse(result.content[0].text)
    expect(summary.friends.totalDbRecords).toBe(5)
  })

  it('fetches per-account count/insight/health URLs with the account id', async () => {
    process.env.LINE_HARNESS_API_URL = 'https://fake.example'
    process.env.LINE_HARNESS_API_KEY = 'fake-key'
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/line-accounts')) {
        return { ok: true, json: async () => ({ success: true, data: [{ id: 'acc-1', name: 'A', channelId: 'C1' }] }) }
      }
      if (url.includes('/api/friends/count')) {
        return { ok: true, json: async () => ({ success: true, data: { count: 7 } }) }
      }
      if (url.includes('/follower-insight')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { status: 'ready', followers: 10, targetedReaches: 9, blocks: 1 },
          }),
        }
      }
      if (url.includes('/health')) {
        return { ok: true, json: async () => ({ success: true, data: { riskLevel: 'low' } }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchSpy)
    mockGetClient.mockReturnValue(sdkWithEmptyLists())
    const result = (await accountSummaryHandler()({ accountId: undefined })) as {
      content: Array<{ text: string }>
    }
    const urls = fetchSpy.mock.calls.map((call) => (call as [string])[0])
    expect(urls[0]).toBe('https://fake.example/api/line-accounts')
    expect(urls).toContain('https://fake.example/api/friends/count?lineAccountId=acc-1')
    expect(urls.some((u) => u.startsWith('https://fake.example/api/line-accounts/acc-1/follower-insight?date='))).toBe(true)
    expect(urls).toContain('https://fake.example/api/accounts/acc-1/health')
    for (const call of fetchSpy.mock.calls) {
      const init = (call as [string, { headers: Record<string, string> }])[1]
      expect(init.headers.Authorization).toBe('Bearer fake-key')
    }
    const summary = JSON.parse(result.content[0].text)
    expect(summary.friends.perAccount[0].friendsInDb).toBe(7)
    expect(summary.friends.perAccount[0].friendsFromLine).toBe(10)
  })
})
