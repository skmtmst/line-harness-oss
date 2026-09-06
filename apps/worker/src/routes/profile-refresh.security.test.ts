import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const getVisibleLineAccountScope = vi.hoisted(() => vi.fn());

vi.mock('../services/account-access.js', () => ({ getVisibleLineAccountScope }));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: vi.fn() }));

const { profileRefresh } = await import('./profile-refresh.js');

type RecordedQuery = { sql: string; binds: unknown[] };

function database(records: RecordedQuery[], friendFound = true): D1Database {
  return {
    prepare(sql: string) {
      const record = { sql, binds: [] as unknown[] };
      records.push(record);
      const statement = {
        bind(...binds: unknown[]) { record.binds = binds; return statement; },
        async all() {
          if (sql.includes('FROM line_accounts')) {
            return { results: [{ id: 'account-own', name: 'Own Account' }] };
          }
          if (sql.includes('FROM messages_log ml') && sql.includes('AS preview')) {
            return { results: [{
              id: 'message-own', direction: 'incoming', message_type: 'text', source: null,
              line_account_id: 'account-own', preview: 'own preview', created_at: '2026-09-07',
              display_name: 'Own Friend', friend_id: 'friend-own',
            }] };
          }
          if (sql.includes('FROM messages_log ml')) {
            return { results: [{ account_id: 'account-own', keyword: 'own', incoming_count: 1 }] };
          }
          if (sql.includes('FROM messages_log')) {
            return { results: [{ account_id: 'account-own', source: 'auto_reply', outgoing_count: 1 }] };
          }
          if (sql.includes('FROM automations')) {
            return { results: [{
              id: 'automation-own', name: 'Own Automation', event_type: 'message',
              line_account_id: 'account-own', is_active: 1, conditions: '{"keyword":"own"}',
              actions_preview: '[{"type":"reply"}]',
            }] };
          }
          return { results: [] };
        },
        async first() {
          if (!friendFound) return null;
          return {
            id: 'friend-own', display_name: 'Own Friend', line_user_id: 'U-own',
            line_account_id: 'account-own', is_following: 1, user_id: 'user-own',
          };
        },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function app(
  records: RecordedQuery[],
  role: 'owner' | 'admin' | 'staff' = 'owner',
  friendFound = true,
) {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-own', name: 'Own Staff', role, readOnly: false, tenantId: 'tenant-own' });
    c.env = { DB: database(records, friendFound) };
    await next();
  });
  instance.route('/', profileRefresh);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  getVisibleLineAccountScope.mockResolvedValue({
    accounts: [], ids: ['account-own'], allowedAccountIds: ['account-own'],
    canSeeUnassigned: false, isAccountScoped: true,
  });
});

describe('profile refresh operational debug authorization', () => {
  test.each([
    '/api/admin/auto-reply-stats',
    '/api/admin/recent-messages',
    '/api/admin/automations-summary',
    '/api/admin/friend-debug/friend-other',
  ])('staff cannot read %s', async (path) => {
    const records: RecordedQuery[] = [];
    const response = await app(records, 'staff').request(path);
    expect(response.status).toBe(403);
    expect(records).toEqual([]);
  });

  test('auto reply statistics bind both message queries and account names to the visible account', async () => {
    const records: RecordedQuery[] = [];
    const response = await app(records).request('/api/admin/auto-reply-stats?days=7');
    expect(response.status).toBe(200);
    expect(records).toHaveLength(3);
    expect(records[0].sql).toContain('f.line_account_id IN (SELECT value FROM json_each(?))');
    expect(records[0].binds.slice(-1)).toEqual(['["account-own"]']);
    expect(records[1].sql).toContain('line_account_id IN (SELECT value FROM json_each(?))');
    expect(records[1].binds.slice(-1)).toEqual(['["account-own"]']);
    expect(records[2].sql).toContain('WHERE id IN (SELECT value FROM json_each(?))');
    expect(records[2].binds).toEqual(['["account-own"]']);
  });

  test('recent message previews use the message or friend account before returning content', async () => {
    const records: RecordedQuery[] = [];
    const response = await app(records).request('/api/admin/recent-messages?limit=20');
    expect(response.status).toBe(200);
    expect(records[0].sql).toContain('COALESCE(ml.line_account_id, f.line_account_id) IN (SELECT value FROM json_each(?))');
    expect(records[0].binds).toEqual(['["account-own"]', 20]);
    expect(await response.text()).toContain('own preview');
  });

  test('automation condition and action previews are limited before reading rows', async () => {
    const records: RecordedQuery[] = [];
    const response = await app(records).request('/api/admin/automations-summary');
    expect(response.status).toBe(200);
    expect(records[0].sql).toContain('line_account_id IN (SELECT value FROM json_each(?))');
    expect(records[0].binds).toEqual(['["account-own"]']);
    expect(await response.text()).toContain('Own Automation');
  });

  test('friend debug hides an inaccessible friend as not found', async () => {
    const records: RecordedQuery[] = [];
    const response = await app(records, 'owner', false).request('/api/admin/friend-debug/friend-other');
    expect(response.status).toBe(404);
    expect(records).toHaveLength(1);
    expect(records[0].sql).toContain('f.line_account_id IN (SELECT value FROM json_each(?))');
    expect(records[0].binds).toEqual(['friend-other', '["account-own"]']);
  });

  test('owner can read an allowed friend without querying names outside the account scope', async () => {
    const records: RecordedQuery[] = [];
    const response = await app(records).request('/api/admin/friend-debug/friend-own');
    expect(response.status).toBe(200);
    const body = await response.json<{ data: { friend: { line_user_id: string }; accountName: string } }>();
    expect(body.data).toEqual(expect.objectContaining({ accountName: 'Own Account' }));
    expect(body.data.friend.line_user_id).toBe('U-own');
    expect(records[1].sql).toContain('WHERE id IN (SELECT value FROM json_each(?))');
    expect(records[1].binds).toEqual(['["account-own"]']);
  });
});
