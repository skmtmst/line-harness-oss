import { describe, it, expect, vi, beforeEach } from 'vitest';

// N-244 差し戻し: 停止した流入経路の ref は、停止前に入口表示→停止後に
// LIFF/OAuth連携完了の場合も、LIFF直送の場合も、friends.ref_code 保存・
// 候補・tracking・tracked/affiliate fallback・タグ/シナリオ開始をすべて止める。
// active entry route・tracked link・affiliate link・traffic pool は壊さない。
// 不存在 ref は共有 namespace の正規フローのため 200 維持 (承認済み)。
const dbMocks = {
  // eager module-load deps
  getLineAccounts: vi.fn().mockResolvedValue([
    { id: 'account-main', login_channel_id: '2000000000' },
  ]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // ref flows
  getFriendByLineUserIdForAccount: vi.fn(),
  upsertFriend: vi.fn(),
  createUser: vi.fn().mockResolvedValue({ id: 'U-uuid' }),
  getUserByEmail: vi.fn().mockResolvedValue(null),
  linkFriendToUser: vi.fn().mockResolvedValue(undefined),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue(null),
  getEntryRouteByRefCodeAny: vi.fn().mockResolvedValue(null),
  recordRefTracking: vi.fn().mockResolvedValue(undefined),
  recordFriendAddAttributionCandidate: vi.fn().mockResolvedValue({ status: 'pending' }),
  getTrackedLinkById: vi.fn().mockResolvedValue(null),
  getMessageTemplateById: vi.fn().mockResolvedValue(null),
  getAffiliateLinkByRefCode: vi.fn().mockResolvedValue(null),
  getAffiliateOfferById: vi.fn().mockResolvedValue(null),
  getAffiliateById: vi.fn().mockResolvedValue(null),
  addTagToFriend: vi.fn().mockResolvedValue(undefined),
  getLineAccountByChannelId: vi.fn().mockResolvedValue(null),
  getLineAccountById: vi.fn().mockResolvedValue(null),
  getScenarios: vi.fn().mockResolvedValue([]),
  getFriendAddScenarioIds: vi.fn().mockResolvedValue([]),
  enrollFriendInScenario: vi.fn().mockResolvedValue(null),
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  jstNow: () => '2026-09-08 00:00:00',
};
vi.mock('@line-crm/db', () => dbMocks);

const attachTagAndFireSideEffects = vi.fn().mockResolvedValue({ added: true });
vi.mock('../services/friend-tag-attach.js', () => ({ attachTagAndFireSideEffects }));

const notifyAffiliateFriendAdd = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateFriendAdd }));

const worker = (await import('../index.js')).default;

// friends.ref_code の生保存は素の SQL (UPDATE friends SET ref_code ...) で
// 行われるため、文面を記録して保存の有無を直接見る。
const refCodeWrites: string[] = [];
const DB = {
  prepare: (sql: string) => ({
    bind: (..._args: unknown[]) => ({
      run: async () => {
        if (sql.includes('SET ref_code')) refCodeWrites.push(sql);
        return { meta: { changes: 0 } };
      },
      first: async () => null,
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
        return new Response(JSON.stringify({ sub: 'U-friend', name: 'Tester' }), {
          status: 200,
        });
      }
      if (url === 'https://api.line.me/v2/profile') {
        return new Response(JSON.stringify({ userId: 'U-friend', displayName: 'Tester' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

const STOPPED = {
  id: 'route-stopped',
  ref_code: 'stopped1',
  tag_id: 'tag-x',
  scenario_id: 'sc-x',
  redirect_url: null,
  pool_id: null,
  is_active: 0,
};

function link(ref: string) {
  return worker.fetch(
    new Request('https://worker.example.com/api/liff/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'tok', ref }),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

function intent(ref: string) {
  return worker.fetch(
    new Request('https://worker.example.com/api/liff/friend-add-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ ref, source: 'liff' }),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

function callback(ref: string) {
  const state = btoa(JSON.stringify({ ref }));
  return worker.fetch(
    new Request(
      `https://worker.example.com/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
    ),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  refCodeWrites.length = 0;
  installFetchMock();
  dbMocks.getLineAccounts.mockResolvedValue([
    { id: 'account-main', login_channel_id: '2000000000' },
  ]);
  dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
  dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(null);
  dbMocks.getTrackedLinkById.mockResolvedValue(null);
  dbMocks.getAffiliateLinkByRefCode.mockResolvedValue(null);
  dbMocks.getAffiliateOfferById.mockResolvedValue(null);
  dbMocks.getScenarios.mockResolvedValue([]);
  dbMocks.getFriendAddScenarioIds.mockResolvedValue([]);
  // 連携済みの友だち (LIFF直送の主経路)。新規連携は別ケースで上書きする。
  dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue({
    id: 'F-1',
    line_account_id: 'account-main',
    line_user_id: 'U-friend',
    user_id: 'U-uuid',
  });
  dbMocks.upsertFriend.mockResolvedValue({
    id: 'F-1',
    line_user_id: 'U-friend',
    line_account_id: 'account-main',
    user_id: null,
  });
});

describe('停止 entry route ref の LIFF/OAuth 後段抑止 (N-244)', () => {
  it('LIFF直送の停止 ref は保存・候補・計測・fallback・付与をすべて止める', async () => {
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(STOPPED);
    // 同じ ref が他 namespace に重なっても落とさないことを見る仕掛け。
    dbMocks.getTrackedLinkById.mockResolvedValue({
      id: 'TL-1',
      tag_id: 'TAG-tracked',
      scenario_id: null,
      is_active: 1,
    });
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-1',
      ref_code: 'stopped1',
      offer_id: 'OFF-1',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-1',
      tag_id: 'TAG-offer',
      scenario_id: null,
      is_active: 1,
    });

    const res = await link('stopped1');
    expect(res.status).toBe(200);

    expect(refCodeWrites).toHaveLength(0);
    expect(dbMocks.recordFriendAddAttributionCandidate).not.toHaveBeenCalled();
    expect(dbMocks.recordRefTracking).not.toHaveBeenCalled();
    expect(dbMocks.getTrackedLinkById).not.toHaveBeenCalled();
    expect(dbMocks.getAffiliateLinkByRefCode).not.toHaveBeenCalled();
    expect(dbMocks.getAffiliateOfferById).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
    expect(notifyAffiliateFriendAdd).not.toHaveBeenCalled();
  });

  it('停止 ref の新規連携でも保存・計測・付与を止める', async () => {
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(STOPPED);
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue({
      id: 'F-1',
      line_account_id: 'account-main',
      line_user_id: 'U-friend',
      user_id: null,
    });

    const res = await link('stopped1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { alreadyLinked: false },
    });

    expect(refCodeWrites).toHaveLength(0);
    expect(dbMocks.recordFriendAddAttributionCandidate).not.toHaveBeenCalled();
    expect(dbMocks.recordRefTracking).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
  });

  it('停止前に入口表示→停止後に OAuth 完了でも保存・計測・付与を止める', async () => {
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(STOPPED);
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);
    dbMocks.getTrackedLinkById.mockResolvedValue({
      id: 'TL-1',
      tag_id: 'TAG-tracked',
      scenario_id: null,
      is_active: 1,
    });

    const res = await callback('stopped1');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('登録完了');

    expect(refCodeWrites).toHaveLength(0);
    expect(dbMocks.recordFriendAddAttributionCandidate).not.toHaveBeenCalled();
    expect(dbMocks.recordRefTracking).not.toHaveBeenCalled();
    expect(dbMocks.getTrackedLinkById).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
  });

  it('friend-add-intent の停止 ref 直送は 410 で候補を残さない', async () => {
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(STOPPED);

    const res = await intent('stopped1');
    expect(res.status).toBe(410);
    expect(dbMocks.recordFriendAddAttributionCandidate).not.toHaveBeenCalled();
  });

  it('active entry route は通常の保存・計測・付与を行う', async () => {
    const active = {
      id: 'route-active',
      ref_code: 'live1',
      tag_id: 'TAG-route',
      scenario_id: null,
      redirect_url: null,
      pool_id: null,
      is_active: 1,
    };
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(active);
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(active);

    const res = await link('live1');
    expect(res.status).toBe(200);

    expect(refCodeWrites).toHaveLength(1);
    expect(dbMocks.recordFriendAddAttributionCandidate).toHaveBeenCalled();
    expect(dbMocks.recordRefTracking).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ refCode: 'live1', entryRouteId: 'route-active' }),
    );
    expect(attachTagAndFireSideEffects).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'TAG-route',
      expect.anything(),
    );
  });

  it('不存在 ref は tracked fallback の正規フローのまま 200 で付与する', async () => {
    dbMocks.getTrackedLinkById.mockResolvedValue({
      id: 'TL-1',
      tag_id: 'TAG-tracked',
      scenario_id: null,
      is_active: 1,
    });

    const res = await link('unknown-xyz');
    expect(res.status).toBe(200);

    expect(dbMocks.recordRefTracking).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ refCode: 'unknown-xyz', entryRouteId: null }),
    );
    expect(attachTagAndFireSideEffects).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'TAG-tracked',
      expect.anything(),
    );
  });

  it('affiliate link の付与フローは保つ', async () => {
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-1',
      ref_code: 'aff-offer',
      offer_id: 'OFF-1',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-1',
      tag_id: 'TAG-offer',
      scenario_id: null,
      is_active: 1,
    });

    const res = await link('aff-offer');
    expect(res.status).toBe(200);
    expect(attachTagAndFireSideEffects).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'TAG-offer',
      expect.anything(),
    );
  });

  it('friend-add-intent の不存在 ref は従来どおり 200 で記録する', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);

    const res = await intent('unknown-xyz');
    expect(res.status).toBe(200);
    expect(dbMocks.recordFriendAddAttributionCandidate).toHaveBeenCalled();
  });
});
