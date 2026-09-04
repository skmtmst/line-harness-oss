import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  getConversionPoints,
  getConversionPointById,
  createConversionPoint,
  updateConversionPoint,
  stopConversionPoint,
  trackConversion,
  getConversionEvents,
  getConversionReport,
  getConversionApprovalQueue,
  setConversionApproval,
  getConversionApprovalNotifyInfo,
  syncAffiliateConversionMileage,
} from '@line-crm/db';
import { IDENTITY_KEY_SQL } from '../lib/identity-key.js';
import { notifyAffiliateApproval } from '../services/affiliate-notifier.js';
import type { Env } from '../index.js';
import { auditLog } from '../lib/audit-log.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { listLimit, listOffset } from './list-pagination.js';

import type { ConversionPoint, ConversionMeasureMethod } from '@line-crm/db';

const conversions = new Hono<Env>();

async function adminAccountScope(c: Context<Env>, alias = '') {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const column = `${alias}line_account_id`;
  const where = scope.allowedAccountIds.length
    ? `(${column} IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.canSeeUnassigned ? ` OR ${column} IS NULL` : ''})`
    : scope.canSeeUnassigned
      ? `${column} IS NULL`
      : '1 = 0';
  return { scope, where };
}

const requireVisibleConversionPoint: MiddlewareHandler<Env> = async (c, next) => {
  const point = await getConversionPointById(c.env.DB, c.req.param('id') ?? '');
  if (!point || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [point.line_account_id])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  await next();
};

const requireVisibleConversionEvent: MiddlewareHandler<Env> = async (c, next) => {
  const row = await c.env.DB.prepare(
    `SELECT cp.line_account_id FROM conversion_events ce
       JOIN conversion_points cp ON cp.id = ce.conversion_point_id
      WHERE ce.id = ?`,
  ).bind(c.req.param('id')).first<{ line_account_id: string | null }>();
  if (!row || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [row.line_account_id])) {
    return c.json({ success: false, error: 'Attributed conversion event not found' }, 404);
  }
  await next();
};

async function visibleConversionPointIds(c: Context<Env>) {
  const { scope, where } = await adminAccountScope(c, 'cp.');
  const rows = await c.env.DB.prepare(`SELECT cp.id AS id FROM conversion_points cp WHERE ${where}`)
    .bind(...scope.allowedAccountIds)
    .all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}

const MEASURE_METHODS: ConversionMeasureMethod[] = ['url_reach', 'webhook', 'manual'];

function serializeConversionPoint(p: ConversionPoint) {
  return {
    id: p.id,
    name: p.name,
    eventType: p.event_type,
    value: p.value,
    measureMethod: p.measure_method,
    targetUrl: p.target_url,
    countRepeat: p.count_repeat !== 0,
    attributionDays: p.attribution_days,
    lineAccountId: p.line_account_id,
    status: p.status,
    stoppedAt: p.stopped_at,
    createdAt: p.created_at,
  };
}

interface ConversionPointBody {
  name?: unknown;
  eventType?: unknown;
  value?: unknown;
  measureMethod?: unknown;
  targetUrl?: unknown;
  countRepeat?: unknown;
  attributionDays?: unknown;
  lineAccountId?: unknown;
}

/**
 * 計測に関する項目を検証して取り出す。
 *
 * url_reach なのに対象URLが無い、という組み合わせを弾く。保存できてしまうと
 * 「設定したのに1件も数えられない」という、気づきにくい壊れ方をする。
 */
function readMeasureOptions(
  body: ConversionPointBody,
  current?: ConversionPoint,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};

  let method = current?.measure_method ?? 'manual';
  if (body.measureMethod !== undefined) {
    if (!MEASURE_METHODS.includes(body.measureMethod as ConversionMeasureMethod)) {
      return { ok: false, error: `measureMethod must be one of ${MEASURE_METHODS.join(', ')}` };
    }
    method = body.measureMethod as ConversionMeasureMethod;
    out.measureMethod = method;
  }

  let targetUrl = current?.target_url ?? null;
  if ('targetUrl' in body) {
    const raw = body.targetUrl;
    if (raw === null || raw === '' || raw === undefined) {
      targetUrl = null;
    } else if (typeof raw !== 'string' || !/^https?:\/\//.test(raw)) {
      return { ok: false, error: 'targetUrl must start with http:// or https://' };
    } else {
      targetUrl = raw.trim();
    }
    out.targetUrl = targetUrl;
  }

  if (method === 'url_reach' && !targetUrl) {
    return { ok: false, error: 'targetUrl is required when measureMethod is url_reach' };
  }

  if (body.countRepeat !== undefined) out.countRepeat = body.countRepeat !== false;

  if ('attributionDays' in body) {
    const raw = body.attributionDays;
    if (raw === null || raw === '' || raw === undefined) {
      out.attributionDays = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return { ok: false, error: 'attributionDays must be an integer between 1 and 365' };
      }
      out.attributionDays = n;
    }
  }

  if ('lineAccountId' in body) {
    const raw = body.lineAccountId;
    out.lineAccountId = raw === null || raw === '' || raw === undefined ? null : String(raw);
  }

  return { ok: true, value: out };
}

// ── Conversion Points ───────────────────────────────────────────────────────

// GET /api/conversions/points - list all
conversions.get('/api/conversions/points', async (c) => {
  try {
    const visibleIds = await visibleConversionPointIds(c);
    const items = (await getConversionPoints(c.env.DB)).filter((item) => visibleIds.has(item.id));
    return c.json({
      success: true,
      data: items.map(serializeConversionPoint),
    });
  } catch (err) {
    console.error('GET /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/conversions/points - create
conversions.post('/api/conversions/points', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<ConversionPointBody>();

    if (!body.name || !body.eventType) {
      return c.json({ success: false, error: 'name and eventType are required' }, 400);
    }

    const options = readMeasureOptions(body);
    if (!options.ok) return c.json({ success: false, error: options.error }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [options.value.lineAccountId as string | null])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    const point = await createConversionPoint(c.env.DB, {
      name: String(body.name),
      eventType: String(body.eventType),
      value: body.value === null || body.value === undefined ? null : Number(body.value),
      ...options.value,
    });
    return c.json({ success: true, data: serializeConversionPoint(point) }, 201);
  } catch (err) {
    console.error('POST /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/conversions/points/:id - update
// 送られた項目だけを触る。画面が「計測方法だけ変える」ような部分更新をするため。
conversions.put('/api/conversions/points/:id', requireRole('owner', 'admin'), requireVisibleConversionPoint, async (c) => {
  try {
    const id = c.req.param('id');
    const current = await getConversionPointById(c.env.DB, id);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<ConversionPointBody>();
    const options = readMeasureOptions(body, current);
    if (!options.ok) return c.json({ success: false, error: options.error }, 400);
    if ('lineAccountId' in options.value
      && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [options.value.lineAccountId as string | null])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    const patch: Record<string, unknown> = { ...options.value };
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return c.json({ success: false, error: 'name must not be empty' }, 400);
      patch.name = name;
    }
    if (body.eventType !== undefined) patch.eventType = String(body.eventType);
    if ('value' in body) {
      patch.value = body.value === null || body.value === '' ? null : Number(body.value);
    }

    const point = await updateConversionPoint(c.env.DB, id, patch);
    if (!point) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeConversionPoint(point) });
  } catch (err) {
    console.error('PUT /api/conversions/points/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/conversions/points/:id - stop tracking and preserve history
conversions.delete('/api/conversions/points/:id', requireRole('owner', 'admin'), requireVisibleConversionPoint, async (c) => {
  try {
    await stopConversionPoint(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/conversions/points/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── Conversion Tracking ─────────────────────────────────────────────────────

// POST /api/conversions/track - record conversion
conversions.post('/api/conversions/track', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      conversionPointId: string;
      friendId: string;
      userId?: string | null;
      affiliateCode?: string | null;
      metadata?: Record<string, unknown> | null;
      idempotencyKey?: string | null;
    }>();

    if (!body.conversionPointId || !body.friendId) {
      return c.json(
        { success: false, error: 'conversionPointId and friendId are required' },
        400,
      );
    }

    const [pointAccount, friendAccount] = await Promise.all([
      c.env.DB.prepare('SELECT line_account_id, status FROM conversion_points WHERE id = ?')
        .bind(body.conversionPointId).first<{ line_account_id: string | null; status: string }>(),
      c.env.DB.prepare('SELECT line_account_id FROM friends WHERE id = ?')
        .bind(body.friendId).first<{ line_account_id: string | null }>(),
    ]);
    if (!pointAccount || !friendAccount || !await canAccessAllLineAccounts(
      c.env.DB,
      c.get('staff'),
      [pointAccount.line_account_id, friendAccount.line_account_id],
    )) {
      return c.json({ success: false, error: 'このコンバージョンを記録する権限がありません' }, 403);
    }
    if (pointAccount.status === 'stopped') {
      return c.json({ success: false, error: 'この成果地点は計測を停止しています' }, 409);
    }
    if (
      body.idempotencyKey !== undefined
      && (typeof body.idempotencyKey !== 'string'
        || body.idempotencyKey.length < 1
        || body.idempotencyKey.length > 200)
    ) {
      return c.json({ success: false, error: 'idempotencyKey must be 1 to 200 characters' }, 400);
    }

    const event = await trackConversion(c.env.DB, {
      conversionPointId: body.conversionPointId,
      friendId: body.friendId,
      userId: body.userId,
      affiliateCode: body.affiliateCode,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      idempotencyKey: body.idempotencyKey ?? null,
    });

    return c.json({
      success: true,
      data: {
        id: event.id,
        conversionPointId: event.conversion_point_id,
        friendId: event.friend_id,
        userId: event.user_id,
        affiliateCode: event.affiliate_code,
        metadata: event.metadata,
        createdAt: event.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/conversions/track error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/events - list events with filters
conversions.get('/api/conversions/events', async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const events = await getConversionEvents(c.env.DB, {
      scope: { allowedAccountIds: scope.allowedAccountIds, includeUnassigned: scope.canSeeUnassigned },
      conversionPointId: c.req.query('conversionPointId'),
      friendId: c.req.query('friendId'),
      affiliateCode: c.req.query('affiliateCode'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      limit: listLimit(c.req.query('limit'), 100),
      offset: listOffset(c.req.query('offset')),
    });

    return c.json({
      success: true,
      data: events.map((e) => ({
        id: e.id,
        conversionPointId: e.conversion_point_id,
        friendId: e.friend_id,
        userId: e.user_id,
        affiliateCode: e.affiliate_code,
        metadata: e.metadata,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/conversions/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/report - aggregated report
conversions.get('/api/conversions/report', requireRole('owner', 'admin'), async (c) => {
  try {
    const visibleIds = await visibleConversionPointIds(c);
    const report = (await getConversionReport(c.env.DB, {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    })).filter((row) => visibleIds.has(row.conversionPointId));

    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/conversions/report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── Approval Queue (ASP Phase 2) ─────────────────────────────────────────────

const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected']);

// GET /api/conversions/approvals?status=pending|approved|rejected
// Affiliate-attributed CVs awaiting/holding an approval decision. duplicateFlag
// reuses the Phase 1 identity_key heuristic scoped per affiliate.
conversions.get('/api/conversions/approvals', async (c) => {
  try {
    const status = c.req.query('status') ?? 'pending';
    if (!APPROVAL_STATUSES.has(status)) {
      return c.json(
        { success: false, error: 'status must be pending, approved, or rejected' },
        400,
      );
    }

    const limit = listLimit(c.req.query('limit'), 200);
    const offset = listOffset(c.req.query('offset'));

    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const rows = await getConversionApprovalQueue(c.env.DB, {
      scope: { allowedAccountIds: scope.allowedAccountIds, includeUnassigned: scope.canSeeUnassigned },
      status: status as 'pending' | 'approved' | 'rejected',
      identityKeySql: IDENTITY_KEY_SQL,
      limit,
      offset,
    });

    return c.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/conversions/approvals error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/conversions/events/:id/approval - approve/reject an attributed CV
conversions.patch('/api/conversions/events/:id/approval', requireRole('owner', 'admin'), requireVisibleConversionEvent, async (c) => {
  auditLog(c, 'conversion.approval.update', { kind: 'conversion_event', id: c.req.param('id') });
  try {
    const body = await c.req
      .json<{ status?: string }>()
      .catch(() => ({}) as { status?: string });

    if (body.status !== 'approved' && body.status !== 'rejected') {
      return c.json(
        { success: false, error: 'status must be approved or rejected' },
        400,
      );
    }

    const updated = await setConversionApproval(
      c.env.DB,
      c.req.param('id'),
      body.status,
    );
    if (updated === false) {
      // Missing event OR non-attributed CV (approval flow only applies to
      // affiliate-attributed rows) — both surface as 404.
      return c.json(
        { success: false, error: 'Attributed conversion event not found' },
        404,
      );
    }

    // Mileage projection is retry-safe and runs even for `already_set`. This is
    // deliberate: if an earlier request updated the approval row but failed
    // before writing the ledger, the operator's retry repairs the partial work.
    await syncAffiliateConversionMileage(
      c.env.DB,
      c.req.param('id'),
      body.status,
    );

    if (updated === 'already_set') {
      // Idempotent re-click: the status is already set to the requested value.
      // Return 200 so the UI does not show an error to the operator.
      return c.json({
        success: true,
        data: { id: c.req.param('id'), approvalStatus: body.status },
      });
    }

    // ASP: notify the attributed affiliate on approval only (never on reject).
    // Best-effort — notifyAffiliateApproval swallows its own errors, but guard
    // the info lookup too so a push failure can never fail the approval request.
    if (body.status === 'approved') {
      try {
        const info = await getConversionApprovalNotifyInfo(c.env.DB, c.req.param('id'));
        if (info) {
          await notifyAffiliateApproval(
            c.env.DB,
            c.env,
            info.affiliateId,
            info.offerName,
            info.rewardAmount,
          );
        }
      } catch (err) {
        console.error('Affiliate approval notify failed (non-blocking):', err);
      }
    }

    return c.json({ success: true, data: { id: c.req.param('id'), approvalStatus: body.status } });
  } catch (err) {
    console.error('PATCH /api/conversions/events/:id/approval error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { conversions };
