import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({ allowedAccountIds: [], canSeeUnassigned: true })),
}));

import { adPlatforms } from './ad-platforms.js';

function statement(value: { first?: unknown; results?: unknown[] }) {
  const result = {
    bind: vi.fn(),
    first: vi.fn(async () => value.first),
    all: vi.fn(async () => ({ results: value.results ?? [] })),
  };
  result.bind.mockReturnValue(result);
  return result;
}

describe('GET /api/ad-platforms/logs', () => {
  it('媒体横断の履歴を共通一覧契約で返しlimitを200に丸める', async () => {
    const count = statement({ first: { total: 501 } });
    const rows = statement({ results: [{
      id: 'log-1', ad_platform_id: 'platform-1', friend_id: 'friend-1', event_name: 'Purchase',
      click_id: 'click-1', click_id_type: 'gclid', status: 'success', error_message: null,
      created_at: '2026-09-08T10:00:00.000',
    }] });
    const prepare = vi.fn().mockReturnValueOnce(count).mockReturnValueOnce(rows);
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'owner-1', name: 'Owner', role: 'owner', readOnly: false, tenantId: 'tenant-1' });
      return next();
    });
    app.route('/', adPlatforms);

    const response = await app.request('/api/ad-platforms/logs?page=2&limit=999999&status=sent', {}, {
      DB: { prepare } as unknown as D1Database,
    } as Env['Bindings']);
    expect(response.status).toBe(200);
    expect(rows.bind).toHaveBeenCalledWith(200, 200);
    expect(await response.json()).toMatchObject({ data: {
      items: [{ id: 'log-1', adPlatformId: 'platform-1', status: 'success' }],
      total: 501, page: 2, limit: 200,
      sort: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'desc' }],
    } });
  });
});
