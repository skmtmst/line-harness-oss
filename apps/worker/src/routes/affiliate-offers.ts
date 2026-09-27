import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  createAffiliateOffer,
  createOfferVersion,
  getCurrentOfferVersion,
  getOfferCapStatus,
  listAffiliateOffers,
  listOfferVersions,
  updateAffiliateOffer,
  getAffiliateOfferById,
  type AffiliateOffer,
  type AffiliateOfferVersion,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { auditLog } from '../lib/audit-log.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  canAccessAllLineAccounts,
  getVisibleLineAccountScope,
} from '../services/account-access.js';

/**
 * Admin-side affiliate offer (案件) CRUD. Mounted under `/api/affiliate-offers`,
 * so it inherits admin auth from authMiddleware (only `/api/liff/*` is skipped).
 *
 * snake_case DB rows → camelCase responses via serializeOffer, mirroring
 * routes/affiliates.ts's serializeAffiliate.
 */
const affiliateOffers = new Hono<Env>();

async function requireVisibleAffiliateOffer(c: Context<Env>, next: () => Promise<void>) {
  const item = await getAffiliateOfferById(c.env.DB, c.req.param('id')!);
  if (!item || !await canAccessAllLineAccounts(
    c.env.DB,
    c.get('staff'),
    [item.line_account_id ?? null],
  )) {
    return c.json({ success: false, error: 'Offer not found' }, 404);
  }
  await next();
}

function serializeOffer(row: AffiliateOffer) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rewardAmount: row.reward_amount,
    rewardMiles: row.reward_miles ?? 0,
    mileageProgramId: row.mileage_program_id ?? 'default',
    lineAccountId: row.line_account_id,
    tagId: row.tag_id,
    scenarioId: row.scenario_id,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

/** reward_amount must be a non-negative integer when supplied. */
function isValidReward(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * 案件に結ぶタグ・シナリオが、案件と同じLINEアカウントのものか確かめる
 * （#554 点検#505中3）。他アカウントのものを結ぶと成果時の誤動作・
 * 情報の混ざりになる。存在しない・見えないは区別せず400にする。
 */
async function offerReferenceError(
  db: D1Database,
  kind: 'tag' | 'scenario',
  id: string,
  lineAccountId: string,
): Promise<string | null> {
  const table = kind === 'tag' ? 'tags' : 'scenarios';
  const label = kind === 'tag' ? 'タグ' : 'シナリオ';
  const row = await db.prepare(
    `SELECT id FROM ${table} WHERE id = ? AND line_account_id = ?`,
  ).bind(id, lineAccountId).first<{ id: string }>();
  return row ? null : `${label}が見つかりません。選び直してください`;
}

async function offerReferencesError(
  db: D1Database,
  refs: { tagId?: string | null; scenarioId?: string | null },
  lineAccountId: string,
): Promise<string | null> {
  if (typeof refs.tagId === 'string' && refs.tagId) {
    const error = await offerReferenceError(db, 'tag', refs.tagId, lineAccountId);
    if (error) return error;
  }
  if (typeof refs.scenarioId === 'string' && refs.scenarioId) {
    const error = await offerReferenceError(db, 'scenario', refs.scenarioId, lineAccountId);
    if (error) return error;
  }
  return null;
}

// GET /api/affiliate-offers - list all (optionally activeOnly)
affiliateOffers.get('/api/affiliate-offers', async (c) => {
  try {
    const activeOnly = c.req.query('activeOnly') === 'true';
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const items = await listAffiliateOffers(c.env.DB, {
      activeOnly,
      lineAccountIds: scope.allowedAccountIds,
      includeUnassigned: scope.canSeeUnassigned,
    });
    return c.json({ success: true, data: items.map(serializeOffer) });
  } catch (err) {
    console.error('GET /api/affiliate-offers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliate-offers/:id - get single
affiliateOffers.use('/api/affiliate-offers/:id', requireVisibleAffiliateOffer);
affiliateOffers.use('/api/affiliate-offers/:id/*', requireVisibleAffiliateOffer);
affiliateOffers.get('/api/affiliate-offers/:id', async (c) => {
  try {
    const item = await getAffiliateOfferById(c.env.DB, c.req.param('id'));
    if (!item) {
      return c.json({ success: false, error: 'Offer not found' }, 404);
    }
    return c.json({ success: true, data: serializeOffer(item) });
  } catch (err) {
    console.error('GET /api/affiliate-offers/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliate-offers - create
affiliateOffers.post('/api/affiliate-offers', requireRole('owner', 'admin'), async (c) => {
  auditLog(c, 'affiliate.offer.create', { kind: 'affiliate_offer' });
  try {
    const body = await c.req
      .json<{
        name?: string;
        description?: string | null;
        rewardAmount?: number;
        rewardMiles?: number;
        windowDays?: number;
        capTotal?: number | null;
        capMonthlyPerAffiliate?: number | null;
        receptionFrom?: string | null;
        receptionTo?: string | null;
        lineAccountId?: string | null;
        tagId?: string | null;
        scenarioId?: string | null;
        /** DRAFT-01: falseなら最初のINSERTから非公開。省略は従来どおり公開。 */
        isActive?: boolean;
        operationId?: string;
      }>()
      .catch(() => ({}) as Record<string, never>);

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }
    // 安定した操作UUID（#686）。commit後に応答だけ失われて再送されても、
    // packages/db 側が同じIDで既存行を回収するため二重登録にならない。
    const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : '';
    if (operationId && (operationId.length < 8 || operationId.length > 200)) {
      return c.json({ success: false, error: 'もう一度、最初からやり直してください' }, 400);
    }
    if (body.rewardAmount !== undefined && !isValidReward(body.rewardAmount)) {
      return c.json(
        { success: false, error: 'rewardAmount must be a non-negative integer' },
        400,
      );
    }
    if (body.rewardMiles !== undefined && !isValidReward(body.rewardMiles)) {
      return c.json(
        { success: false, error: 'rewardMiles must be a non-negative integer' },
        400,
      );
    }
    if (body.windowDays !== undefined && !isValidWindowDays(body.windowDays)) {
      return c.json(
        { success: false, error: 'windowDays must be an integer between 1 and 365' },
        400,
      );
    }
    if (!isValidCap(body.capTotal) || !isValidCap(body.capMonthlyPerAffiliate)) {
      return c.json(
        { success: false, error: 'cap must be a positive integer or null' },
        400,
      );
    }
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const lineAccountId = body.lineAccountId
      ?? (scope.allowedAccountIds.length === 1 ? scope.allowedAccountIds[0] : null);
    if (!lineAccountId) {
      // そのまま画面へ出す文言にする。複数アカウントのとき空欄で押すと
      // ここに来る（#505 重大1）。画面側でも押す前に選ばせている。
      return c.json({ success: false, error: 'LINEアカウントを選んでください' }, 400);
    }
    if (!scope.allowedAccountIds.includes(lineAccountId)) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const refError = await offerReferencesError(
      c.env.DB, { tagId: body.tagId, scenarioId: body.scenarioId }, lineAccountId,
    );
    if (refError) {
      return c.json({ success: false, error: refError }, 400);
    }

    const offer = await createAffiliateOffer(c.env.DB, {
      name,
      description: body.description ?? null,
      rewardAmount: body.rewardAmount,
      rewardMiles: body.rewardMiles,
      lineAccountId,
      tagId: body.tagId ?? null,
      scenarioId: body.scenarioId ?? null,
      isActive: body.isActive,
      operationId: operationId || undefined,
    });
    // 作った案件の決まりを初版として残す(#823)。版が無いと期間30日・上限なしの
    // 扱いになるため、値は今の案件と同じものを写す。
    await createOfferVersion(c.env.DB, {
      offerId: offer.id,
      rewardAmount: body.rewardAmount,
      rewardMiles: body.rewardMiles,
      windowDays: body.windowDays,
      capTotal: body.capTotal,
      capMonthlyPerAffiliate: body.capMonthlyPerAffiliate,
      receptionFrom: body.receptionFrom ?? null,
      receptionTo: body.receptionTo ?? null,
      createdBy: c.get('staff')?.id ?? null,
    });
    return c.json({ success: true, data: serializeOffer(offer) }, 201);
  } catch (err) {
    console.error('POST /api/affiliate-offers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/affiliate-offers/:id - update
affiliateOffers.put('/api/affiliate-offers/:id', requireRole('owner', 'admin'), async (c) => {
  auditLog(c, 'affiliate.offer.update', { kind: 'affiliate_offer', id: c.req.param('id') });
  try {
    const id = c.req.param('id');
    const body = await c.req
      .json<{
        name?: string;
        description?: string | null;
        rewardAmount?: number;
        rewardMiles?: number;
        windowDays?: number;
        capTotal?: number | null;
        capMonthlyPerAffiliate?: number | null;
        receptionFrom?: string | null;
        receptionTo?: string | null;
        lineAccountId?: string | null;
        tagId?: string | null;
        scenarioId?: string | null;
        isActive?: boolean;
      }>()
      .catch(() => ({}) as Record<string, never>);

    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
      return c.json({ success: false, error: 'name cannot be empty' }, 400);
    }
    if (body.rewardAmount !== undefined && !isValidReward(body.rewardAmount)) {
      return c.json(
        { success: false, error: 'rewardAmount must be a non-negative integer' },
        400,
      );
    }
    if (body.rewardMiles !== undefined && !isValidReward(body.rewardMiles)) {
      return c.json(
        { success: false, error: 'rewardMiles must be a non-negative integer' },
        400,
      );
    }
    if (body.windowDays !== undefined && !isValidWindowDays(body.windowDays)) {
      return c.json(
        { success: false, error: 'windowDays must be an integer between 1 and 365' },
        400,
      );
    }
    if (!isValidCap(body.capTotal) || !isValidCap(body.capMonthlyPerAffiliate)) {
      return c.json(
        { success: false, error: 'cap must be a positive integer or null' },
        400,
      );
    }
    if (body.lineAccountId === null) {
      return c.json({ success: false, error: 'lineAccountId cannot be empty' }, 400);
    }
    if (body.lineAccountId !== undefined
      && (!body.lineAccountId
        || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId]))) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    const existing = await getAffiliateOfferById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'Offer not found' }, 404);
    }
    const effectiveAccountId = body.lineAccountId ?? existing.line_account_id;
    if ((body.tagId || body.scenarioId) && !effectiveAccountId) {
      return c.json({ success: false, error: '案件のLINEアカウントを選んでください' }, 400);
    }
    const refError = effectiveAccountId
      ? await offerReferencesError(
        c.env.DB,
        { tagId: body.tagId, scenarioId: body.scenarioId },
        effectiveAccountId,
      )
      : null;
    if (refError) {
      return c.json({ success: false, error: refError }, 400);
    }

    // 報酬・期間・上限・受付の変更は、決まりの新しい版として残す(#823)。
    // 版を先に作り、失敗したら案件の値も変えない。版が無い昔の案件は、
    // この保存で初版が生まれる。
    if (body.rewardAmount !== undefined || body.rewardMiles !== undefined
      || body.windowDays !== undefined || body.capTotal !== undefined
      || body.capMonthlyPerAffiliate !== undefined
      || body.receptionFrom !== undefined || body.receptionTo !== undefined) {
      await createOfferVersion(c.env.DB, {
        offerId: id,
        rewardAmount: body.rewardAmount,
        rewardMiles: body.rewardMiles,
        windowDays: body.windowDays,
        capTotal: body.capTotal,
        capMonthlyPerAffiliate: body.capMonthlyPerAffiliate,
        receptionFrom: body.receptionFrom,
        receptionTo: body.receptionTo,
        createdBy: c.get('staff')?.id ?? null,
      });
    }

    const updated = await updateAffiliateOffer(c.env.DB, id, {
      name: body.name !== undefined ? body.name.trim() : undefined,
      description: body.description,
      reward_amount: body.rewardAmount,
      reward_miles: body.rewardMiles,
      line_account_id: body.lineAccountId,
      tag_id: body.tagId,
      scenario_id: body.scenarioId,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Offer not found' }, 404);
    }
    return c.json({ success: true, data: serializeOffer(updated) });
  } catch (err) {
    console.error('PUT /api/affiliate-offers/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

function serializeOfferVersion(row: AffiliateOfferVersion) {
  return {
    id: row.id,
    offerId: row.offer_id,
    versionNumber: row.version_number,
    rewardAmount: row.reward_amount,
    rewardMiles: row.reward_miles,
    windowDays: row.window_days,
    capTotal: row.cap_total,
    capMonthlyPerAffiliate: row.cap_monthly_per_affiliate,
    receptionFrom: row.reception_from,
    receptionTo: row.reception_to,
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
  };
}

function isValidWindowDays(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 365;
}

function isValidCap(v: unknown): v is number | null | undefined {
  return v === undefined
    || v === null
    || (typeof v === 'number' && Number.isInteger(v) && v > 0);
}

// GET /api/affiliate-offers/:id/versions - 決まりの版の履歴(新しい順)
affiliateOffers.get('/api/affiliate-offers/:id/versions', async (c) => {
  try {
    const versions = await listOfferVersions(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: versions.map(serializeOfferVersion) });
  } catch (err) {
    console.error('GET /api/affiliate-offers/:id/versions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliate-offers/:id/cap-status - 今の決まりと上限の残り
affiliateOffers.get('/api/affiliate-offers/:id/cap-status', async (c) => {
  try {
    const id = c.req.param('id');
    const version = await getCurrentOfferVersion(c.env.DB, id);
    const status = await getOfferCapStatus(c.env.DB, id, {
      affiliateId: c.req.query('affiliateId') || undefined,
    });
    return c.json({
      success: true,
      data: {
        version: version ? serializeOfferVersion(version) : null,
        capped: status.capped,
        capTotal: status.capTotal,
        totalUsed: status.totalUsed,
        totalRemaining: status.totalRemaining,
        capMonthlyPerAffiliate: status.capMonthlyPerAffiliate,
        monthlyUsed: status.monthlyUsed,
        monthlyRemaining: status.monthlyRemaining,
      },
    });
  } catch (err) {
    console.error('GET /api/affiliate-offers/:id/cap-status error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliate-offers/:id/versions - 決まりの新しい版を保存
affiliateOffers.post('/api/affiliate-offers/:id/versions', requireRole('owner', 'admin'), async (c) => {
  auditLog(c, 'affiliate.offer.version.create', { kind: 'affiliate_offer', id: c.req.param('id') });
  try {
    const body = await c.req
      .json<{
        rewardAmount?: number;
        rewardMiles?: number;
        windowDays?: number;
        capTotal?: number | null;
        capMonthlyPerAffiliate?: number | null;
        receptionFrom?: string | null;
        receptionTo?: string | null;
        effectiveFrom?: string | null;
        idempotencyKey?: string;
      }>()
      .catch(() => ({}) as Record<string, never>);

    if (body.rewardAmount !== undefined && !isValidReward(body.rewardAmount)) {
      return c.json(
        { success: false, error: 'rewardAmount must be a non-negative integer' },
        400,
      );
    }
    if (body.rewardMiles !== undefined && !isValidReward(body.rewardMiles)) {
      return c.json(
        { success: false, error: 'rewardMiles must be a non-negative integer' },
        400,
      );
    }
    if (body.windowDays !== undefined && !isValidWindowDays(body.windowDays)) {
      return c.json(
        { success: false, error: 'windowDays must be an integer between 1 and 365' },
        400,
      );
    }
    if (!isValidCap(body.capTotal) || !isValidCap(body.capMonthlyPerAffiliate)) {
      return c.json(
        { success: false, error: 'cap must be a positive integer or null' },
        400,
      );
    }
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 200)) {
      return c.json({ success: false, error: 'もう一度、最初からやり直してください' }, 400);
    }

    const version = await createOfferVersion(c.env.DB, {
      offerId: c.req.param('id'),
      rewardAmount: body.rewardAmount,
      rewardMiles: body.rewardMiles,
      windowDays: body.windowDays,
      capTotal: body.capTotal,
      capMonthlyPerAffiliate: body.capMonthlyPerAffiliate,
      receptionFrom: body.receptionFrom ?? null,
      receptionTo: body.receptionTo ?? null,
      effectiveFrom: body.effectiveFrom ?? null,
      createdBy: c.get('staff')?.id ?? null,
      idempotencyKey: idempotencyKey || undefined,
    });
    return c.json({ success: true, data: serializeOfferVersion(version) }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'offer not found') {
      return c.json({ success: false, error: 'Offer not found' }, 404);
    }
    if (err instanceof Error && /windowDays|cap/.test(err.message)) {
      return c.json({ success: false, error: err.message }, 400);
    }
    console.error('POST /api/affiliate-offers/:id/versions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { affiliateOffers };
