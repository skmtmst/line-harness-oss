import { Hono } from 'hono';
import { it, expect, vi } from 'vitest';
import type { Env } from '../index.js';
const mocks = vi.hoisted(() => ({ stats: vi.fn() }));
vi.mock('@line-crm/db', async (original) => ({ ...(await original<typeof import('@line-crm/db')>()), getFriendStats: mocks.stats }));
vi.mock('../services/account-access.js', async (original) => ({ ...(await original<typeof import('../services/account-access.js')>()), getVisibleLineAccountScope: async () => ({ allowedAccountIds: ['a'], canSeeUnassigned: false }) }));
import { friends } from './friends.js';
it('前月差を可視範囲の集計からそのまま返す', async () => {
 const app = new Hono<Env>();
 app.use('*', async (c,next) => { c.set('staff', { id:'o', name:'Owner', role:'owner', readOnly:false }); await next(); });
 app.route('/', friends);
 mocks.stats.mockResolvedValue({ active:7, activeLastMonth:5, activeMonthDelta:2, activeComparisonDate:'2026-09-30' });
 const response = await app.request('/api/friends/stats', {}, { DB: {} as D1Database });
 expect(response.status).toBe(200);
 expect((await response.json() as any).data.activeMonthDelta).toBe(2);
 expect(mocks.stats).toHaveBeenCalledWith(expect.anything(), { allowedAccountIds:['a'], includeUnassigned:false });
});
