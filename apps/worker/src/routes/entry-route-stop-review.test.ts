import { describe, it, expect, vi, beforeEach } from 'vitest';

// N-244 独立レビュー差し戻し: 同じPRで直す4点の直接テスト。
// 1. /auth/oauth と PC版 /auth/line の開始時にも停止判定し、停止前ページから
//    停止後に押した場合を拒否する (410)。active・不存在は従来どおり通す。
// 2. 停止ref由来では OAuth callback のアカウント共通シナリオを含め
//    タグ・シナリオを一切開始しない (非空シナリオで確かめる)。
// 3. /api/liff/send-form-link が停止refを再送せず、同名 tracked link へ
//    fallback しない (実行可能 fallback があっても)。不存在は維持する。
// 4. 停止判定のDB読取失敗は fail-open せず、安全に受付・帰属・シナリオを止める。
const dbMocks = {
  getLineAccounts: vi.fn().mockResolvedValue([
    { id: 'account-main', login_channel_id: '2000000000' },
  ]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
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
  setFriendFirstTrackedLinkIfNull: vi.fn().mockResolvedValue(undefined),
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

const pushImmediateFirstStep = vi.fn().mockResolvedValue(false);
vi.mock('../services/immediate-first-step.js', () => ({ pushImmediateFirstStep }));

const worker = (await import('../index.js')).default;

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

const pushBodies: Array<{ to: string; messages: Array<{ text?: string }> }> = [];

function installFetchMock() {
  pushBodies.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/v2/bot/message/push')) {
        pushBodies.push(JSON.parse((init?.body as string) ?? '{}'));
        return new Response('{}', { status: 200 });
      }
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

const ACTIVE = {
  id: 'route-active',
  ref_code: 'live1',
  tag_id: null,
  scenario_id: null,
  redirect_url: null,
  pool_id: null,
  is_active: 1,
  run_account_friend_add_scenarios: 1,
};

function call(path: string, init?: RequestInit) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, init),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

function oauthStart(ref: string) {
  return call(`/auth/oauth?ref=${encodeURIComponent(ref)}`);
}

function lineStart(ref: string, ua?: string) {
  return call(
    `/auth/line?ref=${encodeURIComponent(ref)}`,
    ua ? { headers: { 'User-Agent': ua } } : undefined,
  );
}

function callback(ref: string) {
  const state = btoa(JSON.stringify({ ref }));
  return call(`/auth/callback?code=abc&state=${encodeURIComponent(state)}`);
}

function sendFormLink(body: Record<string, unknown>) {
  return call('/api/liff/send-form-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function link(ref: string) {
  return call('/api/liff/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'tok', ref }),
  });
}

function intent(ref: string) {
  return call('/api/liff/friend-add-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer [REDACTED]' },
    body: JSON.stringify({ ref, source: 'liff' }),
  });
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
  dbMocks.getMessageTemplateById.mockResolvedValue(null);
  dbMocks.getAffiliateLinkByRefCode.mockResolvedValue(null);
  dbMocks.getAffiliateOfferById.mockResolvedValue(null);
  dbMocks.getScenarios.mockResolvedValue([]);
  dbMocks.getFriendAddScenarioIds.mockResolvedValue([]);
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

describe('開始時の停止判定 (N-244差戻)', () => {
  it('/auth/oauth の開始時に停止refを拒否する', async () => {
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(STOPPED);

    const res = await oauthStart('stopped1');
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain('利用できません');
    expect(html).not.toContain('stopped1');
  });

  it('PC版 /auth/line の開始時に停止refを拒否する', async () => {
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(STOPPED);

    const res = await lineStart('stopped1');
    expect(res.status).toBe(410);
    expect(await res.text()).toContain('利用できません');
  });

  it('モバイルの /auth/line でも停止refは /r へ回さず拒否する', async () => {
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(STOPPED);

    const res = await lineStart('stopped1', 'iPhone');
    expect(res.status).toBe(410);
  });

  it('active・不存在 ref の開始は従来どおり通す', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(ACTIVE);
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(ACTIVE);

    const activeRes = await oauthStart('live1');
    expect(activeRes.status).toBe(302);
    expect(activeRes.headers.get('location')).toContain('access.line.me');

    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(null);

    const unknownRes = await oauthStart('unknown-xyz');
    expect(unknownRes.status).toBe(302);
    expect(unknownRes.headers.get('location')).toContain('access.line.me');

    const lineRes = await lineStart('unknown-xyz');
    expect(lineRes.status).toBe(200);
  });
});

describe('停止ref由来のタグ・シナリオ抑止 (N-244差戻)', () => {
  it('OAuth callback は非空のアカウント共通シナリオも開始しない', async () => {
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(STOPPED);
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);
    dbMocks.getScenarios.mockResolvedValue([
      { id: 'sc-account', line_account_id: null },
    ]);
    dbMocks.getFriendAddScenarioIds.mockResolvedValue(['sc-account']);

    const res = await callback('stopped1');
    expect(res.status).toBe(200);

    expect(refCodeWrites).toHaveLength(0);
    expect(dbMocks.recordFriendAddAttributionCandidate).not.toHaveBeenCalled();
    expect(dbMocks.recordRefTracking).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
    expect(dbMocks.getScenarios).not.toHaveBeenCalled();
    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
    expect(pushImmediateFirstStep).not.toHaveBeenCalled();
  });

  it('active経路の callback はアカウント共通シナリオを維持する', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(ACTIVE);
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(ACTIVE);
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);
    dbMocks.getScenarios.mockResolvedValue([
      { id: 'sc-account', line_account_id: null },
    ]);
    dbMocks.getFriendAddScenarioIds.mockResolvedValue(['sc-account']);
    dbMocks.enrollFriendInScenario.mockResolvedValue({ id: 'E-1' });

    const res = await callback('live1');
    expect(res.status).toBe(200);

    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'sc-account',
    );
  });
});

describe('send-form-link の停止ref抑止 (N-244差戻)', () => {
  const formBody = (ref: string) => ({
    lineUserId: 'U-friend',
    formId: 'FORM-1',
    idToken: 'tok',
    ref,
  });

  it('停止refは再送せず同名 tracked link へ fallback しない', async () => {
    dbMocks.getEntryRouteByRefCodeAny.mockResolvedValue(STOPPED);
    // 実行可能な fallback (同名の有効 tracked link) があっても使わない。
    dbMocks.getTrackedLinkById.mockResolvedValue({
      id: 'TL-1',
      tag_id: 'TAG-tracked',
      scenario_id: null,
      is_active: 1,
      intro_template_id: null,
    });

    const res = await sendFormLink(formBody('stopped1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });

    expect(dbMocks.getTrackedLinkById).not.toHaveBeenCalled();
    expect(dbMocks.setFriendFirstTrackedLinkIfNull).not.toHaveBeenCalled();
    expect(pushBodies).toHaveLength(1);
    expect(JSON.stringify(pushBodies[0].messages[0])).not.toContain('ref=');
  });

  it('不存在refは tracked 解決の正規フローを維持する', async () => {
    dbMocks.getTrackedLinkById.mockResolvedValue({
      id: 'TL-1',
      tag_id: null,
      scenario_id: null,
      is_active: 1,
      intro_template_id: null,
    });

    const res = await sendFormLink(formBody('unknown-xyz'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });

    expect(dbMocks.getTrackedLinkById).toHaveBeenCalledWith(
      expect.anything(),
      'unknown-xyz',
    );
    expect(dbMocks.setFriendFirstTrackedLinkIfNull).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'TL-1',
    );
    expect(JSON.stringify(pushBodies[0].messages[0])).toContain('ref=unknown-xyz');
  });
});

describe('停止判定のDB読取失敗は fail-closed (N-244差戻)', () => {
  beforeEach(() => {
    dbMocks.getEntryRouteByRefCodeAny.mockRejectedValue(new Error('D1 down'));
  });

  it('開始時は受付を止める', async () => {
    expect((await oauthStart('live1')).status).toBe(410);
    expect((await lineStart('live1')).status).toBe(410);
    const intentRes = await intent('live1');
    expect(intentRes.status).toBe(410);
    expect(dbMocks.recordFriendAddAttributionCandidate).not.toHaveBeenCalled();
  });

  it('callback は帰属・シナリオを止める', async () => {
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);
    dbMocks.getScenarios.mockResolvedValue([
      { id: 'sc-account', line_account_id: null },
    ]);
    dbMocks.getFriendAddScenarioIds.mockResolvedValue(['sc-account']);

    const res = await callback('live1');
    expect(res.status).toBe(200);

    expect(refCodeWrites).toHaveLength(0);
    expect(dbMocks.recordFriendAddAttributionCandidate).not.toHaveBeenCalled();
    expect(dbMocks.recordRefTracking).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
  });

  it('LIFF連携は通すが記録・付与は止める', async () => {
    const res = await link('live1');
    expect(res.status).toBe(200);

    expect(refCodeWrites).toHaveLength(0);
    expect(dbMocks.recordFriendAddAttributionCandidate).not.toHaveBeenCalled();
    expect(dbMocks.recordRefTracking).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
  });

  it('send-form-link は ref なしの汎用文で送る', async () => {
    dbMocks.getTrackedLinkById.mockResolvedValue({
      id: 'TL-1',
      tag_id: 'TAG-tracked',
      scenario_id: null,
      is_active: 1,
      intro_template_id: null,
    });

    const res = await sendFormLink({
      lineUserId: 'U-friend',
      formId: 'FORM-1',
      idToken: 'tok',
      ref: 'live1',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });

    expect(dbMocks.getTrackedLinkById).not.toHaveBeenCalled();
    expect(dbMocks.setFriendFirstTrackedLinkIfNull).not.toHaveBeenCalled();
    expect(JSON.stringify(pushBodies[0].messages[0])).not.toContain('ref=');
  });
});
