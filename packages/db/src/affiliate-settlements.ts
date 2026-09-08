export type AffiliateLifecycle = 'active' | 'paused' | 'archived';

export interface AffiliateArchiveImpact {
  affiliateId: string;
  affiliateName: string;
  lifecycle: AffiliateLifecycle;
  activeLinks: number;
  unsettledConversions: number;
  unsettledReward: number;
  pendingConversions: number;
  checkedAt: string;
}

export interface AffiliateSettlementBreakdown {
  offerName: string;
  conversions: number;
  unitReward: number | null;
  subtotal: number;
}

export interface AffiliateSettlementPreview {
  affiliateId: string;
  affiliateName: string;
  code: string;
  amount: number;
  conversionCount: number;
  periodFrom: string | null;
  periodTo: string;
  closeDate: null;
  paymentDate: null;
  bankDestination: null;
  breakdown: AffiliateSettlementBreakdown[];
}

export type AffiliateRewardFormula = 'rate' | 'fixed';

export interface AffiliateRewardCalculation {
  id: string;
  organizationId: string;
  lineAccountId: string;
  affiliateId: string;
  conversionEventId: string;
  offerId: string | null;
  formula: AffiliateRewardFormula | 'legacy';
  commissionRateSnapshot: number | null;
  baseAmountSnapshot: number | null;
  fixedRewardSnapshot: number | null;
  offerNameSnapshot: string;
  amountMinor: number;
  currency: 'JPY';
  createdAt: string;
}

interface SettlementEntry {
  conversionEventId: string;
  offerId: string | null;
  offerName: string;
  approvedAt: string;
  amount: number;
  formula: AffiliateRewardFormula;
  commissionRate: number | null;
  baseAmount: number | null;
  fixedReward: number | null;
}

interface SettlementPreviewInternal extends AffiliateSettlementPreview {
  entries: SettlementEntry[];
}

const REWARD_SQL = `ROUND(CASE
  WHEN a.commission_rate > 0
    THEN COALESCE(ce.value_snapshot, cp.value, 0) * a.commission_rate / 100.0
  ELSE COALESCE(off.reward_amount, 0)
END)`;

async function settlementEntries(
  db: D1Database,
  affiliateId: string,
  lineAccountId: string,
  now: string,
): Promise<{ affiliateName: string; code: string; entries: SettlementEntry[] } | null> {
  const affiliate = await db.prepare(
    `SELECT id, name, code
       FROM affiliates
      WHERE id = ? AND line_account_id = ?`,
  ).bind(affiliateId, lineAccountId).first<{ id: string; name: string; code: string }>();
  if (!affiliate) return null;

  const result = await db.prepare(
    `SELECT ce.id AS conversion_event_id,
            off.id AS offer_id,
            COALESCE(off.name, ce.point_name_snapshot, cp.name, '成果地点を取得できませんでした') AS offer_name,
            ce.approved_at,
            a.commission_rate AS commission_rate,
            ce.value_snapshot AS value_snapshot,
            cp.value AS point_value,
            off.reward_amount AS fixed_reward,
            ${REWARD_SQL} AS reward_amount
       FROM conversion_events ce
       JOIN affiliates a ON a.id = ? AND a.line_account_id = ?
       JOIN friends f ON f.id = ce.friend_id AND f.line_account_id = ?
       LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id AND cp.line_account_id = ?
       LEFT JOIN affiliate_links al
         ON al.ref_code = ce.attributed_ref_code
        AND al.affiliate_id = a.id
        AND al.line_account_id = ?
       LEFT JOIN affiliate_offers off ON off.id = al.offer_id AND off.line_account_id = ?
      WHERE (ce.affiliate_id = a.id OR (ce.affiliate_id IS NULL AND ce.affiliate_code = a.code))
        AND COALESCE(ce.approval_status, 'pending') = 'approved'
        AND ce.approved_at IS NOT NULL
        AND (
          COALESCE(a.hold_days, 0) = 0
          OR julianday(ce.approved_at) <= julianday(?, '-' || a.hold_days || ' days')
        )
        AND NOT EXISTS (
          SELECT 1
            FROM affiliate_reward_entries re
           WHERE re.conversion_event_id = ce.id AND re.entry_type = 'credit'
        )
      ORDER BY ce.approved_at ASC, ce.id ASC`,
  ).bind(
    affiliateId,
    lineAccountId,
    lineAccountId,
    lineAccountId,
    lineAccountId,
    lineAccountId,
    now,
  ).all<{
    conversion_event_id: string;
    offer_id: string | null;
    offer_name: string;
    approved_at: string;
    commission_rate: number | null;
    value_snapshot: number | null;
    point_value: number | null;
    fixed_reward: number | null;
    reward_amount: number;
  }>();

  return {
    affiliateName: affiliate.name,
    code: affiliate.code,
    entries: result.results
      .map((row) => {
        const rate = row.commission_rate === null ? 0 : Number(row.commission_rate);
        const formula: AffiliateRewardFormula = rate > 0 ? 'rate' : 'fixed';
        return {
          conversionEventId: row.conversion_event_id,
          offerId: row.offer_id,
          offerName: row.offer_name,
          approvedAt: row.approved_at,
          amount: Math.round(Number(row.reward_amount)),
          formula,
          commissionRate: formula === 'rate' ? rate : null,
          baseAmount: formula === 'rate'
            ? Number(row.value_snapshot ?? row.point_value ?? 0)
            : null,
          fixedReward: formula === 'fixed'
            ? Math.round(Number(row.fixed_reward ?? 0))
            : null,
        };
      })
      .filter((entry) => entry.amount > 0),
  };
}

export async function getAffiliateArchiveImpact(
  db: D1Database,
  input: { tenantId: string; affiliateId: string; lineAccountId: string; now?: string },
): Promise<AffiliateArchiveImpact | null> {
  const now = input.now ?? new Date().toISOString();
  const row = await db.prepare(
    `SELECT a.id,
            a.name,
            COALESCE(a.lifecycle_status, CASE WHEN a.is_active = 1 THEN 'active' ELSE 'paused' END) AS lifecycle,
            (SELECT COUNT(*) FROM affiliate_links al
              WHERE al.affiliate_id = a.id AND al.line_account_id = a.line_account_id AND al.is_active = 1) AS active_links,
            (SELECT COUNT(*) FROM conversion_events ce
               JOIN friends f ON f.id = ce.friend_id AND f.line_account_id = a.line_account_id
              WHERE (ce.affiliate_id = a.id OR (ce.affiliate_id IS NULL AND ce.affiliate_code = a.code))
                AND COALESCE(ce.approval_status, 'pending') = 'pending') AS pending_conversions
       FROM affiliates a
      WHERE a.id = ? AND a.tenant_id = ? AND a.line_account_id = ?`,
  ).bind(input.affiliateId, input.tenantId, input.lineAccountId).first<{
    id: string;
    name: string;
    lifecycle: AffiliateLifecycle;
    active_links: number;
    pending_conversions: number;
  }>();
  if (!row) return null;

  const payment = await settlementEntries(db, input.affiliateId, input.lineAccountId, now);
  const entries = payment?.entries ?? [];
  return {
    affiliateId: row.id,
    affiliateName: row.name,
    lifecycle: row.lifecycle,
    activeLinks: Number(row.active_links),
    unsettledConversions: entries.length,
    unsettledReward: entries.reduce((sum, entry) => sum + entry.amount, 0),
    pendingConversions: Number(row.pending_conversions),
    checkedAt: now,
  };
}

export async function updateAffiliateLifecycle(
  db: D1Database,
  input: {
    tenantId: string;
    affiliateId: string;
    lineAccountId: string;
    lifecycle: Exclude<AffiliateLifecycle, 'active'>;
    now?: string;
  },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE affiliates
        SET is_active = 0,
            lifecycle_status = ?,
            archived_at = CASE WHEN ? = 'archived' THEN ? ELSE archived_at END
      WHERE id = ? AND tenant_id = ? AND line_account_id = ?`,
  ).bind(
    input.lifecycle,
    input.lifecycle,
    input.now ?? new Date().toISOString(),
    input.affiliateId,
    input.tenantId,
    input.lineAccountId,
  ).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function previewAffiliateSettlement(
  db: D1Database,
  input: { affiliateId: string; lineAccountId: string; now?: string },
): Promise<SettlementPreviewInternal | null> {
  const now = input.now ?? new Date().toISOString();
  const result = await settlementEntries(db, input.affiliateId, input.lineAccountId, now);
  if (!result) return null;

  const byOffer = new Map<string, { conversions: number; subtotal: number; amounts: Set<number> }>();
  for (const entry of result.entries) {
    const current = byOffer.get(entry.offerName) ?? { conversions: 0, subtotal: 0, amounts: new Set<number>() };
    current.conversions += 1;
    current.subtotal += entry.amount;
    current.amounts.add(entry.amount);
    byOffer.set(entry.offerName, current);
  }
  const dates = result.entries.map((entry) => entry.approvedAt).sort();
  return {
    affiliateId: input.affiliateId,
    affiliateName: result.affiliateName,
    code: result.code,
    amount: result.entries.reduce((sum, entry) => sum + entry.amount, 0),
    conversionCount: result.entries.length,
    periodFrom: dates[0] ?? null,
    periodTo: now,
    closeDate: null,
    paymentDate: null,
    bankDestination: null,
    breakdown: Array.from(byOffer, ([offerName, value]) => ({
      offerName,
      conversions: value.conversions,
      unitReward: value.amounts.size === 1 ? Array.from(value.amounts)[0] : null,
      subtotal: value.subtotal,
    })),
    entries: result.entries,
  };
}

export type ConfirmAffiliateSettlementResult =
  | { kind: 'created' | 'duplicate'; settlementId: string; amount: number; conversionCount: number; closedAt: string }
  | { kind: 'not_found' | 'empty' | 'changed' };

export async function confirmAffiliateSettlement(
  db: D1Database,
  input: {
    tenantId: string;
    lineAccountId: string;
    affiliateId: string;
    actorId: string;
    idempotencyKey: string;
    expectedAmount: number;
    now?: string;
  },
): Promise<ConfirmAffiliateSettlementResult> {
  const existing = await db.prepare(
    `SELECT id, total_amount_minor, closed_at,
            (SELECT COUNT(*) FROM affiliate_settlement_lines WHERE settlement_id = affiliate_settlements.id) AS line_count
       FROM affiliate_settlements
      WHERE organization_id = ? AND line_account_id = ? AND idempotency_key = ?`,
  ).bind(input.tenantId, input.lineAccountId, input.idempotencyKey).first<{
    id: string;
    total_amount_minor: number;
    closed_at: string;
    line_count: number;
  }>();
  if (existing) {
    return {
      kind: 'duplicate',
      settlementId: existing.id,
      amount: Number(existing.total_amount_minor),
      conversionCount: Number(existing.line_count),
      closedAt: existing.closed_at,
    };
  }

  const now = input.now ?? new Date().toISOString();
  const preview = await previewAffiliateSettlement(db, {
    affiliateId: input.affiliateId,
    lineAccountId: input.lineAccountId,
    now,
  });
  if (!preview) return { kind: 'not_found' };
  if (preview.entries.length === 0) return { kind: 'empty' };
  if (preview.amount !== input.expectedAmount) return { kind: 'changed' };

  const settlementId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO affiliate_settlements
         (id, organization_id, line_account_id, affiliate_id, period_from, period_to,
          timezone, currency, total_amount_minor, state, closed_by, version,
          idempotency_key, closed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'Asia/Tokyo', 'JPY', ?, 'partial', ?, 1, ?, ?, ?)`,
    ).bind(
      settlementId,
      input.tenantId,
      input.lineAccountId,
      input.affiliateId,
      preview.periodFrom ?? now,
      preview.periodTo,
      preview.amount,
      input.actorId,
      input.idempotencyKey,
      now,
      now,
    ),
  ];

  for (const entry of preview.entries) {
    const entryId = crypto.randomUUID();
    const calculationId = `calc:${settlementId}:${entry.conversionEventId}`;
    statements.push(
      db.prepare(
        `INSERT INTO affiliate_reward_calculations
           (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
            offer_id, formula, commission_rate_snapshot, base_amount_snapshot,
            fixed_reward_snapshot, offer_name_snapshot, amount_minor, currency, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'JPY', ?)`,
      ).bind(
        calculationId,
        input.tenantId,
        input.lineAccountId,
        input.affiliateId,
        entry.conversionEventId,
        entry.offerId,
        entry.formula,
        entry.commissionRate,
        entry.baseAmount,
        entry.fixedReward,
        entry.offerName,
        entry.amount,
        now,
      ),
      db.prepare(
        `INSERT INTO affiliate_reward_entries
           (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
            offer_id, reward_calculation_id, entry_type, amount_minor, currency, status, approved_at,
            payable_at, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'credit', ?, 'JPY', 'settled', ?, ?, ?, ?)`,
      ).bind(
        entryId,
        input.tenantId,
        input.lineAccountId,
        input.affiliateId,
        entry.conversionEventId,
        entry.offerId,
        calculationId,
        entry.amount,
        entry.approvedAt,
        now,
        `settlement:${settlementId}:${entry.conversionEventId}`,
        now,
      ),
      db.prepare(
        `INSERT INTO affiliate_settlement_lines
           (id, settlement_id, affiliate_id, entry_id, amount_minor, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'included', ?)`,
      ).bind(
        crypto.randomUUID(),
        settlementId,
        input.affiliateId,
        entryId,
        entry.amount,
        now,
      ),
    );
  }

  await db.batch(statements);
  return {
    kind: 'created',
    settlementId,
    amount: preview.amount,
    conversionCount: preview.entries.length,
    closedAt: now,
  };
}
