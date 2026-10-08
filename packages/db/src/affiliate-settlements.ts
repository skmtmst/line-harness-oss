import { dbTableExists } from './utils.js';

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

// =============================================================================
// 承認時の固定報酬の根拠 — 記録時刻の版 (F-23 ケース6)
// =============================================================================
//
// 判断記録がある成果はその版を使う。判断の保存に失敗した成果は、記録時刻に
// 使っていた版（記録時刻以前に作られた最新の版）で旧額を保つ。版番号は作った
// 順に振り、作った時刻も残るため、記録時刻以前の最新版は「判断が残っていれば
// 選ばれていた版」と一致する。新しい予約時刻・CAS・追加payloadは要らない。
//
// - 'version' … 不変の版で価格が決まる（判断の版か、記録時刻以前の最新版。
//   ただし最新版が記録時刻と同時刻で他に候補があるときは確定不能として null）
// - 'legacy-live' … 版管理前の昔の案件・汎用リンク・率の紹介者・古いスキーマ。
//   旧来どおり今の案件額を使う。版0の公開案件にも到達する（POSTの案件行
//   INSERT成功→初版INSERT失敗で残り、同キー再送が回収する。F-23 交差の
//   有限barrierで再現）。機能保証の変更はしない。
// - null … 版管理下の案件なのに記録時刻の版が無い（欠落・改ざん）。
//   承認してはならない。呼び出し側が状態を変えずに拒む。

export interface ApprovalRewardVersionBasis {
  rewardAmount: number;
  rewardMiles: number;
}

export type ApprovalRewardBasis =
  | { kind: 'version'; version: ApprovalRewardVersionBasis }
  // 旧来経路の現在額。承認判断時点で読んだ値をそのまま持ち、承認・凍結・
  // 計算で同じ値を使い回す（precheck→UPDATE→freezeの間の割り込みで
  // 根拠がずれないようにする。F-23 交差の有限barrier）。
  | { kind: 'legacy-live'; rewardAmount: number | null; rewardMiles: number | null };

/**
 * 記録時刻以前に作られた最新の版。無ければ null。
 *
 * 最新の候補が記録時刻と同時刻で、他にも候補があるときは前後が決め
 * られないため null を返す（同時刻で確定不能→呼び出し側が承認を拒む。
 * jstNow はms精度のため、処理now採取→判断保存失敗→同じmsで新版保存
 * という有限順序が実在する。F-23 独立SOURCE監査）。候補が1件だけの
 * 同時刻はその版を使う（他に選びようが無い）。
 */
export async function getOfferVersionAtTime(
  db: D1Database,
  offerId: string,
  at: string,
): Promise<ApprovalRewardVersionBasis | null> {
  const found = await db
    .prepare(
      `SELECT reward_amount, reward_miles, created_at FROM affiliate_offer_versions
        WHERE offer_id = ?
          AND julianday(created_at) <= julianday(?)
        ORDER BY version_number DESC
        LIMIT 2`,
    )
    .bind(offerId, at)
    .all<{ reward_amount: number; reward_miles: number; created_at: string }>();
  const top = found.results[0];
  if (!top) return null;
  if (found.results.length > 1) {
    const sameInstant = await db
      .prepare(`SELECT 1 AS same WHERE julianday(?) = julianday(?)`)
      .bind(top.created_at, at)
      .first<{ same: number }>();
    if (sameInstant) return null;
  }
  return { rewardAmount: top.reward_amount, rewardMiles: top.reward_miles };
}

export async function resolveApprovalRewardBasis(
  db: D1Database,
  eventId: string,
): Promise<ApprovalRewardBasis | null> {
  const hasVersionTables = (await dbTableExists(db, 'affiliate_offer_versions'))
    && (await dbTableExists(db, 'affiliate_attribution_decisions'));
  if (!hasVersionTables) return { kind: 'legacy-live', rewardAmount: null, rewardMiles: null };
  const row = await db
    .prepare(
      `SELECT ce.created_at AS recorded_at,
              a.commission_rate AS commission_rate,
              a.reward_mode AS reward_mode,
              dad.offer_version_id AS decision_version_id,
              al.offer_id AS link_offer_id,
              off.reward_amount AS offer_reward,
              off.reward_miles AS offer_miles
         FROM conversion_events ce
         JOIN affiliates a ON a.id = ce.affiliate_id
         LEFT JOIN affiliate_attribution_decisions dad
           ON dad.conversion_event_id = ce.id
         LEFT JOIN affiliate_links al
           ON al.ref_code = ce.attributed_ref_code
          AND al.affiliate_id = ce.affiliate_id
         LEFT JOIN affiliate_offers off ON off.id = al.offer_id
        WHERE ce.id = ? AND ce.affiliate_id IS NOT NULL`,
    )
    .bind(eventId)
    .first<{
      recorded_at: string;
      commission_rate: number | null;
      reward_mode: 'none' | 'fixed' | 'rate' | null;
      decision_version_id: string | null;
      link_offer_id: string | null;
      offer_reward: number | null;
      offer_miles: number | null;
    }>();
  // 帰属のない行は呼び出し側が先に弾く。ここでは旧来経路に任せる。
  if (!row) return { kind: 'legacy-live', rewardAmount: null, rewardMiles: null };
  const rate = row.commission_rate === null ? 0 : Number(row.commission_rate);
  // 率の紹介者は版で金額を決めない（率の版管理はこの正本の範囲外）。
  if (row.reward_mode === 'none') return { kind: 'legacy-live', rewardAmount: 0, rewardMiles: 0 };
  if (row.reward_mode === 'rate' || (row.reward_mode == null && rate > 0)) {
    return { kind: 'legacy-live', rewardAmount: row.offer_reward, rewardMiles: row.offer_miles };
  }
  // 汎用リンク（案件なし）は旧来どおり。
  if (!row.link_offer_id) {
    return { kind: 'legacy-live', rewardAmount: row.offer_reward, rewardMiles: row.offer_miles };
  }
  if (row.decision_version_id) {
    const decided = await db
      .prepare(`SELECT reward_amount, reward_miles FROM affiliate_offer_versions WHERE id = ?`)
      .bind(row.decision_version_id)
      .first<{ reward_amount: number; reward_miles: number }>();
    if (decided) {
      return {
        kind: 'version',
        version: { rewardAmount: decided.reward_amount, rewardMiles: decided.reward_miles },
      };
    }
    // 判断の指す版が無い（通常ありえない）→記録時刻で探し直す。
  }
  const asof = await getOfferVersionAtTime(db, row.link_offer_id, row.recorded_at);
  if (asof) return { kind: 'version', version: asof };
  const versionCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM affiliate_offer_versions WHERE offer_id = ?`)
    .bind(row.link_offer_id)
    .first<{ n: number }>();
  // 版が1つも無い案件は旧来どおり。POSTの案件行INSERT成功→初版INSERT失敗
  // でも到達する（同キー再送が回収する）が、版なしの一般仕様の選択は
  // 司令塔の判断前には広げない。
  if ((versionCount?.n ?? 0) === 0) {
    return { kind: 'legacy-live', rewardAmount: row.offer_reward, rewardMiles: row.offer_miles };
  }
  return null;
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
  /**
   * 承認判断時に確定した根拠。渡されたときは再解決せず同じ値を使う
   * （precheck→UPDATE→freezeの間の割り込みで根拠がずれないようにする。
   * F-23 交差の有限barrier）。省略時はその場で確かめ直す。
   */
  basisOverride?: ApprovalRewardBasis | null,
): Promise<AffiliateRewardCalculation | null> {
  // 付けた時点の版があれば、その版の決まりを優先する(#823)。
  // 版の表が無い古いスキーマ（最小構成の単体試験など）では、
  // 従来どおり今の案件の値を使う。
  const hasVersionTables = (await dbTableExists(db, 'affiliate_offer_versions'))
    && (await dbTableExists(db, 'affiliate_attribution_decisions'));
  // 判断の版があればその額。無い行の扱いは下の JS で根拠ごとに分ける
  //（記録時刻の版で旧額を保つ。F-23 ケース6）。
  const versionRewardSelect = hasVersionTables
    ? 'ov.reward_amount AS version_reward'
    : 'NULL AS version_reward';
  const versionJoins = hasVersionTables
    ? `LEFT JOIN affiliate_attribution_decisions dad
         ON dad.conversion_event_id = ce.id
       LEFT JOIN affiliate_offer_versions ov ON ov.id = dad.offer_version_id`
    : '';
  const row = await db.prepare(
    `SELECT ce.id AS conversion_event_id,
            ce.value_snapshot AS value_snapshot,
            ce.approval_formula AS frozen_formula,
            ce.approval_commission_rate AS frozen_rate,
            ce.approval_base_amount AS frozen_base,
            ce.approval_fixed_reward AS frozen_fixed,
            ce.approval_amount_minor AS frozen_amount,
            a.id AS affiliate_id,
            a.name AS affiliate_name,
            a.code AS affiliate_code,
            a.commission_rate AS commission_rate,
            a.reward_mode AS reward_mode,
            a.tenant_id AS tenant_id,
            a.line_account_id AS affiliate_account_id,
            f.line_account_id AS friend_account_id,
            cp.value AS point_value,
            cp.line_account_id AS point_account_id,
            al.line_account_id AS link_account_id,
            off.line_account_id AS offer_account_id,
            off.id AS offer_id,
            COALESCE(off.name, ce.point_name_snapshot, cp.name, '') AS offer_name,
            ${versionRewardSelect},
            off.reward_amount AS offer_reward
       FROM conversion_events ce
       JOIN affiliates a ON a.id = ce.affiliate_id
       JOIN friends f ON f.id = ce.friend_id
       LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id
       LEFT JOIN affiliate_links al
         ON al.ref_code = ce.attributed_ref_code
        AND al.affiliate_id = a.id
       LEFT JOIN affiliate_offers off ON off.id = al.offer_id
       ${versionJoins}
      WHERE ce.id = ?
        AND ce.affiliate_id IS NOT NULL
        AND COALESCE(ce.approval_status, 'pending') = 'approved'`,
  ).bind(eventId).first<{
    conversion_event_id: string;
    value_snapshot: number | null;
    frozen_formula: string | null;
    frozen_rate: number | null;
    frozen_base: number | null;
    frozen_fixed: number | null;
    frozen_amount: number | null;
    affiliate_id: string;
    affiliate_name: string;
    affiliate_code: string;
    commission_rate: number | null;
    reward_mode: 'none' | 'fixed' | 'rate' | null;
    tenant_id: string | null;
    affiliate_account_id: string | null;
    friend_account_id: string | null;
    point_value: number | null;
    point_account_id: string | null;
    link_account_id: string | null;
    offer_account_id: string | null;
    offer_id: string | null;
    offer_name: string;
    version_reward: number | null;
    offer_reward: number | null;
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

  // m22u R356・R357: 承認時に凍結した入力があれば、現在の設定ではなく
  // 凍結値を優先する(承認後の設定変更で過去の承認額が動かない)。
  const frozenFormula = row.frozen_formula === 'rate' || row.frozen_formula === 'fixed'
    ? row.frozen_formula
    : null;
  const liveRate = row.commission_rate === null ? 0 : Number(row.commission_rate);
  const liveFormula: AffiliateRewardFormula = row.reward_mode === 'rate' || (row.reward_mode == null && liveRate > 0) ? 'rate' : 'fixed';
  const formula: AffiliateRewardFormula = frozenFormula ?? liveFormula;
  const rate = formula === 'rate'
    ? (row.frozen_rate === null || row.frozen_rate === undefined ? liveRate : Number(row.frozen_rate))
    : 0;
  const baseAmount = formula === 'rate'
    ? (row.frozen_base === null || row.frozen_base === undefined
      ? Number(row.value_snapshot ?? row.point_value ?? 0)
      : Number(row.frozen_base))
    : null;
  // 固定報酬の出どころ。判断の版があればその額。判断が無い行は根拠を
  // 確かめ直す：記録時刻の版があれば旧額、版管理下で版が無ければ版を
  // 作らない（null で終え、締め・支払い・レポートから外す。F-23 ケース6）。
  let pricedFixedReward = 0;
  if (formula === 'fixed' && row.reward_mode !== 'none') {
    if (row.version_reward !== null && row.version_reward !== undefined) {
      pricedFixedReward = Math.round(Number(row.version_reward));
    } else if (!hasVersionTables) {
      pricedFixedReward = Math.round(Number(row.offer_reward ?? 0));
    } else {
      const basis = basisOverride !== undefined
        ? basisOverride
        : await resolveApprovalRewardBasis(db, eventId);
      if (basis === null) return null;
      pricedFixedReward = basis.kind === 'version'
        ? Math.round(Number(basis.version.rewardAmount))
        : Math.round(Number(basis.rewardAmount ?? row.offer_reward ?? 0));
    }
  }
  const fixedReward = formula === 'fixed'
    ? (row.frozen_fixed === null || row.frozen_fixed === undefined
      ? pricedFixedReward
      : Math.round(Number(row.frozen_fixed)))
    : null;
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

/**
 * m22u R358：締め済みの成果を却下→再承認したときの復活。
 *
 * 締めは成果ごとに確定(credit)を1件しか持てない（UNIQUE のため再承認で
 * 新しい確定は作れない）。そのため再承認では、却下で reversed にした確定を
 * settled へ戻し、締めの記録（settlement-1 の明細）をそのまま生かす。
 * 却下で起こした相殺(debit)は行として残すが、有効な確定が戻った分は
 * 未適用の取り立てから外す（affiliate-payouts 側の判定で見る）。
 *
 * 書込みは fence 付き：いま承認中で、取り消し済みの確定と相殺の組がある
 * ときだけ戻す。再送では確定が有効のため 0 行で終わる（調整は1回）。
 */
export async function restoreSettledRewardOnReapproval(
  db: D1Database,
  eventId: string,
): Promise<string | null> {
  const result = await db.prepare(
    `UPDATE affiliate_reward_entries
        SET status = 'settled'
      WHERE conversion_event_id = ?
        AND entry_type = 'credit'
        AND status = 'reversed'
        AND EXISTS (
          SELECT 1 FROM affiliate_reward_entries d
           WHERE d.conversion_event_id = affiliate_reward_entries.conversion_event_id
             AND d.entry_type = 'debit'
        )
        AND EXISTS (
          SELECT 1 FROM conversion_events ce
           WHERE ce.id = affiliate_reward_entries.conversion_event_id
             AND COALESCE(ce.approval_status, 'pending') = 'approved'
        )`,
  ).bind(eventId).run();
  if ((result.meta?.changes ?? 0) === 0) return null;
  const restored = await db.prepare(
    `SELECT id FROM affiliate_reward_entries
      WHERE conversion_event_id = ? AND entry_type = 'credit' AND status = 'settled'`,
  ).bind(eventId).first<{ id: string }>();
  return restored?.id ?? null;
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
    /**
     * R288: 全体締めが同時に付ける取消(entry_id 参照)の消費行。
     * 別締めに先取りされて1行でも欠けたら、報酬行もろとも巻き戻す。
     * 個別締めは渡さない(従来どおり報酬行だけを見る)。
     */
    expectedDebitEntryIds?: string[];
    /**
     * R288: 取り込む取消行。巻き戻し文より先に積むため、ここで受け取る。
     * amount は負数(差し引き)。書込みは条件付きで、別締めが先に同じ
     * 取消を付けていたら0行になる(entry_id の UNIQUE との二重構え)。
     */
    debitLines?: Array<{ debitId: string; affiliateId: string; amount: number }>;
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

  // R288: 取消の消費行は報酬行の直後・巻き戻し文より先に積む。
  // 順序が逆だと巻き戻しがまだ無い行を数えて締めごと消してしまう。
  for (const line of input.debitLines ?? []) {
    statements.push(db.prepare(
      `INSERT INTO affiliate_settlement_lines
         (id, settlement_id, affiliate_id, entry_id, amount_minor, status, created_at)
       SELECT ?, ?, ?, ?, ?, 'included', ?
        WHERE NOT EXISTS (
          SELECT 1 FROM affiliate_settlement_lines slx WHERE slx.entry_id = ?
        )`,
    ).bind(crypto.randomUUID(), input.settlementId, line.affiliateId, line.debitId, line.amount, input.now, line.debitId));
  }

  // 巻き戻しの3文。fenceを通らなかった対象が1件でもあれば、この確定で
  // 書いた明細行 → credit → header の順に消す(子から先に消してFKを壊さない)。
  // 述語はいずれも「自分が消す表」を数えないため、途中経過に左右されない。
  // R288: 取消の消費行も数える。別締めに先取りされて欠けたら、
  // 報酬行が全部書けていても締めごと消す(部分適用は残らない)。
  const writtenEntries =
    `(SELECT COUNT(*) FROM affiliate_reward_entries re
       WHERE substr(re.idempotency_key, 1, ?) = ?)`;
  const debitIds = input.expectedDebitEntryIds ?? [];
  const writtenDebits = debitIds.length > 0
    ? ` OR (SELECT COUNT(*) FROM affiliate_settlement_lines sl2
             WHERE sl2.settlement_id = ?
               AND sl2.entry_id IN (${debitIds.map(() => '?').join(',')})) <> ?`
    : '';
  const noLinesLeft =
    `NOT EXISTS (SELECT 1 FROM affiliate_settlement_lines sl WHERE sl.settlement_id = ?)`;
  statements.push(
    db.prepare(
      `DELETE FROM affiliate_settlement_lines
        WHERE settlement_id = ? AND (${writtenEntries} <> ?${writtenDebits})`,
    ).bind(
      input.settlementId, entryKeyPrefix.length, entryKeyPrefix, input.targets.length,
      ...(debitIds.length > 0 ? [input.settlementId, ...debitIds, debitIds.length] : []),
    ),
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
