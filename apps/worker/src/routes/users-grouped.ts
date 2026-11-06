import { buildOffsetListResponse, parseOffsetPaging } from '../lib/list-paging.js';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { requireRole } from '../middleware/role-guard.js';
import { computeUsersGrouped, type UsersGroupedOptions } from '../services/users-grouped.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

export const usersGrouped = new Hono<Env>();

usersGrouped.get('/api/users-grouped', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const q = c.req.query('q');
    const onlyDups = c.req.query('onlyDups') === '1';
    const account = c.req.query('account') || undefined;
    const memberAccountId = c.req.query('memberAccountId') || undefined;
    const uidRaw = c.req.query('uid');
    const pageStr = c.req.query('page');
    const pageSizeStr = c.req.query('pageSize');
    const forceRefresh = c.req.query('refresh') === '1';
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));

    const opts: UsersGroupedOptions = {
      allowedAccountIds: scope.allowedAccountIds,
      q: q || undefined,
      onlyDups,
      account,
      memberAccountId,
      // 表示中ページへの後絞りをやめ、全件へかける条件として受ける。
      uid: uidRaw === 'linked' || uidRaw === 'unlinked' ? uidRaw : undefined,
      page: pageStr ? parseOffsetPaging({ page: pageStr }, { pagePolicy: { format: 'integer-prefix' } }).page : undefined,
      pageSize: pageSizeStr ? parseOffsetPaging({ limit: pageSizeStr }, { defaultLimit: Number.NaN, limitPolicy: { format: 'integer-prefix' } }).limit : undefined,
      forceRefresh,
    };

    const result = await computeUsersGrouped(c.env.DB, opts);
    return c.json({ success: true, data: buildOffsetListResponse({ ...result, ...(memberAccountId ? { memberAccountId } : {}), items: result.rows, paging: { limit: result.pageSize, offset: (result.page - 1) * result.pageSize }, sort: [{ field: 'accountCount', direction: 'desc' }, { field: 'lastActivityAt', direction: 'desc' }] }) });
  } catch (err) {
    throw err;
  }
});
