vi.mock('../services/line-messaging-identity.js', () => ({ verifyLineMessagingIdentity: vi.fn().mockResolvedValue(true) }));
import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono, type ErrorHandler } from 'hono';

// route の責務である入力正規化と引数の接続を確かめるため、実 D1 でなく DB 関数へ渡る値を観測する。
const dbMocks = {
  getLineAccounts: vi.fn(),
  getLineAccountScopeEntries: vi.fn(),
  getLineAccountsByIds: vi.fn(),
  getLineAccountListStats: vi.fn(),
  getLineAccountFoldersByAccountIds: vi.fn(async()=>({})),
  getLineAccountTag: vi.fn(),
  getLineAccountTagsByAccountIds: vi.fn(async () => ({})),
  getLineAccountById: vi.fn(),
  getLineAccountCredentialHealth: vi.fn(),
  createLineAccount: vi.fn(),
  listLineAccountTags: vi.fn(async () => [{id:'tag-own',tenant_id:'tenant-1'}]),
  updateLineAccount: vi.fn(),
  updateLineAccountFields: vi.fn(),
  updateLineAccountOrder: vi.fn(),
  deleteUncommittedLineAccount: vi.fn(),
  getLineAccountArchiveBlockers: vi.fn(),
  setDefaultLineAccount: vi.fn(),
  archiveLineAccount: vi.fn(),
  restoreLineAccount: vi.fn(),
  deactivateLineAccount: vi.fn(),
  activateLineAccount: vi.fn(),
  listSkippedDeliveries: vi.fn(),
  getLineAccountConnectionChecksByIdempotencyKey: vi.fn(),
  saveLineAccountConnectionChecks: vi.fn(),
  getAccountSetting: vi.fn(),
  setAccountSetting: vi.fn(),
  getStaffById: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
  CredentialEncryptionKeyError: class CredentialEncryptionKeyError extends Error {},
  LineAccountRevisionConflictError: class LineAccountRevisionConflictError extends Error {},
  LineAccountLifecycleError: class LineAccountLifecycleError extends Error {
    constructor(public readonly code: string) { super(code); this.name = 'LineAccountLifecycleError'; }
  },
  // 接続・鍵・停止の直前再確認。ここでは本体の検証を見たいので確認済みとして通す。
  consumeStepUpGrant: vi.fn(async () => true),
  getAdminSessionByTokenHash: vi.fn(async () => null),
  jstNow: vi.fn(() => '2026-08-10T12:00:00.000+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);

const styleMocks=vi.hoisted(()=>({initializeAccountStyle:vi.fn(async()=>({}))}));
vi.mock('../services/style-setup.js',()=>styleMocks);

const lineClientMocks = {
  getFollowersInsight: vi.fn(),
  getFollowerIds: vi.fn(),
};
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(function () { return lineClientMocks; }),
}));

// 差替済みの依存を使うよう、モック登録後に再読込する。
const { lineAccounts } = await import('./line-accounts.js');
const { unhandledWorkerError } = await import('../lib/unhandled-error.js');
const receiptErrorReport = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../services/codex-slack-relay.js', () => ({ reportHarnessErrorToSlack: receiptErrorReport }));

type TestEnv = {
  Variables: { staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff'; readOnly: boolean; assignedLineAccountId?: string | null; canAccessDescendantAccounts?: boolean; tenantId?: string | null } };
  Bindings: { DB: D1Database };
};

// 一意性の検証は既定で未検出とし、重複を試す場合だけ firstResult を変える。
function makeDbStub(firstResult: unknown = null): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(firstResult),
      })),
    })),
  } as unknown as D1Database;
}

function setupApp(
  role: 'owner' | 'admin' | 'staff' = 'owner',
  dbStub: D1Database = makeDbStub(),
  staffOverride: Partial<TestEnv['Variables']['staff']> = {},
) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'test-staff', name: 'Test', role, readOnly: false, ...staffOverride });
    c.env = { DB: dbStub };
    // 大事な操作の直前再確認。ここでは本体の検証を見たいので確認済みとして通す。
    c.req.raw.headers.set('x-step-up-token', 'test-step-up');
    await next();
  });
  app.route('/', lineAccounts);
  // 通知先が未設定でも応答を返せるため、最小の試験環境へ共通の失敗処理を接続する。
  app.onError(unhandledWorkerError as ErrorHandler);
  return app;
}

function installAutoConnectFetch(chatMode: 'chat' | 'bot') {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url.endsWith('/v2/oauth/accessToken')) {
      return Response.json({ access_token: 'issued-token', expires_in: 2_592_000, token_type: 'Bearer' });
    }
    if (url.endsWith('/v2/bot/info')) {
      return Response.json({ displayName: 'LINE公式名', pictureUrl: 'https://example.com/icon.png', basicId: '@line', chatMode });
    }
    if (url.endsWith('/v2/bot/channel/webhook/endpoint') && method === 'PUT') return Response.json({});
    if (url.endsWith('/v2/bot/channel/webhook/endpoint')) {
      return Response.json({ endpoint: 'http://localhost/webhook/123456789', active: true });
    }
    if (url.endsWith('/v2/bot/channel/webhook/test')) return Response.json({ success: true });
    if (url.endsWith('/liff/v1/apps') && method === 'GET') return Response.json({ apps: [] });
    if (url.endsWith('/liff/v1/apps') && method === 'POST') return Response.json({ liffId: '2007123456-auto' });
    if (url.includes('/liff/v1/apps/') && method === 'PUT') return Response.json({});
    return new Response(null, { status: 404 });
  }));
}

const autoConnectBody = {
  channelId: '123456789',
  channelSecret: 'messaging-secret',
  loginChannelId: '2007123456',
  loginChannelSecret: 'login-secret',
};

describe('POST /api/line-accounts/connect/check の残りの案内', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // #1928：登録系は統括（有効・全店範囲）のみ。案内の検証は統括で通す。
    dbMocks.getStaffById.mockResolvedValue({ is_active: 1, account_scope: 'all' });
    lineClientMocks.getFollowerIds.mockResolvedValue({ userIds: [] });
    lineClientMocks.getFollowersInsight.mockResolvedValue({ status: 'ready', followers: 3 });
  });

  test.each([
    ['chat', true],
    ['bot', false],
  ] as const)('LINE公式アカウントのチャットが %s のとき、受信を止めずに自動返信の重複だけを案内する', async (chatMode, expectNotice) => {
    installAutoConnectFetch(chatMode);
    const res = await setupApp('owner').request('/api/line-accounts/connect/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(autoConnectBody),
    });
    const body = await res.json() as { success: boolean; data: { remainingActions: string[] } };
    expect(body.success).toBe(true);
    // LINE はチャットと Webhook の併用をサポートしている。チャットを切らせない。
    if (expectNotice) {
      expect(body.data.remainingActions).toEqual([expect.stringContaining('メッセージの受信はそのまま動きます')]);
      expect(body.data.remainingActions[0]).toContain('「あいさつメッセージ」「応答メッセージ」はオフにしてください');
    } else {
      expect(body.data.remainingActions).toEqual([]);
    }
    expect(JSON.stringify(body.data.remainingActions)).not.toContain('チャットをオフにしてください');
  });
});
