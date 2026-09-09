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
  /** 承認時(または移行)に作られた版。金額・条件・対象はここだけから読む。 */
  calculationId: string;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 承認された成果の報酬計算根拠を版として固定する共通関数。
 *
 * 承認フロー(affiliate-offers の setConversionApproval)と締めフロー(個別・全体)
 * が同じ式・同じ入力で金額を読むための正本。承認時に作られた版があれば
 * 締め・表示はそれを優先し、承認後・締め前の設定編集で金額/条件/対象が
 * 変わらないようにする。
 *
 * 版を作れない曖昧な状態(所属の不整合・組織の未解決・既に確定済み)は
 * null を返し、偽の版を作らない。版が無い行は締め・支払い・レポートの
 * どこからも金額として出ない(fail-closed。現在値では計算しない)。
 */
export async function ensureConversionRewardSnapshot(
  db: D1Database,
  eventId: string,
  now = new Date().toISOString(),
): Promise<AffiliateRewardCalculation | null> {
  const row = await db.prepare(
    `SELECT ce.id AS conversion_event_id,
            ce.value_snapshot AS value_snapshot,
            a.id AS affiliate_id,
            a.name AS affiliate_name,
            a.code AS affiliate_code,
            a.commission_rate AS commission_rate,
            a.tenant_id AS tenant_id,
            a.line_account_id AS affiliate_account_id,
            f.line_account_id AS friend_account_id,
            cp.value AS point_value,
            cp.line_account_id AS point_account_id,
            al.line_account_id AS link_account_id,
            off.line_account_id AS offer_account_id,
            off.id AS offer_id,
            COALESCE(off.name, ce.point_name_snapshot, cp.name, '') AS offer_name,
            off.reward_amount AS fixed_reward
       FROM conversion_events ce
       JOIN affiliates a ON a.id = ce.affiliate_id
       JOIN friends f ON f.id = ce.friend_id
       LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id
       LEFT JOIN affiliate_links al
         ON al.ref_code = ce.attributed_ref_code
        AND al.affiliate_id = a.id
       LEFT JOIN affiliate_offers off ON off.id = al.offer_id
      WHERE ce.id = ?
        AND ce.affiliate_id IS NOT NULL
        AND COALESCE(ce.approval_status, 'pending') = 'approved'`,
  ).bind(eventId).first<{
    conversion_event_id: string;
    value_snapshot: number | null;
    affiliate_id: string;
    affiliate_name: string;
    affiliate_code: string;
    commission_rate: number | null;
    tenant_id: string | null;
    affiliate_account_id: string | null;
    friend_account_id: string | null;
    point_value: number | null;
    point_account_id: string | null;
    link_account_id: string | null;
    offer_account_id: string | null;
    offer_id: string | null;
    offer_name: string;
    fixed_reward: number | null;
  }>();
  if (!row || !row.affiliate_account_id) return null;
  // 版に入る入力(友だち・成果地点・リンク・案件)は、すべて紹介者と同じ
  // LINE公式アカウントのものでなければならない。1つでも別アカウントの行が
  // 混ざったら版を作らない(fail-closed)。版が無い行は締め・支払い・レポートの
  // どこからも金額として出ないため、別アカウントの金額が確定へ回らない。
  const accountId = row.affiliate_account_id;
  if (row.friend_account_id !== accountId) return null;
  if (row.point_account_id !== null && row.point_account_id !== accountId) return null;
  if (row.link_account_id !== null && row.link_account_id !== accountId) return null;
  if (row.offer_account_id !== null && row.offer_account_id !== accountId) return null;
  // 所有tenantが決まらない行は版を作らない(fail-closed)。移行でaccountから
  // 決定できる行は埋めてあるため、ここに残るNULLは本当に曖昧な行。
  const organizationId = row.tenant_id;
  if (!organizationId) return null;

  const existing = await db.prepare(
    `SELECT id, organization_id, line_account_id, affiliate_id, conversion_event_id,
            offer_id, formula, commission_rate_snapshot, base_amount_snapshot,
            fixed_reward_snapshot, offer_name_snapshot, amount_minor, currency, created_at
       FROM affiliate_reward_calculations
      WHERE conversion_event_id = ?`,
  ).bind(eventId).first<{
    id: string; organization_id: string; line_account_id: string; affiliate_id: string;
    conversion_event_id: string; offer_id: string | null; formula: AffiliateRewardFormula | 'legacy';
    commission_rate_snapshot: number | null; base_amount_snapshot: number | null;
    fixed_reward_snapshot: number | null; offer_name_snapshot: string;
    amount_minor: number; currency: 'JPY'; created_at: string;
  }>();
  if (existing) {
    return {
      id: existing.id, organizationId: existing.organization_id, lineAccountId: existing.line_account_id,
      affiliateId: existing.affiliate_id, conversionEventId: existing.conversion_event_id,
      offerId: existing.offer_id, formula: existing.formula,
      commissionRateSnapshot: existing.commission_rate_snapshot,
      baseAmountSnapshot: existing.base_amount_snapshot,
      fixedRewardSnapshot: existing.fixed_reward_snapshot,
      offerNameSnapshot: existing.offer_name_snapshot, amountMinor: Number(existing.amount_minor),
      currency: existing.currency, createdAt: existing.created_at,
    };
  }
  // 既に確定済みの成果は作り直さない(確定時の版が正本)。
  const settled = await db.prepare(
    `SELECT 1 FROM affiliate_reward_entries WHERE conversion_event_id = ? AND entry_type = 'credit'`,
  ).bind(eventId).first<{ 1: number }>();
  if (settled) return null;

  const rate = row.commission_rate === null ? 0 : Number(row.commission_rate);
  const formula: AffiliateRewardFormula = rate > 0 ? 'rate' : 'fixed';
  const baseAmount = formula === 'rate' ? Number(row.value_snapshot ?? row.point_value ?? 0) : null;
  const fixedReward = formula === 'fixed' ? Math.round(Number(row.fixed_reward ?? 0)) : null;
  const amount = formula === 'rate'
    ? Math.round(baseAmount! * rate / 100)
    : fixedReward!;
  // 0円も版として保存する。保存しないと後から案件額を上げたときに
  // 過去分のプレビューが上がってしまう。締め対象からは別途(amount>0で)外す。
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO affiliate_reward_calculations
         (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
          offer_id, formula, commission_rate_snapshot, base_amount_snapshot,
          fixed_reward_snapshot, offer_name_snapshot, amount_minor, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'JPY', ?)`,
    ).bind(
      id, organizationId, row.affiliate_account_id, row.affiliate_id, eventId,
      row.offer_id, formula, formula === 'rate' ? rate : null, baseAmount, fixedReward,
      row.offer_name, amount, now,
    ).run();
  } catch (error) {
    // 並行する承認が先に版を作った場合は、その版へ回収する(冪等)。
    if (!/UNIQUE|constraint|busy|locked/i.test(error instanceof Error ? error.message : String(error))) throw error;
    const winner = await db.prepare(
      `SELECT id, organization_id, line_account_id, affiliate_id, conversion_event_id,
              offer_id, formula, commission_rate_snapshot, base_amount_snapshot,
              fixed_reward_snapshot, offer_name_snapshot, amount_minor, currency, created_at
         FROM affiliate_reward_calculations
        WHERE conversion_event_id = ?`,
    ).bind(eventId).first<{
      id: string; organization_id: string; line_account_id: string; affiliate_id: string;
      conversion_event_id: string; offer_id: string | null; formula: AffiliateRewardFormula | 'legacy';
      commission_rate_snapshot: number | null; base_amount_snapshot: number | null;
      fixed_reward_snapshot: number | null; offer_name_snapshot: string;
      amount_minor: number; currency: 'JPY'; created_at: string;
    }>();
    if (!winner) return null;
    return {
      id: winner.id, organizationId: winner.organization_id, lineAccountId: winner.line_account_id,
      affiliateId: winner.affiliate_id, conversionEventId: winner.conversion_event_id,
      offerId: winner.offer_id, formula: winner.formula,
      commissionRateSnapshot: winner.commission_rate_snapshot,
      baseAmountSnapshot: winner.base_amount_snapshot,
      fixedRewardSnapshot: winner.fixed_reward_snapshot,
      offerNameSnapshot: winner.offer_name_snapshot, amountMinor: Number(winner.amount_minor),
      currency: winner.currency, createdAt: winner.created_at,
    };
  }
  return {
    id, organizationId, lineAccountId: row.affiliate_account_id, affiliateId: row.affiliate_id,
    conversionEventId: eventId, offerId: row.offer_id, formula,
    commissionRateSnapshot: formula === 'rate' ? rate : null, baseAmountSnapshot: baseAmount,
    fixedRewardSnapshot: fixedReward, offerNameSnapshot: row.offer_name, amountMinor: amount,
    currency: 'JPY', createdAt: now,
  };
}

export interface AffiliateRewardReversal {
  /** 取り消された確定(credit)のentry。 */
  creditEntryId: string;
  /** 相殺のために起こしたdebit entry。 */
  reversalEntryId: string;
  amountMinor: number;
}

/**
 * 確定済みの成果が後から取り消されたときの反対仕訳。
 *
 * 締めが終わった金額は「その時点で約束した額」なので、確定を消して
 * なかったことにはしない(締めの合計が後から変わると説明できなくなる)。
 * 代わりに同額のdebitを起こし、元のcreditを reversed にする。支払い画面の
 * 確定済みはcredit - debitで相殺され、締めの記録はそのまま残る。
 *
 * 書込みは fence 付き: 成果が本当に rejected のときだけ起票する。debitは
 * 成果ごとに1件(UNIQUE)なので、二重押し・再送では既存の反対仕訳へ回収する。
 */
export async function reverseSettledRewardOnRejection(
  db: D1Database,
  eventId: string,
  now = new Date().toISOString(),
): Promise<AffiliateRewardReversal | null> {
  const credit = await db.prepare(
    `SELECT re.id AS id
       FROM affiliate_reward_entries re
       JOIN conversion_events ce ON ce.id = re.conversion_event_id
      WHERE re.conversion_event_id = ?
        AND re.entry_type = 'credit'
        AND re.status <> 'reversed'
        AND COALESCE(ce.approval_status, 'pending') = 'rejected'`,
  ).bind(eventId).first<{ id: string }>();
  if (!credit) return null;

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO affiliate_reward_entries
           (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
            offer_id, reward_calculation_id, entry_type, amount_minor, currency, status,
            approved_at, payable_at, idempotency_key, created_at)
         SELECT ?, re.organization_id, re.line_account_id, re.affiliate_id, re.conversion_event_id,
                re.offer_id, re.reward_calculation_id, 'debit', re.amount_minor, re.currency,
                'reversed', re.approved_at, NULL, ?, ?
           FROM affiliate_reward_entries re
           JOIN conversion_events ce ON ce.id = re.conversion_event_id
          WHERE re.id = ?
            AND re.entry_type = 'credit'
            AND re.status <> 'reversed'
            AND COALESCE(ce.approval_status, 'pending') = 'rejected'`,
      ).bind(crypto.randomUUID(), `reversal:${credit.id}`, now, credit.id),
      db.prepare(
        `UPDATE affiliate_reward_entries
            SET status = 'reversed'
          WHERE id = ?
            AND status <> 'reversed'
            AND EXISTS (
              SELECT 1 FROM affiliate_reward_entries d
               WHERE d.conversion_event_id = affiliate_reward_entries.conversion_event_id
                 AND d.entry_type = 'debit'
            )`,
      ).bind(credit.id),
    ]);
  } catch (error) {
    // 並行する取消が先に反対仕訳を書いた場合は、その結果へ回収する(冪等)。
    if (!/UNIQUE|constraint|busy|locked/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }

  const reversal = await db.prepare(
    `SELECT id, amount_minor FROM affiliate_reward_entries
      WHERE conversion_event_id = ? AND entry_type = 'debit'`,
  ).bind(eventId).first<{ id: string; amount_minor: number }>();
  if (!reversal) return null;
  return {
    creditEntryId: credit.id,
    reversalEntryId: reversal.id,
    amountMinor: Number(reversal.amount_minor),
  };
}

interface SettlementPreviewInternal extends AffiliateSettlementPreview {
  entries: SettlementEntry[];
}

/** 締めで1件確定する対象。読取時に決まり、書込み時にもう一度照合される。 */
export interface SettlementWriteTarget {
  conversionEventId: string;
  affiliateId: string;
  calculationId: string;
  amount: number;
  approvedAt: string;
}

/**
 * 個別締めと全体締めが共有する「書込み時fence」。
 *
 * 対象を読んでから確定を書くまでの間に、別の接続が承認を取り消したり、
 * 対象を別アカウントへ移したり、先に確定したりできる。読取時の検査だけでは
 * その隙を塞げないため、確定の書込みそのものを条件付きにする:
 *
 * - 明細(credit)のINSERTは `INSERT ... SELECT` で、書込みの瞬間に
 *   承認状態・承認時刻・紹介者のtenant/account・友だちのaccount・版の
 *   所属と金額・未確定であることを、すべて満たす行だけを書く。
 * - 締め明細行は、その credit が実際に書けたときだけ書く。
 * - 最後の3文で「書けた件数が想定と違うなら、この確定をまるごと取り消す」。
 *   D1のbatchは1トランザクションなので、部分確定は残らない。
 *
 * 呼出側はbatchの後にheaderの存在を読み、消えていれば `changed` を返す。
 * 途中で失敗した確定は「何も起きなかった」状態になり、操作者は最新の
 * プレビューを取り直してやり直せる。
 */
export function settlementWriteStatements(
  db: D1Database,
  input: {
    tenantId: string;
    lineAccountId: string;
    settlementId: string;
    targets: SettlementWriteTarget[];
    now: string;
  },
): D1PreparedStatement[] {
  const entryKeyPrefix = `settlement:${input.settlementId}:`;
  const statements: D1PreparedStatement[] = [];
  for (const target of input.targets) {
    const entryId = crypto.randomUUID();
    statements.push(
      db.prepare(
        `INSERT INTO affiliate_reward_entries
           (id, organization_id, line_account_id, affiliate_id, conversion_event_id,
            offer_id, reward_calculation_id, entry_type, amount_minor, currency, status,
            approved_at, payable_at, idempotency_key, created_at)
         SELECT ?, a.tenant_id, a.line_account_id, a.id, ce.id,
                calc.offer_id, calc.id, 'credit', calc.amount_minor, 'JPY', 'settled',
                ce.approved_at, ?, ?, ?
           FROM conversion_events ce
           JOIN affiliates a
             ON a.id = ?
            AND a.tenant_id = ?
            AND a.line_account_id = ?
            AND (ce.affiliate_id = a.id OR (ce.affiliate_id IS NULL AND ce.affiliate_code = a.code))
           JOIN friends f ON f.id = ce.friend_id AND f.line_account_id = a.line_account_id
           JOIN affiliate_reward_calculations calc
             ON calc.id = ?
            AND calc.conversion_event_id = ce.id
            AND calc.organization_id = a.tenant_id
            AND calc.line_account_id = a.line_account_id
            AND calc.affiliate_id = a.id
            AND calc.amount_minor = ?
          WHERE ce.id = ?
            AND COALESCE(ce.approval_status, 'pending') = 'approved'
            AND ce.approved_at IS ?
            AND NOT EXISTS (
              SELECT 1 FROM affiliate_reward_entries re
               WHERE re.conversion_event_id = ce.id AND re.entry_type = 'credit'
            )`,
      ).bind(
        entryId,
        input.now,
        `${entryKeyPrefix}${target.conversionEventId}`,
        input.now,
        target.affiliateId,
        input.tenantId,
        input.lineAccountId,
        target.calculationId,
        target.amount,
        target.conversionEventId,
        target.approvedAt,
      ),
      db.prepare(
        `INSERT INTO affiliate_settlement_lines
           (id, settlement_id, affiliate_id, entry_id, amount_minor, status, created_at)
         SELECT ?, ?, re.affiliate_id, re.id, re.amount_minor, 'included', ?
           FROM affiliate_reward_entries re
          WHERE re.id = ?`,
      ).bind(crypto.randomUUID(), input.settlementId, input.now, entryId),
    );
  }

  // 巻き戻しの3文。fenceを通らなかった対象が1件でもあれば、この確定で
  // 書いた明細行 → credit → header の順に消す(子から先に消してFKを壊さない)。
  // 述語はいずれも「自分が消す表」を数えないため、途中経過に左右されない。
  const writtenEntries =
    `(SELECT COUNT(*) FROM affiliate_reward_entries re
       WHERE substr(re.idempotency_key, 1, ?) = ?)`;
  const noLinesLeft =
    `NOT EXISTS (SELECT 1 FROM affiliate_settlement_lines sl WHERE sl.settlement_id = ?)`;
  statements.push(
    db.prepare(
      `DELETE FROM affiliate_settlement_lines
        WHERE settlement_id = ? AND ${writtenEntries} <> ?`,
    ).bind(input.settlementId, entryKeyPrefix.length, entryKeyPrefix, input.targets.length),
    db.prepare(
      `DELETE FROM affiliate_reward_entries
        WHERE substr(idempotency_key, 1, ?) = ? AND ${noLinesLeft}`,
    ).bind(entryKeyPrefix.length, entryKeyPrefix, input.settlementId),
    db.prepare(
      `DELETE FROM affiliate_settlements WHERE id = ? AND ${noLinesLeft}`,
    ).bind(input.settlementId, input.settlementId),
  );
  return statements;
}

/** 巻き戻しの3文が走った(=fenceで確定が取り消された)かどうかを読む。 */
export async function settlementSurvived(
  db: D1Database,
  settlementId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS ok FROM affiliate_settlements WHERE id = ?`,
  ).bind(settlementId).first<{ ok: number }>();
  return row !== null;
}

async function settlementEntries(
  db: D1Database,
  affiliateId: string,
  lineAccountId: string,
  tenantId: string,
  now: string,
): Promise<{ affiliateName: string; code: string; entries: SettlementEntry[] } | null> {
  // 呼出側の tenant を盲信せず、紹介者行の所属で厳密に検証する(fail-closed)。
  // 移行で所有tenantを決定済みのため、NULLは曖昧な行として遮断する。
  const affiliate = await db.prepare(
    `SELECT id, name, code
       FROM affiliates
      WHERE id = ? AND line_account_id = ? AND tenant_id = ?`,
  ).bind(affiliateId, lineAccountId, tenantId).first<{ id: string; name: string; code: string }>();
  if (!affiliate) return null;

  // 締めは承認時の版だけを使う。版が無い承認済み行は対象外にして安全に
  // 止める(現在値での再計算はしない)。版は承認時と移行で作られる。
  const result = await db.prepare(
    `SELECT ce.id AS conversion_event_id,
            calc.offer_id AS offer_id,
            COALESCE(calc.offer_name_snapshot, '成果地点を取得できませんでした') AS offer_name,
            ce.approved_at,
            calc.formula AS calc_formula,
            calc.commission_rate_snapshot AS calc_rate,
            calc.base_amount_snapshot AS calc_base,
            calc.fixed_reward_snapshot AS calc_fixed,
            calc.amount_minor AS calc_amount,
            calc.id AS calculation_id
       FROM conversion_events ce
       JOIN affiliates a ON a.id = ? AND a.line_account_id = ? AND a.tenant_id = ?
       JOIN friends f ON f.id = ce.friend_id AND f.line_account_id = ?
       JOIN affiliate_reward_calculations calc
         ON calc.conversion_event_id = ce.id
        AND calc.formula IN ('rate', 'fixed')
        AND calc.organization_id = a.tenant_id
        AND calc.line_account_id = a.line_account_id
        AND calc.affiliate_id = a.id
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
    tenantId,
    lineAccountId,
    now,
  ).all<{
    conversion_event_id: string;
    offer_id: string | null;
    offer_name: string;
    approved_at: string;
    calc_formula: AffiliateRewardFormula;
    calc_rate: number | null;
    calc_base: number | null;
    calc_fixed: number | null;
    calc_amount: number;
    calculation_id: string;
  }>();

  return {
    affiliateName: affiliate.name,
    code: affiliate.code,
    entries: result.results
      .map((row) => ({
        conversionEventId: row.conversion_event_id,
        offerId: row.offer_id,
        offerName: row.offer_name,
        approvedAt: row.approved_at,
        amount: Math.round(Number(row.calc_amount)),
        formula: row.calc_formula,
        commissionRate: row.calc_rate === null ? null : Number(row.calc_rate),
        baseAmount: row.calc_base === null ? null : Number(row.calc_base),
        fixedReward: row.calc_fixed === null ? null : Math.round(Number(row.calc_fixed)),
        calculationId: row.calculation_id,
      }))
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

  const payment = await settlementEntries(db, input.affiliateId, input.lineAccountId, input.tenantId, now);
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
  input: { tenantId: string; affiliateId: string; lineAccountId: string; now?: string },
): Promise<SettlementPreviewInternal | null> {
  const now = input.now ?? new Date().toISOString();
  const result = await settlementEntries(db, input.affiliateId, input.lineAccountId, input.tenantId, now);
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
  | { kind: 'not_found' | 'empty' | 'changed' | 'idempotency_conflict' };

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
  const now = input.now ?? new Date().toISOString();
  const preview = await previewAffiliateSettlement(db, {
    tenantId: input.tenantId,
    affiliateId: input.affiliateId,
    lineAccountId: input.lineAccountId,
    now,
  });
  // 対象・金額の指紋。同じ再実行キーで別紹介者・別対象・別金額が来たら
  // duplicate成功にせず409相当で返す。previewが無い(境界外)ときは空指紋にする。
  const fingerprint = preview
    ? await sha256Hex([
      input.affiliateId,
      ...preview.entries.map((entry) => `${entry.conversionEventId}:${entry.amount}`).sort(),
    ].join('|'))
    : '';

  const existing = await db.prepare(
    `SELECT id, affiliate_id, total_amount_minor, closed_at, request_fingerprint,
            (SELECT COUNT(*) FROM affiliate_settlement_lines WHERE settlement_id = affiliate_settlements.id) AS line_count
       FROM affiliate_settlements
      WHERE organization_id = ? AND line_account_id = ? AND idempotency_key = ?`,
  ).bind(input.tenantId, input.lineAccountId, input.idempotencyKey).first<{
    id: string;
    affiliate_id: string | null;
    total_amount_minor: number;
    closed_at: string;
    request_fingerprint: string;
    line_count: number;
  }>();
  if (existing) {
    const resolved = resolveConfirmDuplicate(existing, {
      affiliateId: input.affiliateId,
      expectedAmount: input.expectedAmount,
      fingerprint,
      hasTargets: preview !== null && preview.entries.length > 0,
    });
    if (resolved) return resolved;
  }

  if (!preview) return { kind: 'not_found' };
  if (preview.entries.length === 0) return { kind: 'empty' };
  if (preview.amount !== input.expectedAmount) return { kind: 'changed' };

  const settlementId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO affiliate_settlements
         (id, organization_id, line_account_id, affiliate_id, period_from, period_to,
          timezone, currency, total_amount_minor, state, closed_by, version,
          idempotency_key, closed_at, created_at, request_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, 'Asia/Tokyo', 'JPY', ?, 'partial', ?, 1, ?, ?, ?, ?)`,
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
      fingerprint,
    ),
  ];

  // 版は承認時と移行で作り済みのため、ここでは紐付けるだけ(作らない)。
  // 書込みは fence 付き(承認状態・承認時刻・所属・版・未確定を書込みの
  // 瞬間に照合)。1件でも通らなければこの確定はまるごと巻き戻る。
  statements.push(...settlementWriteStatements(db, {
    tenantId: input.tenantId,
    lineAccountId: input.lineAccountId,
    settlementId,
    now,
    targets: preview.entries.map((entry) => ({
      conversionEventId: entry.conversionEventId,
      affiliateId: input.affiliateId,
      calculationId: entry.calculationId,
      amount: entry.amount,
      approvedAt: entry.approvedAt,
    })),
  }));

  try {
    await db.batch(statements);
  } catch (error) {
    // 並行する確定が先に書いた場合は読み直して回収する。同一操作は冪等な
    // duplicateへ、別内容だけ409相当へ。勝者が無い制約違反は投げ直す。
    if (!/UNIQUE|constraint|busy|locked/i.test(error instanceof Error ? error.message : String(error))) throw error;
    const winner = await db.prepare(
      `SELECT id, affiliate_id, total_amount_minor, closed_at, request_fingerprint,
              (SELECT COUNT(*) FROM affiliate_settlement_lines WHERE settlement_id = affiliate_settlements.id) AS line_count
         FROM affiliate_settlements
        WHERE organization_id = ? AND line_account_id = ? AND idempotency_key = ?`,
    ).bind(input.tenantId, input.lineAccountId, input.idempotencyKey).first<{
      id: string;
      affiliate_id: string | null;
      total_amount_minor: number;
      closed_at: string;
      request_fingerprint: string;
      line_count: number;
    }>();
    if (winner) {
      const resolved = resolveConfirmDuplicate(winner, {
        affiliateId: input.affiliateId,
        expectedAmount: input.expectedAmount,
        fingerprint,
        hasTargets: true,
      });
      if (resolved) return resolved;
    } else {
      // 同じキーで勝者が無いのに書けなかった(別キーで対象が確定済み等)。
      // 読み直して対象の有無で安全に止める。
      const retry = await previewAffiliateSettlement(db, {
        tenantId: input.tenantId,
        affiliateId: input.affiliateId,
        lineAccountId: input.lineAccountId,
        now,
      });
      if (!retry || retry.entries.length === 0) return { kind: 'empty' };
      return { kind: 'changed' };
    }
    throw error;
  }
  // fenceが1件でも落ちていれば、この確定は同じトランザクションで巻き戻り
  // headerごと消えている。金額を保証できないので確定にはしない。
  if (!await settlementSurvived(db, settlementId)) return { kind: 'changed' };
  return {
    kind: 'created',
    settlementId,
    amount: preview.amount,
    conversionCount: preview.entries.length,
    closedAt: now,
  };
}

interface ConfirmDuplicateRequest {
  affiliateId: string;
  expectedAmount: number;
  fingerprint: string;
  hasTargets: boolean;
}

/**
 * 同じ再実行キーで見つかった確定済み行を、同一操作の冪等結果へ回収する。
 * 同じキーで別紹介者・別対象・別金額のときだけ409相当を返し、回収不能は
 * null(呼出側が読み直しへ進む)。
 */
function resolveConfirmDuplicate(
  existing: {
    id: string;
    affiliate_id: string | null;
    total_amount_minor: number;
    closed_at: string;
    request_fingerprint: string;
    line_count: number;
  },
  request: ConfirmDuplicateRequest,
): ConfirmAffiliateSettlementResult | null {
  // 同じキーで別紹介者の確定をduplicate成功にしない。
  if (existing.affiliate_id !== request.affiliateId) return { kind: 'idempotency_conflict' };
  if (request.hasTargets) {
    // 未確定が残る再試行は対象・金額の指紋で同一入力か確かめる。
    if (existing.request_fingerprint !== request.fingerprint) return { kind: 'idempotency_conflict' };
  } else if (Number(existing.total_amount_minor) !== request.expectedAmount) {
    // 全部確定済みで対象が空の再試行は、金額の一致で同一確定とみなす。
    return { kind: 'idempotency_conflict' };
  }
  return {
    kind: 'duplicate',
    settlementId: existing.id,
    amount: Number(existing.total_amount_minor),
    conversionCount: Number(existing.line_count),
    closedAt: existing.closed_at,
  };
}
