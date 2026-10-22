import { buildOffsetListResponse, listQueryNumber } from '../lib/list-paging.js';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import {
  computeUnansweredInbox,
  countUnanswered,
  type UnansweredInboxOptions,
} from '../services/unanswered-inbox.js';
import {
  getActivityDigest,
  parseActivityDigestHours,
} from '../services/activity-digest.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

export const inbox = new Hono<Env>();

// GET /api/inbox/activity-digest?hours=3
// Codex の定期レポートなど、読み取り専用の外部クライアント向け集約 API。
// グローバル authMiddleware 配下なので Bearer API key / admin session が必須。
inbox.get('/api/inbox/activity-digest', async (c) => {
  const hours = parseActivityDigestHours(c.req.query('hours'));
  if (hours === null) {
    return c.json({
      success: false,
      error: 'hours must be an integer between 1 and 168',
    }, 400);
  }

  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const data = await getActivityDigest(c.env.DB, {
      hours,
      allowedAccountIds: scope.allowedAccountIds,
      canSeeUnassigned: scope.canSeeUnassigned,
    });
    return c.json({ success: true, data });
  } catch (err) {
    throw err;
  }
});

inbox.get('/api/inbox/unanswered', async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const q = c.req.query('q');
    const account = c.req.query('account') || undefined;
    const minWaitMinutesStr = c.req.query('minWaitMinutes');
    const pageStr = c.req.query('page');
    const pageSizeStr = c.req.query('pageSize');

    const opts: UnansweredInboxOptions = {
      q: q || undefined,
      account,
      minWaitMinutes: minWaitMinutesStr ? Number.parseInt(minWaitMinutesStr, 10) : undefined,
      page: pageStr ? listQueryNumber(pageStr, Number.NaN, { format: 'integer-prefix' }) : undefined,
      pageSize: pageSizeStr ? listQueryNumber(pageSizeStr, Number.NaN, { format: 'integer-prefix' }) : undefined,
      allowedAccountIds: scope.allowedAccountIds,
      canSeeUnassigned: scope.canSeeUnassigned,
    };

    const result = await computeUnansweredInbox(c.env.DB, opts);
    return c.json({ success: true, data: buildOffsetListResponse({ ...result, items: result.rows, paging: { limit: result.pageSize }, sort: [{ field: 'lastIncomingAt', direction: 'desc' }, { field: 'friendId', direction: 'desc' }] }) });
  } catch (err) {
    throw err;
  }
});

inbox.get('/api/inbox/unanswered/count', async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const result = await countUnanswered(c.env.DB, {
      allowedAccountIds: scope.allowedAccountIds,
      canSeeUnassigned: scope.canSeeUnassigned,
    });
    return c.json({ success: true, data: result });
  } catch (err) {
    throw err;
  }
});
