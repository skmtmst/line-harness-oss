import { Hono, type Context } from 'hono';
import {
  getAffiliates,
  getAffiliateById,
  getAffiliateByCode,
  createAffiliate,
  createAffiliateWithRandomCode,
  createAffiliateLink,
  updateAffiliate,
  recordAffiliateClick,
  getAffiliateReport,
  getAffiliateReportV2,
  getFriendById,
  getFriendJourney,
  getAffiliateByFriendId,
  getAffiliateJourneys,
  getAffiliatePaymentSummaries,
  listAffiliateLinks,
  listAffiliateOffers,
  type AffiliateScope,
} from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { IDENTITY_KEY_SQL } from '../lib/identity-key.js';
import { resolveLinkBaseUrl } from '../lib/link-base-url.js';
import type { Env } from '../index.js';
import { auditLog } from '../lib/audit-log.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

const affiliates = new Hono<Env>();

async function getAffiliateScope(c: Context<Env>) {
  const visible = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const scope: AffiliateScope = {
    tenantId: c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID,
    allowedLineAccountIds: visible.allowedAccountIds,
    includeUnassigned: visible.canSeeUnassigned,
  };
  return { visible, scope };
}

function accountVisible(
  lineAccountId: string | null | undefined,
  visible: { allowedAccountIds: string[]; canSeeUnassigned: boolean },
): boolean {
  return lineAccountId == null
    ? visible.canSeeUnassigned
    : visible.allowedAccountIds.includes(lineAccountId);
}

function serializeAffiliate(row: {
  id: string;
  tenant_id?: string;
  line_account_id?: string | null;
  name: string;
  code: string;
  commission_rate: number;
  is_active: number;
  created_at: string;
  friend_id?: string | null;
  email?: string | null;
  hold_days?: number | null;
  payout_cycle?: string | null;
  notify_on_conversion?: number;
}) {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? null,
    lineAccountId: row.line_account_id ?? null,
    name: row.name,
    code: row.code,
    commissionRate: row.commission_rate,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    friendId: row.friend_id ?? null,
    email: row.email ?? null,
    holdDays: row.hold_days ?? null,
    payoutCycle: row.payout_cycle ?? null,
    notifyOnConversion: Boolean(row.notify_on_conversion),
  };
}

/**
 * 支払いの取り決めを検証して取り出す。送られた項目だけを含める。
 *
 * メールアドレスの形は「@ が1つある」程度しか見ない。厳密に弾こうとすると
 * 正しいアドレスまで弾く方が起きやすく、ここでの目的は打ち間違いに
 * 気づかせることだから。
 */
function readAffiliateSettlement(
  body: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('email')) {
    const raw = body.email;
    if (raw === null || raw === '' || raw === undefined) {
      out.email = null;
    } else if (typeof raw !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())) {
      return { ok: false, error: 'email must be a valid address' };
    } else {
      out.email = raw.trim();
    }
  }
  if (has('holdDays')) {
    const raw = body.holdDays;
    if (raw === null || raw === '' || raw === undefined) {
      out.hold_days = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        return { ok: false, error: 'holdDays must be an integer between 0 and 365' };
      }
      out.hold_days = n;
    }
  }
  if (has('payoutCycle')) {
    const raw = body.payoutCycle;
    if (raw === null || raw === '' || raw === undefined) {
      out.payout_cycle = null;
    } else if (typeof raw !== 'string' || raw.length > 100) {
      return { ok: false, error: 'payoutCycle must be 100 characters or fewer' };
    } else {
      out.payout_cycle = raw.trim();
    }
  }
  if (has('notifyOnConversion')) {
    out.notify_on_conversion = body.notifyOnConversion === true ? 1 : 0;
  }
  return { ok: true, value: out };
}

// GET /api/affiliates - list all
affiliates.get('/api/affiliates', async (c) => {
  try {
    const { scope } = await getAffiliateScope(c);
    const items = await getAffiliates(c.env.DB, scope);
    return c.json({ success: true, data: items.map(serializeAffiliate) });
  } catch (err) {
    console.error('GET /api/affiliates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 支払済み台帳はまだ無いため、承認済み報酬と保留期間内の金額だけを返す。
affiliates.get('/api/affiliate-payments', requireRole('owner', 'admin'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    if (!lineAccountId) {
      return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
    }
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.allowedAccountIds.includes(lineAccountId)) {
      return c.json({ success: false, error: '支払い履歴が見つかりません' }, 404);
    }
    const items = await getAffiliatePaymentSummaries(c.env.DB, lineAccountId);
    return c.json({
      success: true,
      data: items,
      limitations: {
        payoutHistory: false,
        bankDestination: false,
        settlementSchedule: false,
      },
    });
  } catch (err) {
    console.error('GET /api/affiliate-payments error:', err);
    return c.json({ success: false, error: '支払い情報を取得できませんでした' }, 500);
  }
});

// GET /api/affiliates/:id - get single
affiliates.get('/api/affiliates/:id', async (c) => {
  try {
    const { scope } = await getAffiliateScope(c);
    const item = await getAffiliateById(c.env.DB, c.req.param('id'), scope);
    if (!item) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    return c.json({ success: true, data: serializeAffiliate(item) });
  } catch (err) {
    console.error('GET /api/affiliates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliates - create (admin-side)
//
// Three call shapes, all backward compatible:
//   1. Random-code create:  { name?, commissionRate?, friendId?, issueInitialLink? }
//        - `code` is auto-generated (unguessable base62 slug). No manual entry.
//        - `friendId` binds the affiliate 1:1 to a LINE friend (migration 046
//          partial UNIQUE index enforces one affiliate per friend).
//        - When friendId is given, `name` defaults to the friend's display_name
//          and an initial link is issued by default (issueInitialLink=true).
//   2. Legacy explicit create: { name, code, commissionRate? }
//        - OSS back-compat. `code` must be >= 4 chars, alphanumeric only.
const CODE_RE = /^[A-Za-z0-9]{4,}$/;

affiliates.post('/api/affiliates', requireRole('owner', 'admin'), async (c) => {
  auditLog(c, 'affiliate.create', { kind: 'affiliate' });
  try {
    const body = await c.req.json<{
      name?: string;
      code?: string;
      commissionRate?: number;
      friendId?: string;
      issueInitialLink?: boolean;
      lineAccountId?: string;
    }>();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : '';
    const requestedLineAccountId = typeof body.lineAccountId === 'string'
      ? body.lineAccountId.trim()
      : '';
    const { visible, scope } = await getAffiliateScope(c);

    // Require at least one of name / code / friendId to identify the affiliate.
    if (!name && !code && !friendId) {
      return c.json(
        { success: false, error: 'name, code, or friendId is required' },
        400,
      );
    }

    // Resolve the friend (if binding) up front: 404 on unknown friend, and use
    // its display_name when the caller did not supply a name.
    let resolvedName = name;
    let lineAccountId = requestedLineAccountId;
    if (friendId) {
      const friend = await getFriendById(c.env.DB, friendId);
      if (!friend || !accountVisible(friend.line_account_id, visible) || !friend.line_account_id) {
        return c.json({ success: false, error: 'Friend not found' }, 404);
      }
      if (lineAccountId && lineAccountId !== friend.line_account_id) {
        return c.json({ success: false, error: 'Friend not found' }, 404);
      }
      lineAccountId = friend.line_account_id;
      if (!resolvedName) {
        resolvedName = (friend.display_name || 'Affiliate').trim();
      }
    }
    if (!lineAccountId && visible.allowedAccountIds.length === 1) {
      [lineAccountId] = visible.allowedAccountIds;
    }
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!visible.allowedAccountIds.includes(lineAccountId)) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }

    // ── Legacy explicit-code path (OSS back-compat) ─────────────────────────
    // Only taken when a code was supplied AND no friend binding is requested.
    if (code && !friendId) {
      if (!CODE_RE.test(code)) {
        return c.json(
          {
            success: false,
            error: 'code must be at least 4 alphanumeric characters',
          },
          400,
        );
      }
      if (!resolvedName) {
        return c.json({ success: false, error: 'name is required' }, 400);
      }
      try {
        const item = await createAffiliate(c.env.DB, {
          tenantId: scope.tenantId,
          lineAccountId,
          name: resolvedName,
          code,
          commissionRate: body.commissionRate,
        });
        return c.json({ success: true, data: serializeAffiliate(item) }, 201);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE constraint failed/i.test(msg) && /affiliates\.code/i.test(msg)) {
          return c.json(
            { success: false, error: 'このコードは既に使われています' },
            409,
          );
        }
        throw err;
      }
    }

    // ── Random-code path (admin default) ────────────────────────────────────
    if (!resolvedName) {
      resolvedName = 'Affiliate';
    }

    let item;
    try {
      item = await createAffiliateWithRandomCode(c.env.DB, {
        tenantId: scope.tenantId,
        lineAccountId,
        name: resolvedName,
        commissionRate: body.commissionRate,
        friendId: friendId || null,
      });
    } catch (err) {
      // The friend_id partial UNIQUE index throws when the friend already has an
      // affiliate. Confirm and return 409 with a friendly message.
      const msg = err instanceof Error ? err.message : String(err);
      if (friendId && /UNIQUE constraint failed/i.test(msg)) {
        const existing = await getAffiliateByFriendId(c.env.DB, friendId, lineAccountId);
        if (existing) {
          return c.json(
            { success: false, error: 'この友だちは既にアフィリエイターです' },
            409,
          );
        }
      }
      throw err;
    }

    // Issue an initial link. Defaults to true when a friend is bound.
    const shouldIssueLink =
      body.issueInitialLink !== undefined
        ? body.issueInitialLink
        : Boolean(friendId);

    let link: { refCode: string; url: string } | undefined;
    if (shouldIssueLink) {
      const created = await createAffiliateLink(c.env.DB, {
        affiliateId: item.id,
        lineAccountId,
      });
      const baseUrl = await resolveLinkBaseUrl(c.env.DB, c.env);
      link = { refCode: created.ref_code, url: `${baseUrl}/${created.ref_code}` };
    }

    return c.json(
      { success: true, data: serializeAffiliate(item), link: link ?? null },
      201,
    );
  } catch (err) {
    console.error('POST /api/affiliates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/affiliates/:id - update
affiliates.put('/api/affiliates/:id', requireRole('owner', 'admin'), async (c) => {
  auditLog(c, 'affiliate.update', { kind: 'affiliate', id: c.req.param('id') });
  try {
    const id = c.req.param('id');
    const { scope } = await getAffiliateScope(c);
    const body = await c.req.json<{
      name?: string;
      commissionRate?: number;
      isActive?: boolean;
    } & Record<string, unknown>>();

    const settlement = readAffiliateSettlement(body);
    if (!settlement.ok) return c.json({ success: false, error: settlement.error }, 400);

    const updated = await updateAffiliate(c.env.DB, id, {
      name: body.name,
      commission_rate: body.commissionRate,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
      ...settlement.value,
    }, scope);

    if (!updated) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    return c.json({ success: true, data: serializeAffiliate(updated) });
  } catch (err) {
    console.error('PUT /api/affiliates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 紹介者は成果・承認・支払いの監査元になるため物理削除しない。
// 停止は PUT { isActive: false } で行い、過去記録を残す。
affiliates.delete('/api/affiliates/:id', requireRole('owner', 'admin'), async (c) => {
  const { scope } = await getAffiliateScope(c);
  const item = await getAffiliateById(c.env.DB, c.req.param('id'), scope);
  if (!item) return c.json({ success: false, error: 'Affiliate not found' }, 404);
  return c.json(
    {
      success: false,
      code: 'PHYSICAL_DELETE_DISABLED',
      error: '紹介者は削除できません。紹介を止める操作を使ってください。過去の成果と支払い記録は残ります。',
    },
    405,
  );
});

// GET /api/affiliates/:id/report - affiliate performance report (v2)
// Extends the legacy report with ref_tracking-based clicks, add-time friendAdds,
// conversionsByPoint, estimatedCommission and identity-key duplicateFlags.
affiliates.get('/api/affiliates/:id/report', async (c) => {
  try {
    const { scope } = await getAffiliateScope(c);
    const affiliate = await getAffiliateById(c.env.DB, c.req.param('id'), scope);
    if (!affiliate) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    const report = await getAffiliateReportV2(c.env.DB, c.req.param('id'), {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      identityKeySql: IDENTITY_KEY_SQL,
      lineAccountId: affiliate.line_account_id,
    });

    if (!report) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/affiliates/:id/report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/:id/journeys - attributed-friend journey summaries
// Cursor-paginated on (addedAt, friendId), same scheme as GET /api/chats.
affiliates.get('/api/affiliates/:id/journeys', async (c) => {
  try {
    const { scope } = await getAffiliateScope(c);
    const affiliate = await getAffiliateById(c.env.DB, c.req.param('id'), scope);
    if (!affiliate) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10);
    const page = await getAffiliateJourneys(c.env.DB, c.req.param('id'), {
      limit: Number.isFinite(limitParam) ? limitParam : undefined,
      beforeAt: c.req.query('beforeAt') || undefined,
      beforeId: c.req.query('beforeId') || undefined,
    });
    return c.json({ success: true, data: page.items, nextCursor: page.nextCursor });
  } catch (err) {
    console.error('GET /api/affiliates/:id/journeys error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/:id/links - list all ref_code links for an affiliate
affiliates.get('/api/affiliates/:id/links', async (c) => {
  try {
    const { scope } = await getAffiliateScope(c);
    const affiliate = await getAffiliateById(c.env.DB, c.req.param('id'), scope);
    if (!affiliate) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    const links = await listAffiliateLinks(c.env.DB, c.req.param('id'), {
      lineAccountId: affiliate.line_account_id,
    });
    const offerNames = await (async () => {
      const offers = await listAffiliateOffers(c.env.DB, {
        activeOnly: false,
        lineAccountIds: affiliate.line_account_id ? [affiliate.line_account_id] : [],
        includeUnassigned: affiliate.line_account_id == null,
      });
      return new Map(offers.map((o) => [o.id, o.name]));
    })();
    const data = links.map((row) => ({
      ...row,
      offer_name: row.offer_id != null ? (offerNames.get(row.offer_id) ?? null) : null,
    }));
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/affiliates/:id/links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/:id/journey - time-ordered event journey for one friend
affiliates.get('/api/friends/:id/journey', async (c) => {
  try {
    const { visible } = await getAffiliateScope(c);
    const friend = await getFriendById(c.env.DB, c.req.param('id'));
    if (!friend || !accountVisible(friend.line_account_id, visible)) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const events = await getFriendJourney(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: { events } });
  } catch (err) {
    console.error('GET /api/friends/:id/journey error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliates/click - record click (public endpoint tracked by ref param)
affiliates.post('/api/affiliates/click', async (c) => {
  try {
    const body = await c.req.json<{
      code: string;
      url?: string | null;
    }>();

    if (!body.code) {
      return c.json({ success: false, error: 'code is required' }, 400);
    }

    const affiliate = await getAffiliateByCode(c.env.DB, body.code);
    if (!affiliate || affiliate.is_active !== 1) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }

    const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;
    await recordAffiliateClick(c.env.DB, affiliate.id, body.url, ipAddress);
    return c.json({ success: true, data: null }, 201);
  } catch (err) {
    console.error('POST /api/affiliates/click error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/report - all affiliates report
affiliates.get('/api/affiliates-report', requireRole('owner', 'admin'), async (c) => {
  try {
    const { scope } = await getAffiliateScope(c);
    const report = await getAffiliateReport(c.env.DB, undefined, {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      scope,
    });
    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/affiliates-report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { affiliates };
