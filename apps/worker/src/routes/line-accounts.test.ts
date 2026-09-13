import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// Mock @line-crm/db so we can assert on the values the route forwards to the
// DB layer without needing a real D1Database. The route's responsibility is
// "normalize body → call DB function with correct args", so capturing those
// args is the meaningful assertion.
const dbMocks = {
  getLineAccounts: vi.fn(),
  getLineAccountScopeEntries: vi.fn(),
  getLineAccountsByIds: vi.fn(),
  getLineAccountListStats: vi.fn(),
  getLineAccountById: vi.fn(),
  getLineAccountCredentialHealth: vi.fn(),
  createLineAccount: vi.fn(),
  updateLineAccount: vi.fn(),
  updateLineAccountFields: vi.fn(),
  updateLineAccountOrder: vi.fn(),
  deleteUncommittedLineAccount: vi.fn(),
  getLineAccountArchiveBlockers: vi.fn(),
  setDefaultLineAccount: vi.fn(),
  archiveLineAccount: vi.fn(),
  restoreLineAccount: vi.fn(),
  getLineAccountConnectionChecksByIdempotencyKey: vi.fn(),
  saveLineAccountConnectionChecks: vi.fn(),
  getAccountSetting: vi.fn(),
  setAccountSetting: vi.fn(),
  getStaffById: vi.fn(),
  getStaffAccountScopeIds: vi.fn(),
  CredentialEncryptionKeyError: class CredentialEncryptionKeyError extends Error {},
  LineAccountRevisionConflictError: class LineAccountRevisionConflictError extends Error {},
  jstNow: vi.fn(() => '2026-08-10T12:00:00.000+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);

const lineClientMocks = {
  getFollowersInsight: vi.fn(),
  getFollowerIds: vi.fn(),
};
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => lineClientMocks),
}));

// Re-import after mock so the module picks up mocked deps.
const { lineAccounts } = await import('./line-accounts.js');

type TestEnv = {
  Variables: { staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff'; readOnly: boolean; assignedLineAccountId?: string | null; canAccessDescendantAccounts?: boolean; tenantId?: string | null } };
  Bindings: { DB: D1Database };
};

// Minimal D1 stub: every prepare/bind/first chain resolves to `null` (no row).
// Used for the uniqueness check in checkUniqueLoginAndLiff — tests that need
// to assert duplicate-rejection override `firstResult` per request.
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
    await next();
  });
  app.route('/', lineAccounts);
  return app;
}

const fakeAccount = {
  id: 'acc-1',
  channel_id: '123456789',
  name: 'メイン',
  channel_access_token: 'token',
  channel_secret: 'secret',
  channel_access_token_updated_at: null,
  channel_secret_updated_at: null,
  login_channel_secret_updated_at: null,
  login_channel_id: null,
  login_channel_secret: null,
  liff_id: null,
  is_active: 1,
  is_default: 0,
  archived_at: null,
  archived_by: null,
  archived_reason: null,
  country: null,
  role: null,
  timezone: 'Asia/Tokyo',
  revision: 1,
  official_profile_url: null,
  display_order: 0,
  token_expires_at: null,
  created_at: '2026-05-08T00:00:00.000',
  updated_at: '2026-05-08T00:00:00.000',
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) {
    if ('mockReset' in fn) fn.mockReset();
  }
  lineClientMocks.getFollowersInsight.mockReset();
  lineClientMocks.getFollowerIds.mockReset();
  dbMocks.getAccountSetting.mockResolvedValue(null);
  dbMocks.getStaffById.mockResolvedValue({ account_scope: 'all' });
  dbMocks.getStaffAccountScopeIds.mockResolvedValue([]);
  dbMocks.getLineAccounts.mockResolvedValue([{ ...fakeAccount, parent_line_account_id: null }]);
  dbMocks.getLineAccountScopeEntries.mockImplementation(async () =>
    dbMocks.getLineAccounts());
  dbMocks.getLineAccountsByIds.mockImplementation(async (_db, ids: string[]) => {
    const rows = await dbMocks.getLineAccounts();
    return rows.filter((row: { id: string }) => ids.includes(row.id));
  });
  dbMocks.getLineAccountListStats.mockResolvedValue({
    'acc-1': { friendCount: 12, activeScenarios: 3, messagesThisMonth: 8 },
  });
  dbMocks.getLineAccountCredentialHealth.mockResolvedValue(null);
  dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);
  dbMocks.getLineAccountArchiveBlockers.mockResolvedValue([]);
  dbMocks.setDefaultLineAccount.mockResolvedValue({ ...fakeAccount, is_default: 1 });
  dbMocks.archiveLineAccount.mockResolvedValue({
    ...fakeAccount,
    is_active: 0,
    archived_at: '2026-08-10T12:00:00.000+09:00',
    archived_by: 'test-staff',
    archived_reason: '利用終了',
  });
  dbMocks.restoreLineAccount.mockResolvedValue({ ...fakeAccount, is_active: 0 });
  dbMocks.getLineAccountConnectionChecksByIdempotencyKey.mockResolvedValue([]);
  dbMocks.saveLineAccountConnectionChecks.mockImplementation(async (_db, input) =>
    input.checks.map((check: Record<string, unknown>, index: number) => ({
      id: `check-${index}`,
      line_account_id: input.lineAccountId,
      check_kind: check.kind,
      result: check.result,
      expected_url: check.expectedUrl ?? null,
      registered_url: check.registeredUrl ?? null,
      webhook_active: check.webhookActive == null ? null : (check.webhookActive ? 1 : 0),
      http_status: check.httpStatus ?? null,
      checked_by: input.checkedBy,
      checked_at: input.checkedAt,
      correlation_id: input.correlationId,
      idempotency_key: input.idempotencyKey,
      account_revision: input.expectedRevision + 1,
    })),
  );
  dbMocks.setAccountSetting.mockResolvedValue(undefined);
  dbMocks.jstNow.mockReturnValue('2026-08-10T12:00:00.000+09:00');
  lineClientMocks.getFollowerIds.mockResolvedValue({ userIds: [] });
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/v2/bot/info')) return Response.json({ displayName: 'テスト' });
    if (url.endsWith('/v2/bot/channel/webhook/endpoint')) {
      return Response.json({ endpoint: 'http://localhost/webhook', active: true });
    }
    if (url.endsWith('/v2/bot/channel/webhook/test')) return Response.json({ success: true });
    if (url.endsWith('/v2/bot/message/quota')) return Response.json({ type: 'limited', value: 200 });
    return new Response(null, { status: 404 });
  }));
});

describe('LINE account default and archive lifecycle', () => {
  test('owner switches the one organization default', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ ...fakeAccount, tenant_id: 'tenant-a' });
    dbMocks.getLineAccounts.mockResolvedValue([
      { ...fakeAccount, tenant_id: 'tenant-a', parent_line_account_id: null },
    ]);
    const res = await setupApp('owner', makeDbStub(), { tenantId: 'tenant-a' }).request(
      '/api/line-accounts/default',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'acc-1' }),
      },
    );

    expect(res.status).toBe(200);
    expect(dbMocks.setDefaultLineAccount).toHaveBeenCalledWith(expect.anything(), 'acc-1', 'tenant-a');
    await expect(res.json()).resolves.toMatchObject({ data: { isDefault: true } });
  });

  test('archive returns every prerequisite blocker without changing the account', async () => {
    dbMocks.getLineAccountArchiveBlockers.mockResolvedValue([
      'account_active',
      'default_account',
      'delivery_job_running',
      'traffic_pool_member',
    ]);

    const res = await setupApp('owner').request('/api/line-accounts/acc-1/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '利用終了' }),
    });

    expect(res.status).toBe(409);
    expect(dbMocks.archiveLineAccount).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'LINE_ACCOUNT_ARCHIVE_BLOCKED',
      details: { blockers: ['account_active', 'default_account', 'delivery_job_running', 'traffic_pool_member'] },
    });
  });

  test('archive records actor and reason, while DELETE uses the same archive path', async () => {
    const app = setupApp('owner');
    const archive = await app.request('/api/line-accounts/acc-1/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '利用終了' }),
    });
    expect(archive.status).toBe(200);
    expect(dbMocks.archiveLineAccount).toHaveBeenLastCalledWith(
      expect.anything(), 'acc-1', 'test-staff', '利用終了',
    );

    const legacyDelete = await app.request('/api/line-accounts/acc-1', { method: 'DELETE' });
    expect(legacyDelete.status).toBe(200);
    expect(dbMocks.archiveLineAccount).toHaveBeenLastCalledWith(
      expect.anything(), 'acc-1', 'test-staff', '旧DELETE APIからのアーカイブ',
    );
    expect(dbMocks.deleteUncommittedLineAccount).not.toHaveBeenCalled();
  });

  test('archived accounts remain readable but reject writes with ACCOUNT_ARCHIVED', async () => {
    const archivedAccount = {
      ...fakeAccount,
      is_active: 0,
      archived_at: '2026-08-10T12:00:00.000+09:00',
    };
    dbMocks.getLineAccountById.mockResolvedValue(archivedAccount);
    dbMocks.getLineAccounts.mockResolvedValue([
      { ...archivedAccount, parent_line_account_id: null },
    ]);
    const app = setupApp('owner');

    expect((await app.request('/api/line-accounts/acc-1')).status).toBe(200);
    const write = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '変更不可' }),
    });
    expect(write.status).toBe(409);
    await expect(write.json()).resolves.toEqual({ success: false, error: 'ACCOUNT_ARCHIVED' });
  });

  test('owner restores an archived account in the stopped state', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      is_active: 0,
      archived_at: '2026-08-10T12:00:00.000+09:00',
    });
    const res = await setupApp('owner').request('/api/line-accounts/acc-1/restore', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(dbMocks.restoreLineAccount).toHaveBeenCalledWith(expect.anything(), 'acc-1');
    await expect(res.json()).resolves.toMatchObject({ data: { isActive: false, archivedAt: null } });
  });
});

describe('GET /api/line-accounts/:id/credential-health', () => {
  const health = {
    channel_access_token: {
      encrypted: true,
      decryptable: false,
      source: 'plaintext' as const,
    },
    channel_secret: {
      encrypted: true,
      decryptable: true,
      source: 'encrypted' as const,
    },
  };

  test('returns only credential status for an account in the owner scope', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);
    dbMocks.getLineAccountCredentialHealth.mockResolvedValue(health);
    const app = setupApp('owner');

    const res = await app.request('/api/line-accounts/acc-1/credential-health');

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: typeof health };
    expect(body).toEqual({ success: true, data: health });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('actual-access-value-must-not-return');
    expect(serialized).not.toContain('actual-secret-value-must-not-return');
    expect(Object.keys(body.data.channel_access_token).sort()).toEqual([
      'decryptable',
      'encrypted',
      'source',
    ]);
  });

  test('returns the same not-found response for an account outside the owner scope', async () => {
    const otherAccount = {
      ...fakeAccount,
      id: 'acc-other',
      tenant_id: 'other-organization',
      parent_line_account_id: null,
    };
    dbMocks.getLineAccountById.mockResolvedValue(otherAccount);
    dbMocks.getLineAccounts.mockResolvedValue([
      { ...fakeAccount, parent_line_account_id: null },
      otherAccount,
    ]);
    dbMocks.getLineAccountCredentialHealth.mockResolvedValue(health);
    const app = setupApp('owner', makeDbStub(), {
      assignedLineAccountId: 'acc-1',
      canAccessDescendantAccounts: true,
    });

    const res = await app.request('/api/line-accounts/acc-other/credential-health');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      error: 'LINE account not found',
    });
    expect(dbMocks.getLineAccountCredentialHealth).not.toHaveBeenCalled();
    expect(dbMocks.getLineAccountById).not.toHaveBeenCalled();
  });

  test.each(['admin', 'staff'] as const)('rejects %s with 403', async (role) => {
    dbMocks.getLineAccountCredentialHealth.mockResolvedValue(health);
    const app = setupApp(role);

    const res = await app.request('/api/line-accounts/acc-1/credential-health');

    expect(res.status).toBe(403);
    expect(dbMocks.getLineAccountCredentialHealth).not.toHaveBeenCalled();
  });
});

describe('GET /api/line-accounts/:id/follower-insight', () => {
  test('returns LINE follower insight without exposing account token', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);
    lineClientMocks.getFollowersInsight.mockResolvedValue({
      status: 'ready',
      followers: 123,
      targetedReaches: 111,
      blocks: 4,
    });

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts/acc-1/follower-insight?date=20260616');

    expect(res.status).toBe(200);
    expect(dbMocks.getLineAccountById).toHaveBeenCalledWith(expect.anything(), 'acc-1');
    expect(lineClientMocks.getFollowersInsight).toHaveBeenCalledWith('20260616');
    const body = (await res.json()) as {
      success: boolean;
      data: {
        lineAccountId: string;
        date: string;
        status: string;
        followers: number;
        targetedReaches: number;
        blocks: number;
        channelAccessToken?: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      lineAccountId: 'acc-1',
      date: '20260616',
      status: 'ready',
      followers: 123,
      targetedReaches: 111,
      blocks: 4,
    });
    expect(body.data.channelAccessToken).toBeUndefined();
  });

  test('rejects missing insight date', async () => {
    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts/acc-1/follower-insight');

    expect(res.status).toBe(400);
    expect(lineClientMocks.getFollowersInsight).not.toHaveBeenCalled();
  });

  test('assigned staff can fetch another account insight in the same organization', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ ...fakeAccount, id: 'acc-2' });
    dbMocks.getLineAccounts.mockResolvedValue([
      { ...fakeAccount, id: 'acc-1', parent_line_account_id: null },
      { ...fakeAccount, id: 'acc-2', parent_line_account_id: null },
    ]);
    lineClientMocks.getFollowersInsight.mockResolvedValue({
      status: 'ready', followers: 123, targetedReaches: 111, blocks: 4,
    });
    const app = setupApp('staff', makeDbStub(), {
      assignedLineAccountId: 'acc-1', canAccessDescendantAccounts: false,
    });
    const res = await app.request('/api/line-accounts/acc-2/follower-insight?date=20260616');
    expect(res.status).toBe(200);
    expect(lineClientMocks.getFollowersInsight).toHaveBeenCalled();
  });
});

function installAutoConnectFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url.endsWith('/v2/oauth/accessToken')) {
      return Response.json({ access_token: 'issued-token', expires_in: 2_592_000, token_type: 'Bearer' });
    }
    if (url.endsWith('/v2/bot/info')) {
      return Response.json({ displayName: 'LINE公式名', pictureUrl: 'https://example.com/icon.png', basicId: '@line', chatMode: 'bot' });
    }
    if (url.endsWith('/v2/bot/channel/webhook/endpoint') && method === 'PUT') return Response.json({});
    if (url.endsWith('/v2/bot/channel/webhook/endpoint')) {
      return Response.json({ endpoint: 'http://localhost/webhook', active: true });
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

describe('POST /api/line-accounts/connect', () => {
  test('接続失敗時はDBに行を作らない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const res = await setupApp('owner').request('/api/line-accounts/connect/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(autoConnectBody),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { steps: Array<{ order: number; state: string }> } };
    expect(body.success).toBe(true);
    expect(body.data.steps[0]).toMatchObject({ order: 1, state: 'failed' });
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
  });

  test('5段成功時に1行だけ保存し、認証済みなら友だち取り込みを開始する', async () => {
    installAutoConnectFetch();
    let followerSetting: string | null = null;
    dbMocks.getAccountSetting.mockImplementation(async () => followerSetting);
    dbMocks.setAccountSetting.mockImplementation(async (_db, _id, _key, value) => { followerSetting = value; });
    dbMocks.createLineAccount.mockResolvedValue({
      ...fakeAccount,
      id: 'created-account',
      name: 'LINE公式名',
      channel_access_token: 'issued-token',
      login_channel_id: '2007123456',
      login_channel_secret: 'login-secret',
      liff_id: '2007123456-auto',
      revision: 1,
    });
    dbMocks.updateLineAccountFields.mockResolvedValue(fakeAccount);
    lineClientMocks.getFollowerIds.mockResolvedValue({ userIds: [] });

    const res = await setupApp('owner').request('/api/line-accounts/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(autoConnectBody),
    });
    expect(res.status).toBe(201);
    expect(dbMocks.createLineAccount).toHaveBeenCalledOnce();
    expect(dbMocks.createLineAccount.mock.calls[0][1]).toMatchObject({
      name: 'LINE公式名',
      channelAccessToken: 'issued-token',
      loginChannelId: '2007123456',
      liffId: '2007123456-auto',
      timezone: 'Asia/Tokyo',
    });
    expect(dbMocks.saveLineAccountConnectionChecks.mock.calls[0][1].checks)
      .toContainEqual(expect.objectContaining({ kind: 'webhook_endpoint', webhookActive: true }));
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      success: true,
      data: {
        id: 'created-account',
        displayName: 'LINE公式名',
        followerImport: { capability: 'available', phase: 'importing_ids' },
      },
    });
    expect(JSON.stringify(body)).not.toContain('messaging-secret');
    expect(JSON.stringify(body)).not.toContain('login-secret');
  });

  test('保存後に認証判定できなければ作成行を巻き戻す', async () => {
    installAutoConnectFetch();
    dbMocks.createLineAccount.mockResolvedValue({
      ...fakeAccount,
      id: 'rollback-account',
      channel_access_token: 'issued-token',
      revision: 1,
    });
    dbMocks.updateLineAccountFields.mockResolvedValue(fakeAccount);
    lineClientMocks.getFollowerIds.mockRejectedValue(new Error('LINE API error: 503 Service Unavailable'));
    const res = await setupApp('owner').request('/api/line-accounts/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(autoConnectBody),
    });
    expect(res.status).toBe(502);
    expect(dbMocks.deleteUncommittedLineAccount).toHaveBeenCalledWith(expect.anything(), 'rollback-account');
  });
});

describe('POST /api/line-accounts', () => {
  test('passes loginChannelId / loginChannelSecret / liffId through to createLineAccount', async () => {
    dbMocks.createLineAccount.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009624792',
      login_channel_secret: 'login-secret',
      liff_id: '2009624792-XXXX',
    });

    const app = setupApp('owner', makeDbStub(), { tenantId: 'tenant-line-owner' });
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelId: '2009624792',
        loginChannelSecret: 'login-secret',
        liffId: '2009624792-XXXX',
      }),
    });

    expect(res.status).toBe(201);
    expect(dbMocks.createLineAccount).toHaveBeenCalledTimes(1);
    expect(dbMocks.createLineAccount.mock.calls[0][1]).toMatchObject({
      channelId: '123456789',
      loginChannelId: '2009624792',
      loginChannelSecret: 'login-secret',
      liffId: '2009624792-XXXX',
      tenantId: 'tenant-line-owner',
    });

    const body = (await res.json()) as { success: boolean; data: { loginChannelId: string | null; liffId: string | null; loginChannelSecret?: string | null; loginChannelSecretConfigured: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.loginChannelId).toBe('2009624792');
    expect(body.data.liffId).toBe('2009624792-XXXX');
    // Saved credentials are never echoed to the browser after persistence.
    expect(body.data.loginChannelSecret).toBeUndefined();
    expect(body.data.loginChannelSecretConfigured).toBe(true);
  });

  test('タイムゾーン・国地域・役割メモ・親アカウントを登録する', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      { ...fakeAccount, id: 'parent', tenant_id: 'tenant-line-owner', parent_line_account_id: null },
    ]);
    dbMocks.createLineAccount.mockImplementation(async (_db, input) => ({
      ...fakeAccount,
      id: 'created',
      channel_id: input.channelId,
      name: input.name,
      login_channel_id: input.loginChannelId,
      login_channel_secret: input.loginChannelSecret,
      liff_id: input.liffId,
      timezone: input.timezone,
      country: input.country,
      role: input.role,
      parent_line_account_id: input.parentLineAccountId,
      tenant_id: input.tenantId,
    }));

    const res = await setupApp('owner', makeDbStub(), { tenantId: 'tenant-line-owner' }).request(
      '/api/line-accounts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: '123456789',
          name: ' ベトナム店舗 ',
          channelAccessToken: 'token',
          channelSecret: 'secret',
          loginChannelId: '2009624792',
          loginChannelSecret: 'login-secret',
          liffId: '2009624792-XXXX',
          timezone: 'Asia/Ho_Chi_Minh',
          country: 'VN',
          role: '現地運用チーム',
          parentLineAccountId: 'parent',
        }),
      },
    );

    expect(res.status).toBe(201);
    expect(dbMocks.createLineAccount.mock.calls[0][1]).toMatchObject({
      name: 'ベトナム店舗',
      timezone: 'Asia/Ho_Chi_Minh',
      country: 'VN',
      role: '現地運用チーム',
      parentLineAccountId: 'parent',
    });
    await expect(res.json()).resolves.toMatchObject({
      data: { timezone: 'Asia/Ho_Chi_Minh', revision: 1, parentLineAccountId: 'parent' },
    });
  });

  test('担当範囲外の親アカウントは存在を明かさず404にする', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([{ ...fakeAccount, id: 'visible' }]);
    const res = await setupApp('owner').request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelId: '2009624792',
        loginChannelSecret: 'login-secret',
        liffId: '2009624792-XXXX',
        parentLineAccountId: 'outside',
      }),
    });

    expect(res.status).toBe(404);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
  });

  test('adminはアカウントを登録できない', async () => {
    const res = await setupApp('admin').request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
      }),
    });

    expect(res.status).toBe(403);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
  });

  test('LINE LoginとLIFFがない場合は登録しない', async () => {
    dbMocks.createLineAccount.mockResolvedValue(fakeAccount);

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
      }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
  });

  test('LIFF IDが空なら登録しない', async () => {
    dbMocks.createLineAccount.mockResolvedValue(fakeAccount);

    // Use a complete login pair (both id+secret present) to focus on the
    // trim/empty-string normalization behavior. liffId is independent.
    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelId: '  2009624792  ',
        loginChannelSecret: '  login-secret  ',
        liffId: '   ',
      }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
  });

  test('Messaging API接続確認が失敗した場合は登録しない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'invalid-token',
        channelSecret: 'secret',
        loginChannelId: '2009624792',
        loginChannelSecret: 'login-secret',
        liffId: '2009624792-XXXX',
      }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
  });
});

describe('POST /api/line-accounts/:id/connection-checks', () => {
  const requestCheck = (app: ReturnType<typeof setupApp>, expectedRevision = 1, key = 'account-check-0001') =>
    app.request('/api/line-accounts/acc-1/connection-checks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        'X-Correlation-ID': 'correlation-1',
      },
      body: JSON.stringify({ expectedRevision }),
    });

  test.each([
    ['matched', { endpoint: 'http://localhost/webhook', active: true }, 200],
    ['mismatched', { endpoint: 'https://old.example.com/webhook', active: true }, 200],
    ['unconfigured', { endpoint: '', active: false }, 200],
    ['unknown', null, 503],
  ] as const)('Webhookの %s 状態を実値から保存する', async (expected, endpoint, endpointStatus) => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009624792',
      login_channel_secret: 'login-secret',
      liff_id: '2009624792-XXXX',
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/v2/bot/info')) return Response.json({ displayName: 'テスト' });
      if (url.endsWith('/v2/bot/channel/webhook/endpoint')) {
        return endpoint ? Response.json(endpoint) : new Response(null, { status: endpointStatus });
      }
      if (url.endsWith('/v2/bot/channel/webhook/test')) return Response.json({ success: true });
      return new Response(null, { status: 404 });
    }));

    const res = await requestCheck(setupApp('owner'));
    expect(res.status).toBe(200);
    const saved = dbMocks.saveLineAccountConnectionChecks.mock.calls[0][1];
    expect(saved).toMatchObject({
      lineAccountId: 'acc-1',
      expectedRevision: 1,
      checkedBy: 'test-staff',
      correlationId: 'correlation-1',
      idempotencyKey: 'account-check-0001',
    });
    expect(saved.checks.find((check: { kind: string }) => check.kind === 'webhook_endpoint')).toMatchObject({
      result: expected,
      registeredUrl: endpoint?.endpoint || null,
    });
    await expect(res.json()).resolves.toMatchObject({
      data: {
        accountId: 'acc-1',
        revision: 2,
        expectedUrls: {
          webhook: 'http://localhost/webhook',
          callback: 'http://localhost/auth/callback',
          liffEndpoint: 'http://localhost?liffId=2009624792-XXXX',
        },
      },
    });
  });

  test('LIFF実値を取得できない場合はnullとunknownを保存する', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009624792',
      login_channel_secret: 'login-secret',
      liff_id: '2009624792-XXXX',
    });
    const res = await requestCheck(setupApp('owner'));

    expect(res.status).toBe(200);
    const liff = dbMocks.saveLineAccountConnectionChecks.mock.calls[0][1].checks
      .find((check: { kind: string }) => check.kind === 'liff_config');
    expect(liff).toMatchObject({ result: 'unknown', registeredUrl: null });
  });

  test('古い版はLINEへ問い合わせず409にする', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ ...fakeAccount, revision: 3 });
    const res = await requestCheck(setupApp('owner'), 2);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'REVISION_CONFLICT', currentRevision: 3 });
    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.saveLineAccountConnectionChecks).not.toHaveBeenCalled();
  });

  test('同じ冪等キーは保存済み結果を返し、再問い合わせしない', async () => {
    dbMocks.getLineAccountConnectionChecksByIdempotencyKey.mockResolvedValue([{
      id: 'check-1',
      line_account_id: 'acc-1',
      check_kind: 'webhook_endpoint',
      result: 'matched',
      expected_url: 'http://localhost/webhook',
      registered_url: 'http://localhost/webhook',
      webhook_active: 1,
      http_status: 200,
      checked_by: 'test-staff',
      checked_at: '2026-09-07T08:00:00.000+09:00',
      correlation_id: 'old-correlation',
      idempotency_key: 'account-check-0001',
      account_revision: 2,
    }]);
    const res = await requestCheck(setupApp('owner'), 1);

    expect(res.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(dbMocks.saveLineAccountConnectionChecks).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      data: { revision: 2, correlationId: 'old-correlation' },
    });
  });

  test('adminとstaffは403、担当範囲外は404、入力不備は422', async () => {
    expect((await requestCheck(setupApp('admin'))).status).toBe(403);
    expect((await requestCheck(setupApp('staff'))).status).toBe(403);

    dbMocks.getLineAccounts.mockResolvedValue([]);
    expect((await requestCheck(setupApp('owner'))).status).toBe(404);

    dbMocks.getLineAccounts.mockResolvedValue([{ ...fakeAccount, parent_line_account_id: null }]);
    expect((await requestCheck(setupApp('owner'), 0)).status).toBe(422);
    expect((await requestCheck(setupApp('owner'), 1, 'short')).status).toBe(422);
  });
});

describe('PATCH /api/line-accounts/hierarchy', () => {
  test('親子関係を検証して一括保存する', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      { ...fakeAccount, id: 'parent', parent_line_account_id: null },
      { ...fakeAccount, id: 'child', parent_line_account_id: null },
    ]);
    const batch = vi.fn().mockResolvedValue([]);
    const db = Object.assign(makeDbStub(), { batch });
    const app = setupApp('owner', db);

    const res = await app.request('/api/line-accounts/hierarchy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relationships: [{ id: 'child', parentLineAccountId: 'parent' }] }),
    });

    expect(res.status).toBe(200);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(1);
  });

  test('担当外の同一統括アカウントを含めて循環を拒否する', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      { ...fakeAccount, id: 'account-a', parent_line_account_id: 'unassigned' },
      { ...fakeAccount, id: 'unassigned', parent_line_account_id: 'account-b' },
      { ...fakeAccount, id: 'account-b', parent_line_account_id: null },
    ]);
    dbMocks.getStaffById.mockResolvedValue({ account_scope: 'accounts' });
    dbMocks.getStaffAccountScopeIds.mockResolvedValue(['account-a', 'account-b']);
    const batch = vi.fn().mockResolvedValue([]);
    const app = setupApp('admin', Object.assign(makeDbStub(), { batch }));

    const res = await app.request('/api/line-accounts/hierarchy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relationships: [{ id: 'account-b', parentLineAccountId: 'account-a' }],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/循環/) });
    expect(batch).not.toHaveBeenCalled();
  });
});

describe('GET /api/line-accounts', () => {
  test('資格情報は末尾4文字と更新日だけを返す', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([{
      ...fakeAccount,
      channel_access_token: 'full-access-token',
      channel_secret: 'full-channel-secret',
      login_channel_secret: 'full-login-secret',
      channel_access_token_last4: 'oken',
      channel_secret_last4: 'cret',
      login_channel_secret_last4: 'cret',
      channel_access_token_updated_at: '2026-09-01T10:00:00.000+09:00',
      channel_secret_updated_at: '2026-09-02T10:00:00.000+09:00',
      login_channel_secret_updated_at: '2026-09-03T10:00:00.000+09:00',
    }]);

    const res = await setupApp('owner').request('/api/line-accounts');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({
      channelAccessTokenLast4: 'oken',
      channelAccessTokenUpdatedAt: '2026-09-01T10:00:00.000+09:00',
      channelSecretLast4: 'cret',
      channelSecretUpdatedAt: '2026-09-02T10:00:00.000+09:00',
      loginChannelSecretLast4: 'cret',
      loginChannelSecretUpdatedAt: '2026-09-03T10:00:00.000+09:00',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('full-access-token');
    expect(serialized).not.toContain('full-channel-secret');
    expect(serialized).not.toContain('full-login-secret');
  });

  test('担当店舗だけを返し、担当外店舗を一覧から除外する', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      fakeAccount,
      { ...fakeAccount, id: 'acc-2', channel_id: '987654321', name: '担当外' },
    ]);
    dbMocks.getStaffById.mockResolvedValue({ account_scope: 'accounts' });
    dbMocks.getStaffAccountScopeIds.mockResolvedValue(['acc-1']);

    const res = await setupApp('staff').request('/api/line-accounts');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{ id: 'acc-1' }],
    });
  });

  test('通常一覧は集計を一括取得し、LINE APIを待たない', async () => {
    const accounts = Array.from({ length: 40 }, (_, index) => ({
      ...fakeAccount,
      id: `acc-${index + 1}`,
      channel_id: String(index + 1),
    }));
    dbMocks.getLineAccounts.mockResolvedValue(accounts);
    dbMocks.getLineAccountListStats.mockResolvedValue({
      'acc-1': { friendCount: 12, activeScenarios: 3, messagesThisMonth: 8 },
    });

    const res = await setupApp('owner').request('/api/line-accounts');

    expect(res.status).toBe(200);
    expect(dbMocks.getLineAccountListStats).toHaveBeenCalledTimes(1);
    expect(dbMocks.getLineAccountListStats).toHaveBeenCalledWith(expect.anything(), accounts.map((item) => item.id));
    expect(fetch).not.toHaveBeenCalled();
    const body = (await res.json()) as { data: Array<{ stats: { friendCount: number } }> };
    expect(body.data).toHaveLength(40);
    expect(body.data[0].stats.friendCount).toBe(12);
    expect(body.data[1].stats.friendCount).toBe(0);
  });

  test('一括集計に失敗したときは全件0と偽らず500を返す', async () => {
    dbMocks.getLineAccountListStats.mockRejectedValueOnce(new Error('D1 unavailable'));

    const res = await setupApp('owner').request('/api/line-accounts');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Internal server error' });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('live=1のときだけWebhook URLとプランを秘密情報なしで返す', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([fakeAccount]);
    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts?live=1');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ webhook: { status: string; expectedUrl: string }; plan: { key: string; label: string; monthlyMessageLimit: number }; channelAccessToken?: string }>;
    };
    expect(body.data[0].webhook).toMatchObject({
      status: 'matched',
      expectedUrl: 'http://localhost/webhook',
    });
    expect(body.data[0].channelAccessToken).toBeUndefined();
    expect(body.data[0].plan).toMatchObject({
      key: 'communication',
      label: 'コミュニケーション',
      monthlyMessageLimit: 200,
    });
  });

  test('live=1でもLINEへの同時接続を6本以内に抑える', async () => {
    const accounts = Array.from({ length: 8 }, (_, index) => ({
      ...fakeAccount,
      id: `acc-${index + 1}`,
      channel_id: String(index + 1),
      channel_access_token: `token-${index + 1}`,
    }));
    dbMocks.getLineAccounts.mockResolvedValue(accounts);
    let active = 0;
    let maximum = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      const url = String(input);
      if (url.endsWith('/v2/bot/info')) return Response.json({ displayName: 'テスト' });
      if (url.endsWith('/v2/bot/channel/webhook/endpoint')) {
        return Response.json({ endpoint: 'http://localhost/webhook', active: true });
      }
      if (url.endsWith('/v2/bot/channel/webhook/test')) return Response.json({ success: true });
      if (url.endsWith('/v2/bot/message/quota')) {
        return Response.json({ type: 'limited', value: 200 });
      }
      return new Response(null, { status: 404 });
    }));

    const res = await setupApp('owner').request('/api/line-accounts?live=1');

    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(8);
    expect(maximum).toBeLessThanOrEqual(6);
  });
});

describe('GET /api/line-accounts/summary', () => {
  test('閲覧できる稼働中アカウントの友だちを重複除外して集計する', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([fakeAccount]);
    const first = vi.fn().mockResolvedValue({ count: 37 });
    const bind = vi.fn(() => ({ first }));
    const db = { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database;
    const app = setupApp('owner', db);
    const res = await app.request('/api/line-accounts/summary');

    expect(res.status).toBe(200);
    expect(bind).toHaveBeenCalledWith('acc-1');
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { uniqueFriendCount: 37 },
    });
  });
});

describe('PATCH /api/line-accounts/:id', () => {
  test('stores a lin.ee official profile URL and returns it', async () => {
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      official_profile_url: 'https://lin.ee/nen-official',
    });

    const res = await setupApp('admin').request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ officialProfileUrl: 'https://lin.ee/nen-official' }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      officialProfileUrl: 'https://lin.ee/nen-official',
    });
    await expect(res.json()).resolves.toMatchObject({
      data: { officialProfileUrl: 'https://lin.ee/nen-official' },
    });
  });

  test('rejects a profile URL outside lin.ee without updating data', async () => {
    const res = await setupApp('admin').request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ officialProfileUrl: 'https://example.com/not-line' }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.updateLineAccountFields).not.toHaveBeenCalled();
    expect(dbMocks.updateLineAccount).not.toHaveBeenCalled();
  });

  test('updates loginChannelId / loginChannelSecret / liffId via metadata path', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009999999',
      liff_id: '2009999999-YYYY',
    });

    const app = setupApp('admin');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginChannelId: '2009999999',
        loginChannelSecret: 'rotated',
        liffId: '2009999999-YYYY',
      }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccountFields).toHaveBeenCalledTimes(1);
    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      loginChannelId: '2009999999',
      loginChannelSecret: 'rotated',
      liffId: '2009999999-YYYY',
    });
  });

  test('clears LIFF when explicitly set to empty string', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      liff_id: null,
    });

    const app = setupApp('admin');
    await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liffId: '' }),
    });

    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      liffId: null,
    });
  });

  test('does not touch login/liff fields when not provided', async () => {
    dbMocks.updateLineAccountFields.mockResolvedValue(fakeAccount);
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);

    const app = setupApp('admin');
    await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: '日本' }),
    });

    const arg = dbMocks.updateLineAccountFields.mock.calls[0][2];
    expect(arg.country).toBe('日本');
    expect(arg.loginChannelId).toBeUndefined();
    expect(arg.loginChannelSecret).toBeUndefined();
    expect(arg.liffId).toBeUndefined();
  });
});

describe('Login pair / uniqueness validation', () => {
  test('POST: rejects loginChannelId without secret', async () => {
    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelId: '2009624792',
        // loginChannelSecret missing
      }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/loginChannelSecret/);
  });

  test('POST: rejects loginChannelSecret without ID', async () => {
    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelSecret: 'orphan',
      }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
  });

  test('POST: rejects duplicate liffId', async () => {
    // makeDbStub returns "another row already has this liff_id"
    const app = setupApp('owner', makeDbStub({ id: 'other-acc' }));

    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelId: '2009624792',
        loginChannelSecret: 'login-secret',
        liffId: '2009624792-DUPLICATE',
      }),
    });

    expect(res.status).toBe(409);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/already assigned/);
  });

  test('PATCH: LIFF-only edit succeeds against half-configured Login (id-only) account', async () => {
    // Setup CLI persists login_channel_id without secret as a best-effort.
    // Adding a LIFF ID later via the dashboard must NOT trip the pair check
    // because the request doesn't touch the Login fields at all.
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'setup-cli-id',
      login_channel_secret: null,
    });
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'setup-cli-id',
      login_channel_secret: null,
      liff_id: '2009624792-NEW',
    });

    const app = setupApp('admin');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liffId: '2009624792-NEW' }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      liffId: '2009624792-NEW',
    });
  });

  test('PATCH: clearing both Login fields together succeeds', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'old-id',
      login_channel_secret: 'old-secret',
    });
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: null,
      login_channel_secret: null,
    });

    const app = setupApp('admin');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginChannelId: null, loginChannelSecret: null }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      loginChannelId: null,
      loginChannelSecret: null,
    });
  });

  test('PATCH: clearing only loginChannelId is rejected (would orphan the secret)', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'old-id',
      login_channel_secret: 'old-secret',
    });

    const app = setupApp('admin');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginChannelId: null }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.updateLineAccountFields).not.toHaveBeenCalled();
  });

  test('PATCH: keeps existing secret when only changing the loginChannelId', async () => {
    // Current row already has both id+secret. Caller changes only the id —
    // pair check should pass because the unchanged secret keeps the pair complete.
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'old-id',
      login_channel_secret: 'kept-secret',
    });
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'new-id',
      login_channel_secret: 'kept-secret',
    });

    const app = setupApp('admin');

    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginChannelId: 'new-id' }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccountFields).toHaveBeenCalled();
  });
});

describe('PUT /api/line-accounts/:id', () => {
  test('owner can update Login/LIFF + country/role in one request', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_secret: 'existing-secret',
    });
    dbMocks.updateLineAccount.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009624792',
      login_channel_secret: 'existing-secret',
      liff_id: '2009624792-XXXX',
    });
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009624792',
      login_channel_secret: 'existing-secret',
      liff_id: '2009624792-XXXX',
      country: '日本',
      role: '本店',
    });

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginChannelId: '2009624792',
        liffId: '2009624792-XXXX',
        country: '日本',
        role: '本店',
      }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccount.mock.calls[0][2]).toMatchObject({
      login_channel_id: '2009624792',
      liff_id: '2009624792-XXXX',
    });
    // country/role uses the fields helper (separate code path)
    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      country: '日本',
      role: '本店',
    });
  });
});
