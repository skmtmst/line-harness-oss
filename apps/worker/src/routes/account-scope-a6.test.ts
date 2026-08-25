import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  canAccess: vi.fn(),
  getChatById: vi.fn(),
  getFriendById: vi.fn(),
  createChat: vi.fn(),
  getAutomationById: vi.fn(),
  createAutomation: vi.fn(),
  getAutomationLogs: vi.fn(),
  getAutoReplyById: vi.fn(),
  createAutoReply: vi.fn(),
  getAutoReplyHitCounts: vi.fn(),
  getAffiliateOfferById: vi.fn(),
  createAffiliateOffer: vi.fn(),
}));

vi.mock('../services/account-access.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/account-access.js')>(),
  canAccessAllLineAccounts: mocks.canAccess,
}));
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@line-crm/db')>(),
  getChatById: mocks.getChatById,
  getFriendById: mocks.getFriendById,
  createChat: mocks.createChat,
  getAutomationById: mocks.getAutomationById,
  createAutomation: mocks.createAutomation,
  getAutomationLogs: mocks.getAutomationLogs,
  getAutoReplyById: mocks.getAutoReplyById,
  createAutoReply: mocks.createAutoReply,
  getAutoReplyHitCounts: mocks.getAutoReplyHitCounts,
  getAffiliateOfferById: mocks.getAffiliateOfferById,
  createAffiliateOffer: mocks.createAffiliateOffer,
}));

const [{ chats }, { automations }, { autoReplies }, { affiliateOffers }] = await Promise.all([
  import('./chats.js'),
  import('./automations.js'),
  import('./auto-replies.js'),
  import('./affiliate-offers.js'),
]);

function app(route: Hono<any>) {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    const statement = {
      bind: () => statement,
      first: vi.fn(async () => null),
      run: vi.fn(async () => ({})),
      all: vi.fn(async () => ({ results: [] })),
    };
    c.env = { DB: { prepare: () => statement } as unknown as D1Database };
    c.set('staff' as never, { id: 'owner', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', route);
  return instance;
}

function request(method: string, body?: unknown) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

const automation = {
  id: 'automation', name: 'test', description: null, event_type: 'message', conditions: '{}',
  actions: '[]', is_active: 1, priority: 0, line_account_id: 'own', created_at: '', updated_at: '',
};
const autoReply = {
  id: 'auto-reply', keyword: 'test', match_type: 'exact', response_type: 'text',
  response_content: 'reply', template_id: null, line_account_id: 'own', is_active: 1,
  active_from: null, active_until: null, cooldown_minutes: null, skip_when_operator_active: 0,
  priority: 0, message_kinds_json: null, name: null, respond_to_all: 0,
  keyword_match_mode: 'any', folder_id: null, created_at: '', updated_at: '',
};
const offer = {
  id: 'offer', name: 'test', description: null, reward_amount: 0, reward_miles: 0,
  mileage_program_id: 'default', line_account_id: 'own', tag_id: null, scenario_id: null,
  is_active: 1, created_at: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAccess.mockResolvedValue(true);
  mocks.getChatById.mockResolvedValue({ id: 'chat', friend_id: 'friend', line_account_id: 'own' });
  mocks.getFriendById.mockResolvedValue({ id: 'friend', line_account_id: 'own' });
  mocks.createChat.mockResolvedValue({ id: 'chat', friend_id: 'friend', status: 'open' });
  mocks.getAutomationById.mockResolvedValue(automation);
  mocks.createAutomation.mockResolvedValue(automation);
  mocks.getAutomationLogs.mockResolvedValue([]);
  mocks.getAutoReplyById.mockResolvedValue(autoReply);
  mocks.createAutoReply.mockResolvedValue(autoReply);
  mocks.getAutoReplyHitCounts.mockResolvedValue([]);
  mocks.getAffiliateOfferById.mockResolvedValue(offer);
  mocks.createAffiliateOffer.mockResolvedValue(offer);
});

describe('A-6 account tenant scope', () => {
  test.each([
    ['chat', chats, '/api/chats/chat'],
    ['automation', automations, '/api/automations/automation'],
    ['auto-reply', autoReplies, '/api/auto-replies/auto-reply'],
    ['affiliate offer', affiliateOffers, '/api/affiliate-offers/offer'],
  ] as const)('%s :id route hides another tenant record', async (_name, route, path) => {
    mocks.canAccess.mockResolvedValue(false);
    expect((await app(route).request(path)).status).toBe(404);
  });

  test.each([
    ['chat', chats, '/api/chats', { friendId: 'friend', lineAccountId: 'other' }, mocks.createChat],
    ['automation', automations, '/api/automations', { name: 'test', eventType: 'message', actions: [], lineAccountId: 'other' }, mocks.createAutomation],
    ['auto-reply', autoReplies, '/api/auto-replies', { keyword: 'test', responseContent: 'reply', lineAccountId: 'other' }, mocks.createAutoReply],
    ['affiliate offer', affiliateOffers, '/api/affiliate-offers', { name: 'test', lineAccountId: 'other' }, mocks.createAffiliateOffer],
  ] as const)('%s body rejects another tenant account', async (_name, route, path, body, create) => {
    mocks.canAccess.mockResolvedValue(false);
    expect((await app(route).request(path, request('POST', body))).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    ['chat', chats, '/api/chats/chat'],
    ['automation', automations, '/api/automations/automation'],
    ['auto-reply', autoReplies, '/api/auto-replies/auto-reply'],
    ['affiliate offer', affiliateOffers, '/api/affiliate-offers/offer'],
  ] as const)('%s own-tenant record remains available', async (_name, route, path) => {
    expect((await app(route).request(path)).status).toBe(200);
  });

  test.each([
    ['chat stats', '/api/chats/stats', 'GET'],
    ['mark all chats read', '/api/chats/read-all', 'POST'],
  ] as const)('%s fixed route is not treated as a chat id', async (_name, path, method) => {
    const response = await app(chats).request(path, request(method));
    expect(response.status).not.toBe(404);
    expect(mocks.getChatById).not.toHaveBeenCalled();
  });

  test('auto-reply update permits null to clear scope but rejects an empty account id', async () => {
    expect((await app(autoReplies).request(
      '/api/auto-replies/auto-reply',
      request('PUT', { lineAccountId: null }),
    )).status).not.toBe(403);

    expect((await app(autoReplies).request(
      '/api/auto-replies/auto-reply',
      request('PUT', { lineAccountId: '' }),
    )).status).toBe(403);
  });
});
