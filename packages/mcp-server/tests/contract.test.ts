import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LineHarnessError } from '../../sdk/src/errors.js'
import { registerAllTools } from '../src/tools/index.js'
import { getClient } from '../src/client.js'
import type { CapturedTool } from './registration.test.js'
import { captureRegistrations } from './registration.test.js'

vi.mock('../src/client.js', () => ({ getClient: vi.fn() }))

const mockGetClient = vi.mocked(getClient)

function handlers(): Map<string, CapturedTool> {
  const tools = captureRegistrations(registerAllTools)
  return new Map(tools.map((t) => [t.name, t]))
}

function textOf(result: unknown): string {
  const res = result as { content: Array<{ text: string }> }
  return res.content[0].text
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true
}

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    friends: {
      list: vi.fn().mockResolvedValue({ total: 0, hasNextPage: false, items: [] }),
      get: vi.fn().mockResolvedValue({ id: 'f1' }),
      count: vi.fn().mockResolvedValue(0),
      sendMessage: vi.fn().mockResolvedValue({ messageId: 'm1' }),
    },
    broadcasts: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: 'b1' }),
      create: vi.fn().mockResolvedValue({ id: 'b1' }),
      update: vi.fn(),
      send: vi.fn().mockResolvedValue({ id: 'b1' }),
      sendToSegment: vi.fn().mockResolvedValue({ id: 'b1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    scenarios: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: 's1', steps: [] }),
      create: vi.fn().mockResolvedValue({ id: 's1' }),
      addStep: vi.fn().mockResolvedValue({ id: 'step-1' }),
      delete: vi.fn().mockResolvedValue(undefined),
      enroll: vi.fn().mockResolvedValue({ id: 'enr-1' }),
    },
    conversations: {
      list: vi.fn().mockResolvedValue({ total: 0, items: [] }),
      get: vi.fn().mockResolvedValue({ messages: [] }),
    },
    forms: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'form-1' }),
      getSubmissions: vi.fn().mockResolvedValue([]),
    },
    richMenus: {
      create: vi.fn().mockResolvedValue({ richMenuId: 'rm-1' }),
      uploadImage: vi.fn().mockResolvedValue(undefined),
      setDefault: vi.fn().mockResolvedValue(undefined),
    },
    tags: { list: vi.fn().mockResolvedValue([]) },
    ...overrides,
  } as unknown as ReturnType<typeof getClient>
}

const SAVED_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  process.env = { ...SAVED_ENV }
  vi.unstubAllGlobals()
})

describe('send_message (送信)', () => {
  it('passes friendId/content/type/trackLinks to SDK and returns messageId', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('send_message')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      friendId: 'f1',
      content: 'hello',
      messageType: 'text',
      altText: undefined,
      isTest: false,
      trackLinks: true,
    })
    expect(client.friends.sendMessage).toHaveBeenCalledWith(
      'f1',
      'hello',
      'text',
      undefined,
      { trackLinks: true },
    )
    expect(JSON.parse(textOf(result))).toEqual({ success: true, messageId: 'm1' })
    expect(isError(result)).toBe(false)
  })

  it('prepends the test banner for isTest text sends', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('send_message')!.handler as (args: unknown) => Promise<unknown>
    await handler({
      friendId: 'f1',
      content: 'hello',
      messageType: 'text',
      altText: undefined,
      isTest: true,
      trackLinks: true,
    })
    expect(client.friends.sendMessage).toHaveBeenCalledWith(
      'f1',
      '【テスト配信】\nhello',
      'text',
      undefined,
      { trackLinks: true },
    )
  })

  it('maps SDK errors to { success:false } with isError (no throw, no retry)', async () => {
    const client = fakeClient({
      friends: {
        sendMessage: vi
          .fn()
          .mockRejectedValue(new LineHarnessError('HTTP 404', 404, 'POST /api/friends/f1/messages')),
      },
    })
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('send_message')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      friendId: 'f1',
      content: 'hello',
      messageType: 'text',
      altText: undefined,
      isTest: false,
      trackLinks: true,
    })
    expect(isError(result)).toBe(true)
    const body = JSON.parse(textOf(result))
    expect(body.success).toBe(false)
    expect(body.error).toContain('HTTP 404')
  })
})

describe('broadcast (配信)', () => {
  it('immediate broadcast maps accountId to lineAccountId and sends', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('broadcast')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      title: 'Sale',
      messageType: 'text',
      messageContent: 'half off',
      targetType: 'all',
      targetTagId: undefined,
      segmentConditions: undefined,
      scheduledAt: undefined,
      altText: undefined,
      accountId: 'acc-1',
      trackLinks: true,
    })
    expect(client.broadcasts.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sale', targetType: 'all', lineAccountId: 'acc-1', trackLinks: true }),
    )
    expect(client.broadcasts.send).toHaveBeenCalledWith('b1')
    expect(JSON.parse(textOf(result)).success).toBe(true)
  })

  it('scheduled broadcast returns the draft without sending', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('broadcast')!.handler as (args: unknown) => Promise<unknown>
    await handler({
      title: 'Sale',
      messageType: 'text',
      messageContent: 'half off',
      targetType: 'all',
      targetTagId: undefined,
      segmentConditions: undefined,
      scheduledAt: '2026-09-10T10:00:00+09:00',
      altText: undefined,
      accountId: undefined,
      trackLinks: true,
    })
    expect(client.broadcasts.create).toHaveBeenCalled()
    expect(client.broadcasts.send).not.toHaveBeenCalled()
  })

  it('segment without conditions is rejected before any SDK call', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('broadcast')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      title: 'Sale',
      messageType: 'text',
      messageContent: 'hi',
      targetType: 'segment',
      targetTagId: undefined,
      segmentConditions: undefined,
      scheduledAt: undefined,
      altText: undefined,
      accountId: undefined,
      trackLinks: true,
    })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('segmentConditions is required')
    expect(client.broadcasts.create).not.toHaveBeenCalled()
  })

  it('segment with invalid JSON is rejected before any SDK call', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('broadcast')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      title: 'Sale',
      messageType: 'text',
      messageContent: 'hi',
      targetType: 'segment',
      targetTagId: undefined,
      segmentConditions: '{oops',
      scheduledAt: undefined,
      altText: undefined,
      accountId: undefined,
      trackLinks: true,
    })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('must be valid JSON')
    expect(client.broadcasts.create).not.toHaveBeenCalled()
  })

  it('scheduled segment broadcast is rejected (unsupported combination)', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('broadcast')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      title: 'Sale',
      messageType: 'text',
      messageContent: 'hi',
      targetType: 'segment',
      targetTagId: undefined,
      segmentConditions: '{"operator":"AND","rules":[]}',
      scheduledAt: '2026-09-10T10:00:00+09:00',
      altText: undefined,
      accountId: undefined,
      trackLinks: true,
    })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('not supported')
    expect(client.broadcasts.create).not.toHaveBeenCalled()
  })

  it('segment broadcast prefixes title, forwards parsed conditions, and cleans up on send failure', async () => {
    const client = fakeClient({
      broadcasts: {
        create: vi.fn().mockResolvedValue({ id: 'b9' }),
        sendToSegment: vi.fn().mockRejectedValue(new Error('segment send boom')),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    })
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('broadcast')!.handler as (args: unknown) => Promise<unknown>
    const conditions = { operator: 'AND', rules: [] }
    const result = await handler({
      title: 'Sale',
      messageType: 'text',
      messageContent: 'hi',
      targetType: 'segment',
      targetTagId: undefined,
      segmentConditions: JSON.stringify(conditions),
      scheduledAt: undefined,
      altText: undefined,
      accountId: 'acc-2',
      trackLinks: false,
    })
    expect(client.broadcasts.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: '[SEGMENT] Sale', targetType: 'all', lineAccountId: 'acc-2' }),
    )
    expect(client.broadcasts.sendToSegment).toHaveBeenCalledWith('b9', conditions)
    expect(client.broadcasts.delete).toHaveBeenCalledWith('b9')
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('segment send boom')
  })
})

describe('friends (友だち)', () => {
  it('list_friends forwards search/metadata/accountId to SDK', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('list_friends')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      search: 'sato',
      tagId: undefined,
      metadataFilter: '{"plan":"pro"}',
      limit: 20,
      offset: 0,
      accountId: 'acc-9',
    })
    expect(client.friends.list).toHaveBeenCalledWith({
      search: 'sato',
      tagId: undefined,
      metadata: { plan: 'pro' },
      limit: 20,
      offset: 0,
      accountId: 'acc-9',
    })
    expect(JSON.parse(textOf(result)).success).toBe(true)
  })

  it('list_friends maps SDK errors to isError', async () => {
    const client = fakeClient({
      friends: {
        list: vi.fn().mockRejectedValue(new LineHarnessError('HTTP 500', 500, 'GET /api/friends')),
      },
    })
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('list_friends')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      search: undefined,
      tagId: undefined,
      metadataFilter: undefined,
      limit: 20,
      offset: 0,
      accountId: undefined,
    })
    expect(isError(result)).toBe(true)
    expect(JSON.parse(textOf(result)).success).toBe(false)
  })

  it('get_friend_detail without messages never touches the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('get_friend_detail')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({ friendId: 'f1', includeMessages: false })
    expect(client.friends.get).toHaveBeenCalledWith('f1')
    expect(fetchSpy).not.toHaveBeenCalled()
    const body = JSON.parse(textOf(result))
    expect(body.success).toBe(true)
    expect(body.friend).toEqual({ id: 'f1' })
  })

  it('get_friend_detail with messages calls GET /api/friends/:id/messages with Bearer auth (fake fetch)', async () => {
    process.env.LINE_HARNESS_API_URL = 'https://fake.example'
    process.env.LINE_HARNESS_API_KEY = 'fake-key'
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'msg-1' }] }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('get_friend_detail')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({ friendId: 'f1', includeMessages: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://fake.example/api/friends/f1/messages')
    expect(init.headers.Authorization).toBe('Bearer fake-key')
    const body = JSON.parse(textOf(result))
    expect(body.messages).toEqual([{ id: 'msg-1' }])
  })
})

describe('conversations (会話)', () => {
  it('list_conversations forwards lineAccountId and paging to SDK', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('list_conversations')!.handler as (args: unknown) => Promise<unknown>
    await handler({
      lineAccountId: 'acc-1',
      minHoursSince: 2,
      maxHoursSince: undefined,
      limit: 50,
      offset: 0,
    })
    expect(client.conversations.list).toHaveBeenCalledWith({
      lineAccountId: 'acc-1',
      minHoursSince: 2,
      maxHoursSince: undefined,
      limit: 50,
      offset: 0,
    })
  })

  it('get_conversation forwards friendId/limit/before to SDK', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('get_conversation')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({ friendId: 'f7', limit: 50, before: undefined })
    expect(client.conversations.get).toHaveBeenCalledWith({ friendId: 'f7', limit: 50, before: undefined })
    expect(JSON.parse(textOf(result)).success).toBe(true)
  })

  it('get_conversation maps SDK errors to isError', async () => {
    const client = fakeClient({
      conversations: {
        get: vi.fn().mockRejectedValue(new LineHarnessError('HTTP 404', 404, 'GET /api/conversations/f7')),
      },
    })
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('get_conversation')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({ friendId: 'f7', limit: 50, before: undefined })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('HTTP 404')
  })
})

describe('forms (フォーム)', () => {
  it('create_form parses fields JSON and forwards the body to SDK', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('create_form')!.handler as (args: unknown) => Promise<unknown>
    const fields = [{ name: 'q1', label: 'Q1', type: 'text' }]
    const result = await handler({
      name: 'Survey',
      description: undefined,
      fields: JSON.stringify(fields),
      onSubmitTagId: undefined,
      onSubmitScenarioId: undefined,
      onSubmitMessageType: undefined,
      onSubmitMessageContent: undefined,
      saveToMetadata: true,
      ogTitle: undefined,
      ogDescription: undefined,
      ogImageUrl: undefined,
    })
    expect(client.forms.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Survey', fields, saveToMetadata: true }),
    )
    expect(JSON.parse(textOf(result)).success).toBe(true)
  })

  it('get_form_submissions forwards formId to SDK', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('get_form_submissions')!.handler as (args: unknown) => Promise<unknown>
    await handler({ formId: 'form-1' })
    expect(client.forms.getSubmissions).toHaveBeenCalledWith('form-1')
  })
})

describe('scenarios (シナリオ)', () => {
  it('create_scenario converts delays, maps accountId, and adds steps in order', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('create_scenario')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      name: 'Welcome',
      triggerType: 'manual',
      triggerTagId: undefined,
      steps: [
        { delay: '0m', type: 'text', content: 'hi' },
        { delay: '30m', type: 'text', content: 'again' },
      ],
      accountId: 'acc-1',
    })
    expect(client.scenarios.create).toHaveBeenCalledWith({
      name: 'Welcome',
      triggerType: 'manual',
      triggerTagId: undefined,
      lineAccountId: 'acc-1',
    })
    expect(client.scenarios.addStep).toHaveBeenNthCalledWith(1, 's1', {
      stepOrder: 1,
      delayMinutes: 0,
      messageType: 'text',
      messageContent: 'hi',
    })
    expect(client.scenarios.addStep).toHaveBeenNthCalledWith(2, 's1', {
      stepOrder: 2,
      delayMinutes: 30,
      messageType: 'text',
      messageContent: 'again',
    })
    expect(client.scenarios.get).toHaveBeenCalledWith('s1')
    expect(JSON.parse(textOf(result)).success).toBe(true)
  })

  it('create_scenario requires triggerTagId for tag_added without SDK calls', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('create_scenario')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      name: 'Tagged',
      triggerType: 'tag_added',
      triggerTagId: undefined,
      steps: [],
      accountId: undefined,
    })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('triggerTagId is required')
    expect(client.scenarios.create).not.toHaveBeenCalled()
  })

  it('create_scenario rejects invalid delay format without SDK calls', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('create_scenario')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      name: 'Welcome',
      triggerType: 'manual',
      triggerTagId: undefined,
      steps: [{ delay: 'soon', type: 'text', content: 'hi' }],
      accountId: undefined,
    })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('Invalid delay format at step 1')
    expect(client.scenarios.create).not.toHaveBeenCalled()
  })

  it('create_scenario deletes the draft when a step fails', async () => {
    const client = fakeClient({
      scenarios: {
        create: vi.fn().mockResolvedValue({ id: 's9' }),
        addStep: vi.fn().mockRejectedValue(new Error('step boom')),
        delete: vi.fn().mockResolvedValue(undefined),
        get: vi.fn(),
      },
    })
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('create_scenario')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      name: 'Welcome',
      triggerType: 'manual',
      triggerTagId: undefined,
      steps: [{ delay: '0m', type: 'text', content: 'hi' }],
      accountId: undefined,
    })
    expect(client.scenarios.delete).toHaveBeenCalledWith('s9')
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('step boom')
  })

  it('enroll_in_scenario forwards (scenarioId, friendId) to SDK', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('enroll_in_scenario')!.handler as (args: unknown) => Promise<unknown>
    await handler({ scenarioId: 's1', friendId: 'f1' })
    expect(client.scenarios.enroll).toHaveBeenCalledWith('s1', 'f1')
  })
})

describe('rich menu (リッチメニュー)', () => {
  it('create_rich_menu parses areas and chains image upload + default', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('create_rich_menu')!.handler as (args: unknown) => Promise<unknown>
    const areas = [{ bounds: { x: 0, y: 0, width: 1, height: 1 }, action: { type: 'message', text: 'hi' } }]
    const result = await handler({
      name: 'Main',
      chatBarText: 'menu',
      size: { width: 2500, height: 1686 },
      selected: false,
      areas: JSON.stringify(areas),
      imageData: 'aGVsbG8=',
      imageContentType: 'image/png',
      setAsDefault: true,
    })
    expect(client.richMenus.create).toHaveBeenCalledWith({
      name: 'Main',
      chatBarText: 'menu',
      size: { width: 2500, height: 1686 },
      selected: false,
      areas,
    })
    expect(client.richMenus.uploadImage).toHaveBeenCalledWith('rm-1', 'aGVsbG8=', 'image/png')
    expect(client.richMenus.setDefault).toHaveBeenCalledWith('rm-1')
    expect(JSON.parse(textOf(result))).toEqual({
      success: true,
      richMenuId: 'rm-1',
      imageUploaded: true,
      isDefault: true,
    })
  })

  it('create_rich_menu maps SDK errors to isError', async () => {
    const client = fakeClient({
      richMenus: {
        create: vi.fn().mockRejectedValue(new LineHarnessError('HTTP 400', 400, 'POST /api/rich-menus')),
      },
    })
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('create_rich_menu')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      name: 'Main',
      chatBarText: 'menu',
      size: { width: 2500, height: 1686 },
      selected: false,
      areas: '[]',
      imageData: undefined,
      imageContentType: 'image/jpeg',
      setAsDefault: false,
    })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('HTTP 400')
  })
})

describe('manage_broadcasts (配信の管理操作)', () => {
  it('create_draft maps accountId to lineAccountId in the create body', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('manage_broadcasts')!.handler as (args: unknown) => Promise<unknown>
    await handler({
      action: 'create_draft',
      broadcastId: undefined,
      title: 'Draft',
      messageType: 'text',
      messageContent: 'hi',
      targetType: 'all',
      targetTagId: undefined,
      scheduledAt: undefined,
      segmentConditions: undefined,
      accountId: 'acc-3',
    })
    expect(client.broadcasts.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Draft', lineAccountId: 'acc-3' }),
    )
  })

  it('create_draft without required fields maps the validation error to isError', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('manage_broadcasts')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      action: 'create_draft',
      broadcastId: undefined,
      title: undefined,
      messageType: 'text',
      messageContent: 'hi',
      targetType: 'all',
      targetTagId: undefined,
      scheduledAt: undefined,
      segmentConditions: undefined,
      accountId: undefined,
    })
    expect(isError(result)).toBe(true)
    expect(textOf(result)).toContain('title, messageType, messageContent are required')
    expect(client.broadcasts.create).not.toHaveBeenCalled()
  })

  it('send_to_segment with invalid JSON maps the parse error to isError', async () => {
    const client = fakeClient()
    mockGetClient.mockReturnValue(client)
    const handler = handlers().get('manage_broadcasts')!.handler as (args: unknown) => Promise<unknown>
    const result = await handler({
      action: 'send_to_segment',
      broadcastId: 'b1',
      title: undefined,
      messageType: undefined,
      messageContent: undefined,
      targetType: undefined,
      targetTagId: undefined,
      scheduledAt: undefined,
      segmentConditions: '{oops',
      accountId: undefined,
    })
    expect(isError(result)).toBe(true)
    expect(client.broadcasts.sendToSegment).not.toHaveBeenCalled()
  })
})
