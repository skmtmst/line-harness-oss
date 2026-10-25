import { d1BindingIdentity } from '../lib/d1-timing.js';
import { signedLiffState } from '../test-utils/liff-oauth.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 即時の歓迎文を共通サービスの once へ委ね、送信後に購読を進めて次の cron の二重送信を防ぐ。ここでは接続契約を検証し、実行権・間隔・通番はサービスの試験で守る。

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
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  jstNow: () => '2026-07-19 00:00:00',
};
vi.mock('@line-crm/db', () => dbMocks);

const pushImmediateFirstStep = vi.fn().mockResolvedValue(true);
vi.mock('../services/immediate-first-step.js', () => ({ pushImmediateFirstStep }));

const worker = (await import('../index.js')).default;

// 委譲の期待値に関係しない SQL は、何もしない prepared statement で依存を満たす。
const DB = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({ meta: { changes: 0 } }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
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
        return new Response(JSON.stringify({ sub: 'U-new-friend', name: 'Tester' }), {
          status: 200,
        });
      }
      if (url === 'https://api.line.me/v2/profile') {
        return new Response(
          JSON.stringify({ userId: 'U-new-friend', displayName: 'Tester' }),
          { status: 200 },
        );
      }
      // bot/info などは404を返し、完了ページへの代替経路を試す。
      return new Response('not found', { status: 404 });
    }),
  );
}

async function callback(state: Record<string, string>) {
  const signed = await signedLiffState(env.LINE_CHANNEL_SECRET, state);
  const encoded = signed.state;
  return worker.fetch(
    new Request(
      `https://worker.example.com/auth/callback?code=abc&state=${encodeURIComponent(encoded)}`,
      { headers: { Cookie: signed.cookie } },
    ),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

function requestDb(): D1Database {
  const db = dbMocks.enrollFriendInScenario.mock.calls[0]?.[0] as D1Database;
  expect(d1BindingIdentity(db)).toBe(DB);
  return db;
}

const FRIEND_ADD_SCENARIO = {
  id: 'scn-1',
  trigger_type: 'friend_add',
  is_active: 1,
  line_account_id: null,
  delivery_mode: 'relative',
};
const ENROLLMENT = { id: 'fs-1', current_step_order: -1 };

beforeEach(() => {
  vi.clearAllMocks();
  installFetchMock();
  pushImmediateFirstStep.mockResolvedValue(true);
  dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);
  dbMocks.createUser.mockResolvedValue({ id: 'U-uuid' });
  dbMocks.upsertFriend.mockResolvedValue({
    id: 'F-new',
    line_user_id: 'U-new-friend',
    line_account_id: null,
    user_id: null,
  });
  dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
  dbMocks.getLineAccountByChannelId.mockResolvedValue(null);
  dbMocks.getScenarios.mockResolvedValue([FRIEND_ADD_SCENARIO]);
  dbMocks.enrollFriendInScenario.mockResolvedValue(ENROLLMENT);
});

describe('GET /auth/callback — friend_add auto-enroll delegates to pushImmediateFirstStep', () => {
  it("enrolls and hands the fresh enrollment to the service ('once' mode contract)", async () => {
    await callback({ ref: '' });

    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(requestDb(), 'F-new', 'scn-1');
    expect(pushImmediateFirstStep).toHaveBeenCalledTimes(1);
    expect(pushImmediateFirstStep).toHaveBeenCalledWith(
      requestDb(),
      'F-new',
      'scn-1',
      {
        defaultAccessToken: 'env-token',
        workerUrl: 'https://worker.example.com',
        accountChannelId: null,
      },
      // once の既定で実行権と送信後の通番更新を守る。follow 前でも、検証済み ID トークンの sub なら宛先が確定している。
      { enrollment: ENROLLMENT, targetLineUserId: 'U-new-friend' },
    );
  });

  it('does NOT push when the friend is already enrolled (INSERT OR IGNORE returned null)', async () => {
    dbMocks.enrollFriendInScenario.mockResolvedValue(null);

    await callback({ ref: '' });

    expect(pushImmediateFirstStep).not.toHaveBeenCalled();
  });

  it('skips inactive and non-friend_add scenarios without enrolling', async () => {
    dbMocks.getScenarios.mockResolvedValue([
      { ...FRIEND_ADD_SCENARIO, id: 'scn-paused', is_active: 0 },
      { ...FRIEND_ADD_SCENARIO, id: 'scn-tag', trigger_type: 'tag_added' },
    ]);

    await callback({ ref: '' });

    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
    expect(pushImmediateFirstStep).not.toHaveBeenCalled();
  });

  it('honors entry_routes.run_account_friend_add_scenarios = 0 (referral override)', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({
      id: 'er-1',
      run_account_friend_add_scenarios: 0,
      tag_id: null,
      scenario_id: null,
      tracked_link_id: null,
    });

    await callback({ ref: 'r-override' });

    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
    expect(pushImmediateFirstStep).not.toHaveBeenCalled();
  });

  it('account-scoped: enrolls only matching-account scenarios and forwards accountChannelId', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue({
      id: 'acct-9',
      channel_access_token: 'tok-9',
    });
    dbMocks.getScenarios.mockResolvedValue([
      { ...FRIEND_ADD_SCENARIO, id: 'scn-mine', line_account_id: 'acct-9' },
      { ...FRIEND_ADD_SCENARIO, id: 'scn-other', line_account_id: 'acct-other' },
    ]);

    await callback({ ref: '', account: 'CH-9' });

    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledTimes(1);
    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(requestDb(), 'F-new', 'scn-mine');
    expect(pushImmediateFirstStep).toHaveBeenCalledTimes(1);
    expect(pushImmediateFirstStep).toHaveBeenCalledWith(
      requestDb(),
      'F-new',
      'scn-mine',
      expect.objectContaining({ accountChannelId: 'CH-9' }),
      { enrollment: ENROLLMENT, targetLineUserId: 'U-new-friend' },
    );
  });

  it('a failure on one scenario neither skips the remaining scenarios nor aborts the callback', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbMocks.getScenarios.mockResolvedValue([
      { ...FRIEND_ADD_SCENARIO, id: 'scn-a' },
      { ...FRIEND_ADD_SCENARIO, id: 'scn-b' },
    ]);
    pushImmediateFirstStep.mockRejectedValueOnce(new Error('LINE 500'));

    const res = await callback({ ref: '' });

    expect(res.status).toBe(200);
    // あるシナリオが失敗しても、残りの登録と配信を続ける。
    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledTimes(2);
    expect(pushImmediateFirstStep).toHaveBeenCalledTimes(2);
    expect(pushImmediateFirstStep).toHaveBeenLastCalledWith(
      requestDb(),
      'F-new',
      'scn-b',
      expect.anything(),
      { enrollment: ENROLLMENT, targetLineUserId: 'U-new-friend' },
    );
    errorSpy.mockRestore();
  });
});
