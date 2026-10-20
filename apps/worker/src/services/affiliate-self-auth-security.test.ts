import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), friend: vi.fn() }));
vi.mock('@line-crm/db', () => ({ listLineAccountsWithTenantStatus: mocks.accounts, getFriendByLineUserIdForAccount: mocks.friend }));
import { resolveFriendFromLineToken } from './affiliate-self-auth.js';
import type { Env } from '../worker-env.js';
const account = { id: 'a', tenant_id: 't', login_channel_id: 'channel', tenant_status: 'active', is_active: 1, archived_at: null };
const env = { DB: {}, LINE_LOGIN_CHANNEL_ID: 'channel' } as Env['Bindings'];
beforeEach(() => {
  mocks.accounts.mockResolvedValue([account]);
  mocks.friend.mockResolvedValue({ id: 'friend', line_account_id: 'a' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('/verify?') ? { client_id: 'channel' } : { userId: 'user' })));
});
afterEach(() => vi.unstubAllGlobals());
describe('affiliate self current store authorization', () => {
  it('allows a current friend in the active matching store', async () => { expect((await resolveFriendFromLineToken(env, 'token')).status).toBe('ok'); });
  it.each([{ is_active: 0 }, { archived_at: '2026-10-01' }, { tenant_status: 'suspended' }])('denies stopped stores %j', async change => {
    mocks.accounts.mockResolvedValue([{ ...account, ...change }]);
    expect((await resolveFriendFromLineToken(env, 'token')).status).toBe('tenant_suspended');
  });
  it('rejects a friend belonging to a different store', async () => {
    mocks.friend.mockResolvedValue({ id: 'friend', line_account_id: 'other' });
    expect((await resolveFriendFromLineToken(env, 'token')).status).toBe('no_friend');
  });
  it('keeps only the unassigned default-channel legacy friend', async () => {
    mocks.accounts.mockResolvedValue([]); mocks.friend.mockResolvedValue({ id: 'friend', line_account_id: null });
    expect((await resolveFriendFromLineToken(env, 'token')).status).toBe('ok');
    mocks.friend.mockResolvedValue({ id: 'friend', line_account_id: 'other' });
    expect((await resolveFriendFromLineToken(env, 'token')).status).toBe('no_friend');
  });
});
