import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './auth.js';
import { resolveCorsOrigin } from './admin-auth-config.js';
import { adminAuth } from '../routes/admin-auth.js';
import { encryptTotpSecret, totpAtStep } from '../lib/totp.js';
import type { Env } from '../index.js';

vi.mock('@line-crm/db', () => ({
  getStaffByApiKey: vi.fn(async (_db: unknown, token: string) => {
    if (token === 'viewer-key') return { id: 'viewer-1', name: 'Viewer One', role: 'staff', access_level: 'read_only' };
    if (token === 'friends-key') return { id: 'friends-1', name: 'Friends Staff', role: 'staff', permission_keys: '["/friends"]' };
    if (token === 'chats-key') return { id: 'chats-1', name: 'Chats Staff', role: 'staff', permission_keys: '["/chats"]' };
    if (token === 'tags-key') return { id: 'tags-1', name: 'Tags Staff', role: 'staff', permission_keys: '["/tags"]' };
    if (token === 'mileage-key') return { id: 'mileage-1', name: 'Mileage Staff', role: 'staff', permission_keys: '["/mileage"]' };
    if (token === 'auto-replies-key') return { id: 'auto-replies-1', name: 'Auto Replies Staff', role: 'staff', permission_keys: '["/auto-replies"]' };
    if (token === 'automations-key') return { id: 'automations-1', name: 'Automations Staff', role: 'staff', permission_keys: '["/automations"]' };
    if (token === 'no-permissions-key') return { id: 'none-1', name: 'No Permission Staff', role: 'staff', permission_keys: '[]' };
    if (token !== 'staff-key') return null;
    return {
      id: 'staff-1', name: 'Staff One', role: 'admin',
      tenant_id: '00000000-0000-4000-8000-000000000001',
    };
  }),
  getStaffByAdminSession: vi.fn(async (_db: unknown, tokenHash: string) => {
    if (tokenHash === 'dfac1ac3966cbe3d487761671296ced77cce526aa4ebb1cf70a1cf3f728dcd4e') {
      return { id: 'viewer-1', name: 'Viewer One', role: 'staff', access_level: 'read_only' };
    }
    if (tokenHash !== 'c1e9199b97100cfa89cf5335e39753c0ee4caddde90d79bf5ca16ab99d4a7d9a') return null;
    return { id: 'staff-1', name: 'Staff One', role: 'admin' };
  }),
  getStaffByLineUserId: vi.fn(async (_db: unknown, lineUserId: string) => {
    if (lineUserId !== 'authorized-line-user') return null;
    return { id: 'staff-1', name: 'Staff One', role: 'admin', is_active: 1 };
  }),
  createAdminSession: vi.fn(async () => undefined),
  createTwoFactorChallenge: vi.fn(async () => undefined),
  deleteExpiredTwoFactorChallenges: vi.fn(async () => undefined),
  getTwoFactorChallenge: vi.fn(async () => null),
  getStaffById: vi.fn(async () => null),
  incrementTwoFactorChallengeAttempts: vi.fn(async () => undefined),
  deleteTwoFactorChallenge: vi.fn(async () => undefined),
  claimStaffTotpStep: vi.fn(async () => true),
  updateStaffMember: vi.fn(async () => null),
  deleteAdminSession: vi.fn(async () => undefined),
  // ログイン・ログアウト・失敗を記録する。本体では例外を握るので、
  // ここでも何もしない実装で足りる。
  recordLoginAudit: vi.fn(async () => undefined),
}));

const PAGES = 'https://your-admin.pages.dev';
const WORKERS = 'https://your-worker.your-subdomain.workers.dev';

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    LINE_CHANNEL_SECRET: 'secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    API_KEY: 'env-key',
    LIFF_URL: 'https://liff.example.test',
    LINE_CHANNEL_ID: 'line-channel',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
    WORKER_URL: WORKERS,
    ADMIN_PUBLIC_URL: PAGES,
    ...overrides,
    RAW_MAIL: overrides.RAW_MAIL ?? ({} as R2Bucket),
  };
}

// Cross-site production topology with explicit opt-in (the supported case).
function crossSiteEnv(): Env['Bindings'] {
  return env({ ADMIN_ORIGIN: PAGES, ADMIN_ALLOW_CROSS_SITE: 'true' });
}

function app() {
  const a = new Hono<Env>();
  a.use('*', cors({
    origin: (origin, c) => resolveCorsOrigin(c.env, origin, c.req.url),
    credentials: true,
  }));
  a.use('*', authMiddleware);
  a.route('/', adminAuth);
  a.get('/api/protected', (c) => c.json({ success: true, data: c.get('staff') }));
  a.post('/api/protected', (c) => c.json({ success: true, data: c.get('staff') }));
  a.get('/api/auto-reply-runs', (c) => c.json({ success: true }));
  a.get('/api/automation-runs', (c) => c.json({ success: true }));
  a.get('/api/forms/:id', (c) => c.json({ success: true, staff: c.get('staff') ?? null }));
  a.put('/api/forms/:id', (c) => c.json({ success: true }));
  a.delete('/api/forms/:id', (c) => c.json({ success: true }));
  a.post('/api/forms/:id/submit', (c) => c.json({ success: true }));
  a.post('/api/forms/:id/partial', (c) => c.json({ success: true }));
  a.post('/api/forms/:id/opened', (c) => c.json({ success: true }));
  a.post('/api/integrations/codex-slack/events', (c) => c.json({ success: true }));
  a.post('/api/integrations/slack/actions', (c) => c.json({ success: true }));
  a.post('/api/integrations/slack/events', (c) => c.json({ success: true }));
  a.get('/api/public/brand', (c) => c.json({ success: true, staff: c.get('staff') ?? null }));
  for (const path of [
    '/api/support', '/api/operators', '/api/support-marks', '/api/saved-searches',
    '/api/folders', '/api/tag-groups', '/api/friends/:id', '/api/friends/:id/messages',
    '/api/friends/:id/fields', '/api/friends/:id/support-mark', '/api/friends/support-mark/bulk',
  ]) {
    a.get(path, (c) => c.json({ success: true }));
  }
  a.get('/api/mileage/history', (c) => c.json({ success: true }));
  a.get('/api/action-scores/rules', (c) => c.json({ success: true }));
  return a;
}

function setCookies(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie();
  const single = res.headers.get('Set-Cookie');
  return single ? [single] : [];
}

function cookieFor(res: Response, name: string): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

describe('admin login cookie attributes', () => {
  test('cross-site login sets HttpOnly Secure SameSite=None session + readable CSRF cookie', async () => {
    const res = await app().request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'staff-key' }),
      headers: { 'Content-Type': 'application/json' },
    }, crossSiteEnv());

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { id: string }; csrfToken: string };
    expect(body.data).toMatchObject({
      id: 'staff-1', role: 'admin',
      tenantId: '00000000-0000-4000-8000-000000000001',
    });
    expect(body.csrfToken).toBeTruthy();

    const session = cookieFor(res, 'lh_admin_session') ?? '';
    expect(session).toMatch(/^lh_admin_session=[^;]+/);
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    expect(session).toContain('SameSite=None');
    expect(session).toContain('Max-Age=604800');

    const csrf = cookieFor(res, 'lh_csrf') ?? '';
    expect(csrf).toContain(`lh_csrf=${body.csrfToken}`);
    expect(csrf).not.toContain('HttpOnly'); // SPA-readable (double-submit)
    expect(csrf).toContain('SameSite=None');
  });

  test('same-site (custom domain) login uses SameSite=Lax', async () => {
    const res = await app().request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'staff-key' }),
      headers: { 'Content-Type': 'application/json' },
    }, env({ ADMIN_ORIGIN: 'https://admin.example.com', WORKER_URL: 'https://api.example.com' }));

    expect(res.status).toBe(200);
    expect(cookieFor(res, 'lh_admin_session') ?? '').toContain('SameSite=Lax');
  });

  test('invalid api key is rejected without a cookie', async () => {
    const res = await app().request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'wrong' }),
      headers: { 'Content-Type': 'application/json' },
    }, crossSiteEnv());
    expect(res.status).toBe(401);
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
  });
});

describe('LINE admin login', () => {
  test('starts OAuth with state, nonce and PKCE', async () => {
    const res = await app().request('/api/auth/line', {}, crossSiteEnv());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin).toBe('https://access.line.me');
    expect(location.searchParams.get('client_id')).toBe('login-channel');
    expect(location.searchParams.get('scope')).toBe('openid profile');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(cookieFor(res, 'lh_line_state')).toBeTruthy();
    expect(cookieFor(res, 'lh_line_nonce')).toBeTruthy();
    expect(cookieFor(res, 'lh_line_verifier')).toBeTruthy();
  });

  test('rejects a callback when state does not match before calling LINE', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await app().request('/api/auth/line/callback?code=abc&state=wrong', {
      headers: { Cookie: 'lh_line_state=expected; lh_line_nonce=nonce; lh_line_verifier=verifier' },
    }, crossSiteEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/login?error=invalid_state');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('creates a session only for an explicitly authorized LINE user', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: 'id-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'authorized-line-user' }), { status: 200 }));
    const res = await app().request('/api/auth/line/callback?code=abc&state=expected', {
      headers: { Cookie: 'lh_line_state=expected; lh_line_nonce=nonce; lh_line_verifier=verifier' },
    }, crossSiteEnv());
    expect(res.status).toBe(302);
    const redirect = new URL(res.headers.get('Location')!);
    expect(redirect.origin).toBe(PAGES);
    expect(new URLSearchParams(redirect.hash.slice(1)).get('lh_session')).toBeTruthy();
    expect(new URLSearchParams(redirect.hash.slice(1)).get('lh_csrf')).toBeTruthy();
    expect(cookieFor(res, 'lh_admin_session')).toBeTruthy();
    fetchSpy.mockRestore();
  });

  test('does not create a session for an unregistered LINE user', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_token: 'id-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'not-registered' }), { status: 200 }));
    const res = await app().request('/api/auth/line/callback?code=abc&state=expected', {
      headers: { Cookie: 'lh_line_state=expected; lh_line_nonce=nonce; lh_line_verifier=verifier' },
    }, crossSiteEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('/login?error=not_authorized');
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
    fetchSpy.mockRestore();
  });
});

describe('Authenticator verification', () => {
  test('valid code exchanges a short-lived challenge for a cross-site admin session', async () => {
    const db = await import('@line-crm/db');
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const masterKey = 'test-master-key-which-is-longer-than-32-characters';
    vi.mocked(db.getTwoFactorChallenge).mockResolvedValueOnce({
      token_hash: 'hash', staff_id: 'staff-1', expires_at: new Date(Date.now() + 60_000).toISOString(), attempts: 0, created_at: new Date().toISOString(),
    });
    vi.mocked(db.getStaffById).mockResolvedValueOnce({
      id: 'staff-1', name: 'Staff One', email: 'staff@example.com', role: 'admin', access_level: 'full', api_key: 'hidden', line_user_id: 'U1', is_active: 1,
      permission_keys: '[]', notification_preferences: '{}', invite_status: 'active', invite_token_hash: null, invite_expires_at: null, email_verified_at: null, line_linked_at: null,
      totp_secret_enc: await encryptTotpSecret(secret, masterKey), totp_pending_secret_enc: null, totp_enabled_at: new Date().toISOString(), totp_last_used_step: null,
      tenant_id: '00000000-0000-4000-8000-000000000001',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const step = Math.floor(Date.now() / 30_000);
    const response = await app().request('/api/auth/two-factor/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: 'challenge', code: await totpAtStep(secret, step) }),
    }, { ...crossSiteEnv(), TOTP_ENCRYPTION_KEY: masterKey });
    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; data: { sessionToken?: string }; csrfToken: string };
    expect(body.success).toBe(true);
    expect(body.data.sessionToken).toBeTruthy();
    expect(body.csrfToken).toBeTruthy();
    expect(cookieFor(response, 'lh_admin_session')).toBeTruthy();
    expect(db.claimStaffTotpStep).toHaveBeenCalledWith(expect.anything(), 'staff-1', expect.any(Number));
  });
});

describe('topology guard', () => {
  test('cross-site WITHOUT opt-in refuses login with an actionable error', async () => {
    const res = await app().request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'staff-key' }),
      headers: { 'Content-Type': 'application/json' },
    }, env({ ADMIN_ORIGIN: PAGES })); // no ADMIN_ALLOW_CROSS_SITE

    expect(res.status).toBe(500);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/cross-site/i);
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
  });
});

describe('protected API access', () => {
  test('accepts the admin session cookie (GET, no CSRF needed)', async () => {
    const res = await app().request('/api/protected', {
      headers: { Cookie: 'lh_admin_session=staff-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data).toMatchObject({ id: 'staff-1', role: 'admin' });
  });

  test('still accepts Bearer tokens for SDK / MCP callers', async () => {
    const res = await app().request('/api/protected', {
      headers: { Authorization: 'Bearer env-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data).toMatchObject({ id: 'env-owner', role: 'owner' });
  });

  test('accepts an admin session as a Bearer fallback for cross-site browsers', async () => {
    const res = await app().request('/api/protected', {
      headers: { Authorization: 'Bearer lh_session:staff-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string; role: string } };
    expect(body.data).toMatchObject({ id: 'staff-1', role: 'admin' });
  });

  test('keeps read-only access when using the Bearer fallback', async () => {
    const get = await app().request('/api/protected', {
      headers: { Authorization: 'Bearer lh_session:viewer-session' },
    }, crossSiteEnv());
    expect(get.status).toBe(200);
    // 役割と読み取り専用は別々に持つ。読み取り専用でも元の役割は残る。
    const body = await get.json() as { data: { role: string; readOnly: boolean } };
    expect(body.data.role).toBe('staff');
    expect(body.data.readOnly).toBe(true);

    const post = await app().request('/api/protected', {
      method: 'POST',
      headers: { Authorization: 'Bearer lh_session:viewer-session' },
    }, crossSiteEnv());
    expect(post.status).toBe(403);
  });

  test('rejects requests with no credentials', async () => {
    const res = await app().request('/api/protected', {}, crossSiteEnv());
    expect(res.status).toBe(401);
  });

  test('allows read-only accounts to read authenticated APIs', async () => {
    const res = await app().request('/api/protected', { headers: { Authorization: 'Bearer viewer-key' } }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { role: string; readOnly: boolean } };
    expect(body.data.role).toBe('staff');
    expect(body.data.readOnly).toBe(true);
  });

  test('blocks read-only accounts from state-changing API methods', async () => {
    const res = await app().request('/api/protected', { method: 'POST', headers: { Authorization: 'Bearer viewer-key' } }, crossSiteEnv());
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toMatch(/閲覧のみ/);
  });

  test('a malformed cookie value yields 401, not a 500', async () => {
    // `%` is an invalid percent escape — decoding must not throw.
    const res = await app().request('/api/protected', {
      headers: { Cookie: 'lh_admin_session=%; other=%E0%A4%A' },
    }, crossSiteEnv());
    expect(res.status).toBe(401);
  });
});

describe('staff feature permissions', () => {
  const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

  test.each(['/api/support', '/api/operators', '/api/friends/friend-1/messages'])(
    'chat permission protects %s',
    async (path) => {
      expect((await app().request(path, bearer('chats-key'), crossSiteEnv())).status).toBe(200);
      expect((await app().request(path, bearer('friends-key'), crossSiteEnv())).status).toBe(403);
    },
  );

  test.each([
    '/api/support-marks', '/api/saved-searches', '/api/folders', '/api/tag-groups',
    '/api/friends/friend-1/fields', '/api/friends/friend-1/support-mark',
    '/api/friends/support-mark/bulk',
  ])('friend-attributes permission protects %s', async (path) => {
    expect((await app().request(path, bearer('tags-key'), crossSiteEnv())).status).toBe(200);
    expect((await app().request(path, bearer('friends-key'), crossSiteEnv())).status).toBe(403);
  });

  test('friend permission still allows ordinary friend APIs but not nested chat or attributes', async () => {
    expect((await app().request('/api/friends/friend-1', bearer('friends-key'), crossSiteEnv())).status).toBe(200);
    expect((await app().request('/api/friends/friend-1/messages', bearer('friends-key'), crossSiteEnv())).status).toBe(403);
    expect((await app().request('/api/friends/friend-1/fields', bearer('friends-key'), crossSiteEnv())).status).toBe(403);
  });

  test('mileage permission protects mileage APIs', async () => {
    expect((await app().request('/api/mileage/history', bearer('mileage-key'), crossSiteEnv())).status).toBe(200);
    expect((await app().request('/api/mileage/history', bearer('friends-key'), crossSiteEnv())).status).toBe(403);
    expect((await app().request('/api/action-scores/rules', bearer('mileage-key'), crossSiteEnv())).status).toBe(200);
    expect((await app().request('/api/action-scores/rules', bearer('friends-key'), crossSiteEnv())).status).toBe(403);
  });

  test('auto-reply permission protects execution results', async () => {
    expect((await app().request('/api/auto-reply-runs', bearer('auto-replies-key'), crossSiteEnv())).status).toBe(200);
    expect((await app().request('/api/auto-reply-runs', bearer('friends-key'), crossSiteEnv())).status).toBe(403);
  });

  test('automation permission protects execution results', async () => {
    expect((await app().request('/api/automation-runs', bearer('automations-key'), crossSiteEnv())).status).toBe(200);
    expect((await app().request('/api/automation-runs', bearer('friends-key'), crossSiteEnv())).status).toBe(403);
  });

  test.each(['/api/support', '/api/friends/friend-1', '/api/support-marks'])(
    'missing feature permission fails closed for %s',
    async (path) => {
      expect((await app().request(path, bearer('no-permissions-key'), crossSiteEnv())).status).toBe(403);
    },
  );
});

describe('public form method boundaries', () => {
  test('allows unauthenticated GET of a form definition', async () => {
    const res = await app().request('/api/forms/form-1', {}, crossSiteEnv());
    expect(res.status).toBe(200);
    expect((await res.json() as { staff: unknown }).staff).toBeNull();
  });

  test('authenticates an admin GET so the route can return private settings', async () => {
    const res = await app().request('/api/forms/form-1', {
      headers: { Authorization: 'Bearer env-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    expect((await res.json() as { staff: { role: string } }).staff.role).toBe('owner');
  });

  test.each(['PUT', 'DELETE'])('%s on the same form path requires admin auth', async (method) => {
    const res = await app().request('/api/forms/form-1', { method }, crossSiteEnv());
    expect(res.status).toBe(401);
  });

  test.each(['submit', 'partial', 'opened'])(
    'allows POST /%s through to route-level LIFF authentication',
    async (action) => {
      const res = await app().request(`/api/forms/form-1/${action}`, {
        method: 'POST',
      }, crossSiteEnv());
      expect(res.status).toBe(200);
    },
  );

  test('does not exempt the wrong method on a public action path', async () => {
    const res = await app().request('/api/forms/form-1/submit', {
      method: 'DELETE',
    }, crossSiteEnv());
    expect(res.status).toBe(401);
  });
});

describe('署名検証を持つSlack連携入口', () => {
  test.each([
    '/api/integrations/codex-slack/events',
    '/api/integrations/slack/actions',
    '/api/integrations/slack/events',
  ])('%s は管理者認証より前へ通す', async (path) => {
    const res = await app().request(path, { method: 'POST' }, crossSiteEnv());
    expect(res.status).toBe(200);
  });
});

describe('ログイン画面の看板', () => {
  // ログイン画面は認証より手前にあるので、ここが通らないと名前もアイコンも
  // 出せない。逆に通しすぎると認証の穴になるので、この1本で固定する。
  test('認証なしで読める', async () => {
    const res = await app().request('/api/public/brand', {}, crossSiteEnv());
    expect(res.status).toBe(200);
    expect((await res.json() as { staff: unknown }).staff).toBeNull();
  });

  test('似た名前の道は通さない', async () => {
    const res = await app().request('/api/public/brands', {}, crossSiteEnv());
    expect(res.status).toBe(401);
  });
});

describe('CSRF protection', () => {
  test('cookie-authenticated POST without an X-CSRF-Token is rejected', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: { Cookie: 'lh_admin_session=staff-key; lh_csrf=token-abc' },
    }, crossSiteEnv());
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toMatch(/csrf/i);
  });

  test('cookie-authenticated POST with a mismatched token is rejected', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: {
        Cookie: 'lh_admin_session=staff-key; lh_csrf=token-abc',
        'X-CSRF-Token': 'token-WRONG',
      },
    }, crossSiteEnv());
    expect(res.status).toBe(403);
  });

  test('cookie-authenticated POST with a matching double-submit token succeeds', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: {
        Cookie: 'lh_admin_session=staff-key; lh_csrf=token-abc',
        'X-CSRF-Token': 'token-abc',
      },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
  });

  test('Bearer POST is exempt from CSRF (not cookie-driven)', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: { Authorization: 'Bearer env-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
  });
});

describe('logout', () => {
  test('expires both the session and CSRF cookies', async () => {
    const res = await app().request('/api/auth/logout', { method: 'POST' }, crossSiteEnv());
    expect(res.status).toBe(200);
    const session = cookieFor(res, 'lh_admin_session') ?? '';
    const csrf = cookieFor(res, 'lh_csrf') ?? '';
    expect(session).toContain('Max-Age=0');
    expect(csrf).toContain('Max-Age=0');
  });

  test('revokes a Bearer fallback admin session', async () => {
    const db = await import('@line-crm/db');
    const deleteSession = vi.mocked(db.deleteAdminSession);
    deleteSession.mockClear();
    const res = await app().request('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer lh_session:staff-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    expect(deleteSession).toHaveBeenCalledWith(
      expect.anything(),
      'c1e9199b97100cfa89cf5335e39753c0ee4caddde90d79bf5ca16ab99d4a7d9a',
    );
  });
});

describe('session endpoint', () => {
  test('returns the staff identity and a CSRF token', async () => {
    const res = await app().request('/api/auth/session', {
      headers: { Cookie: 'lh_admin_session=staff-key; lh_csrf=token-abc' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string }; csrfToken: string };
    expect(body.data).toMatchObject({ id: 'staff-1' });
    expect(body.csrfToken).toBe('token-abc');
  });

  test('mints and sets a CSRF cookie when none is present', async () => {
    const res = await app().request('/api/auth/session', {
      headers: { Cookie: 'lh_admin_session=staff-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { csrfToken: string };
    expect(body.csrfToken).toBeTruthy();
    expect(cookieFor(res, 'lh_csrf') ?? '').toContain(`lh_csrf=${body.csrfToken}`);
  });
});

describe('CORS allowed / blocked origins', () => {
  test('allowlisted admin origin is echoed back', async () => {
    const res = await app().request('/api/protected', {
      headers: { Origin: PAGES, Cookie: 'lh_admin_session=staff-key' },
    }, crossSiteEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('Cloudflare Pages preview origin for the admin project is echoed back', async () => {
    const preview = 'https://abc123.your-admin.pages.dev';
    const res = await app().request('/api/protected', {
      headers: { Origin: preview, Cookie: 'lh_admin_session=staff-key' },
    }, crossSiteEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(preview);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('login preflight succeeds from a Cloudflare Pages preview origin', async () => {
    const preview = 'https://abc123.your-admin.pages.dev';
    const res = await app().request('/api/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: preview,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    }, crossSiteEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(preview);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('unknown origin gets no Access-Control-Allow-Origin header', async () => {
    const res = await app().request('/api/protected', {
      headers: { Origin: 'https://evil.example.com', Cookie: 'lh_admin_session=staff-key' },
    }, crossSiteEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
