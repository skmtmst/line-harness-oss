import { describe, it, expect, vi, beforeEach } from 'vitest';

// 既存友だちの LIFF 入口で、経路・計測リンク・案件の優先順をタグ付与の結果から確かめる。重いシナリオ配信は別の試験へ分け、ここでは DB を差し替える。
const dbMocks = {

  getLineAccounts: vi.fn().mockResolvedValue([
    { id: 'account-main', login_channel_id: '2000000000' },
  ]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // /api/liff/link + applyRefAttribution helpers
  getFriendByLineUserId: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue(null),
  getTrackedLinkById: vi.fn().mockResolvedValue(null),
  getAffiliateLinkByRefCode: vi.fn().mockResolvedValue(null),
  getAffiliateOfferById: vi.fn().mockResolvedValue(null),
  getAffiliateById: vi.fn().mockResolvedValue(null),
  addTagToFriend: vi.fn().mockResolvedValue(undefined),
  recordRefTracking: vi.fn().mockResolvedValue(undefined),
  recordFriendAddAttributionCandidate: vi.fn().mockResolvedValue({ status: 'pending' }),
  getLineAccountByChannelId: vi.fn().mockResolvedValue(null),
  getLineAccountById: vi.fn().mockResolvedValue(null),
  isLineAccountTenantActive: vi.fn().mockResolvedValue(true),
};
vi.mock('@line-crm/db', () => dbMocks);

// 既存友だちの再訪で参加者へ通知しないことを確かめるため、通知だけを差し替える。
const notifyAffiliateFriendAdd = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateFriendAdd }));

// 新規付与時だけ副作用が動く共通関数へ接続されることを確かめる。
const attachTagAndFireSideEffects = vi.fn().mockResolvedValue({ added: true });
vi.mock('../features/friends/friend-tag-attach.js', () => ({ attachTagAndFireSideEffects }));

// 差替済みのヘルパを入口へ接続するため、モック登録後に読み込む。
const worker = (await import('../index.js')).default;

// DB ヘルパと単純な UPDATE だけを使うため、prepared statement の空の実装で依存を満たす。
const DB = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({}),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  }),
} as unknown as D1Database;

const LOGIN_CHANNEL_ID = '2000000000';

const env = {
  DB,
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  WORKER_URL: 'https://worker.example.com',
  LINE_LOGIN_CHANNEL_ID: LOGIN_CHANNEL_ID,
} as unknown as import('../index.js').Env['Bindings'];

// 検証応答では、空でない ID トークンを固定の LINE 利用者へ対応させる。
function installVerifyMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://api.line.me/oauth2/v2.1/verify') {
        return new Response(JSON.stringify({ sub: 'U-friend', name: 'Tester' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

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

describe('POST /api/liff/link — offer tag/scenario on affiliate-link friend add', () => {
  beforeEach(() => {
  dbMocks.getFriendByLineUserIdForAccount.mockImplementation(
    (...args: unknown[]) => dbMocks.getFriendByLineUserId(...(args as [unknown, unknown])),
  );
    vi.clearAllMocks();
    installVerifyMock();
    // 本人作成を分離して帰属を試すため、user_id を持つ連携済み友だちを使う。
    dbMocks.getFriendByLineUserId.mockResolvedValue({
      id: 'F-1',
      line_account_id: null,
      user_id: 'U-uuid',
    });
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getTrackedLinkById.mockResolvedValue(null);
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue(null);
    dbMocks.getAffiliateOfferById.mockResolvedValue(null);
  });

  it('applies the offer tag when the ref is an offer-scoped affiliate link', async () => {
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

    expect(dbMocks.getAffiliateOfferById).toHaveBeenCalledWith(
      expect.anything(),
      'OFF-1',
    );
    expect(attachTagAndFireSideEffects).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'TAG-offer',
      expect.anything(),
    );
  });

  it('applies nothing for a generic affiliate link (offer_id NULL)', async () => {
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-2',
      ref_code: 'aff-generic',
      offer_id: null,
    });

    const res = await link('aff-generic');
    expect(res.status).toBe(200);

    // 案件を参照しない場合、タグも適用しない。
    expect(dbMocks.getAffiliateOfferById).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
  });

  it('skips tag application when the offer is inactive (is_active = 0)', async () => {
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-3',
      ref_code: 'aff-paused',
      offer_id: 'OFF-2',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-2',
      tag_id: 'TAG-paused',
      scenario_id: null,
      is_active: 0,
    });

    const res = await link('aff-paused');
    expect(res.status).toBe(200);

    // 無効な案件は存在しない扱いにし、タグを付けない。
    expect(dbMocks.getAffiliateOfferById).toHaveBeenCalledWith(
      expect.anything(),
      'OFF-2',
    );
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
  });

  it('does NOT fire the friend-add notification on an existing-friend re-touch', async () => {
    // LIFF の再訪では新規追加ではないため、案件リンクでも参加者へ通知しない。
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-1',
      affiliate_id: 'AFF-1',
      ref_code: 'aff-offer',
      offer_id: 'OFF-1',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-1',
      name: '案件A',
      tag_id: null,
      scenario_id: null,
      is_active: 1,
    });
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'AFF-1', friend_id: 'F-other' });

    const res = await link('aff-offer');
    expect(res.status).toBe(200);
    expect(notifyAffiliateFriendAdd).not.toHaveBeenCalled();
  });

  it('keeps entry_route behavior: offer is never consulted on an entry_route hit', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({
      id: 'ER-1',
      tag_id: 'TAG-route',
      scenario_id: null,
      run_account_friend_add_scenarios: 1,
    });

    const res = await link('route-ref');
    expect(res.status).toBe(200);

    // 流入経路があれば優先し、アフィリエイトと案件の解決は省く。
    expect(dbMocks.getAffiliateLinkByRefCode).not.toHaveBeenCalled();
    expect(dbMocks.getAffiliateOfferById).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'TAG-route',
      expect.anything(),
    );
  });
});
