import { d1BindingIdentity } from '../lib/d1-timing.js';
import { signedLiffState } from '../test-utils/liff-oauth.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 完了済み購読は部分 UNIQUE だけでは防げないため、OAuth 再ログインで歓迎文を再送しないことを確かめる。follow なしで作られた友だちも、登録履歴がなければこの入口から登録できることを守る。

const dbMocks = {
  /*
   * 128 で「開始のきっかけ」を scenario_triggers に分けた。テストの仕掛けは
   * これまでどおり trigger_type で書いてあるので、本物のSQLと同じ意味
   * （kind='friend_add' かつ is_active=1）になるよう、ここで対応づける。
   */
  getFriendAddScenarioIds: vi.fn(async () => {
    const list = (await dbMocks.getScenarios()) as Array<{
      id: string;
      trigger_type?: string;
      is_active?: number;
    }>;
    return list
      .filter((s) => s.trigger_type === 'friend_add' && s.is_active)
      .map((s) => s.id);
  }),

  getLineAccounts: vi.fn().mockResolvedValue([
    { id: 'account-main', login_channel_id: '2000000000' },
  ]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // /auth/callback deps
  getFriendByLineUserIdForAccount: vi.fn(),
  upsertFriend: vi.fn(),
  createUser: vi.fn().mockResolvedValue({ id: 'U-uuid' }),
  getUserByEmailForAccess: vi.fn().mockResolvedValue(null),
  linkFriendToUser: vi.fn().mockResolvedValue(undefined),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue(null),
  recordRefTracking: vi.fn().mockResolvedValue(undefined),
  recordFriendAddAttributionCandidate: vi.fn().mockResolvedValue({ status: 'pending' }),
  getTrackedLinkById: vi.fn().mockResolvedValue(null),
  getMessageTemplateById: vi.fn().mockResolvedValue(null),
  getAffiliateLinkByRefCode: vi.fn().mockResolvedValue(null),
  getAffiliateOfferById: vi.fn().mockResolvedValue(null),
  getAffiliateById: vi.fn().mockResolvedValue(null),
  addTagToFriend: vi.fn().mockResolvedValue(undefined),
  getLineAccountByChannelId: vi.fn().mockResolvedValue(null),
  getLineAccountById: vi.fn().mockResolvedValue({ id: 'account-main', login_channel_id: '2000000000', tenant_id: null }),
  isLineAccountTenantActive: vi.fn().mockResolvedValue(true),
  getScenarios: vi.fn().mockResolvedValue([]),
  enrollFriendInScenario: vi.fn().mockResolvedValue(null),
  getScenarioSteps: vi.fn().mockResolvedValue([]),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  jstNow: () => '2026-07-19 00:00:00',
};
vi.mock('@line-crm/db', () => dbMocks);

const worker = (await import('../index.js')).default;

// friend_scenarios の履歴確認だけを priorEnrollment に対応させ、ほかの SQL は空の結果にして登録履歴の有無を試す。
let priorEnrollment: { id: string } | null = null;
const DB = {
  prepare: (sql: string) => ({
    bind: () => ({
      run: async () => ({ meta: { changes: 0 } }),
      first: async () => (sql.includes('FROM friend_scenarios') ? priorEnrollment : null),
      all: async () => ({ results: [] }),
    }),
    run: async () => ({ meta: { changes: 0 } }),
    first: async () => null,
    all: async () => ({ results: [] }),
  }),
} as unknown as D1Database;

const env = {
  DB,
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  WORKER_URL: 'https://worker.example.com',
  LINE_LOGIN_CHANNEL_ID: '2000000000',
  LINE_LOGIN_CHANNEL_SECRET: 'secret',
  LINE_CHANNEL_SECRET: 'test-oauth-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-token',
} as unknown as import('../index.js').Env['Bindings'];

function installFetchMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://api.line.me/oauth2/v2.1/token') {
        return new Response(
          JSON.stringify({ access_token: 'at', id_token: 'idt', token_type: 'Bearer' }),
          { status: 200 },
        );
      }
      if (url === 'https://api.line.me/oauth2/v2.1/verify') {
        return new Response(JSON.stringify({ sub: 'U-login', name: 'Tester' }), {
          status: 200,
        });
      }
      if (url === 'https://api.line.me/v2/profile') {
        return new Response(JSON.stringify({ userId: 'U-login', displayName: 'Tester' }), {
          status: 200,
        });
      }
      // bot/info などは404を返し、完了ページへの代替経路を試す。
      return new Response('not found', { status: 404 });
    }),
  );
}

async function callback() {
  const signed = await signedLiffState(env.LINE_CHANNEL_SECRET, {});
  const state = signed.state;
  return worker.fetch(
    new Request(
      `https://worker.example.com/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: signed.cookie } },
    ),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const friendAddScenario = {
  id: 'SC-1',
  trigger_type: 'friend_add',
  is_active: 1,
  line_account_id: null,
  delivery_mode: 'relative',
};

beforeEach(() => {
  vi.clearAllMocks();
  installFetchMock();
  priorEnrollment = null;
  dbMocks.createUser.mockResolvedValue({ id: 'U-uuid' });
  dbMocks.upsertFriend.mockResolvedValue({
    id: 'F-1',
    line_user_id: 'U-login',
    line_account_id: null,
    user_id: null,
  });
  dbMocks.getScenarios.mockResolvedValue([friendAddScenario]);
  dbMocks.enrollFriendInScenario.mockResolvedValue({ id: 'FS-1' });
  dbMocks.getScenarioSteps.mockResolvedValue([]);
});

describe('GET /auth/callback — friend_add scenario auto-enroll gating', () => {
  it('enrolls a brand-new friend in active friend_add scenarios', async () => {
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);

    await callback();

    const db = dbMocks.getFriendByLineUserIdForAccount.mock.calls[0]?.[0] as D1Database;
    expect(d1BindingIdentity(db)).toBe(DB);
    expect(dbMocks.getFriendByLineUserIdForAccount).toHaveBeenCalledWith(
      db,
      'U-login',
      'account-main',
    );
    expect(dbMocks.upsertFriend).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        lineUserId: 'U-login',
        lineAccountId: 'account-main',
      }),
    );
    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'SC-1',
    );
  });

  it('does NOT enroll an existing friend with a prior enrollment on OAuth re-login', async () => {
    // 完了済みの行は部分 UNIQUE に掛からないため、明示的な履歴確認で歓迎文の再登録を防ぐ。
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue({
      id: 'F-1',
      line_user_id: 'U-login',
      line_account_id: null,
      user_id: 'U-uuid',
    });
    priorEnrollment = { id: 'FS-done' };

    await callback();

    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
  });

  it('enrolls an existing friend with NO enrollment history (catch-up)', async () => {
    // follow を通らない友だちにも追加の機会を残すため、既存行でも登録履歴がなければ OAuth から登録する。
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue({
      id: 'F-1',
      line_user_id: 'U-login',
      line_account_id: null,
      user_id: 'U-uuid',
    });
    priorEnrollment = null;

    await callback();

    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'SC-1',
    );
  });
});
