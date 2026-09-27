import { jstNow } from './utils.js';
// =============================================================================
// Affiliate Attribution — last-touch resolution (ASP)
// =============================================================================
//
// Resolves which affiliate (if any) a conversion should be credited to, using
// the most-recent eligible ref-tracking touch within the attribution window.
//
// Rules (see spec §8):
//  - last-touch: the newest eligible touch wins
//  - window: touches older than ATTRIBUTION_WINDOW_DAYS are ignored
//  - only touches whose ref_code maps to an affiliate_link count
//  - self-clicks (the friend is the affiliate's own friend_id) are excluded
//  - stopped links and stopped affiliates do not create NEW attribution.
//    Existing conversion rows keep their affiliate_id snapshot.

export const ATTRIBUTION_WINDOW_DAYS = 90;

/**
 * Resolve the last-touch affiliate attribution for a friend.
 *
 * @param at Reference timestamp (JST ISO). Defaults to jstNow().
 *           Touches must fall within [at - 90 days, at].
 * @returns The winning affiliate + ref_code, or null if none is eligible.
 *
 * Timestamp comparison note:
 *  ref_tracking.created_at is stored as a JST ISO string with a +09:00 offset
 *  (e.g. "2026-07-07T12:00:00.000+09:00"). SQLite's datetime() emits a
 *  space-separated UTC-normalized string, so a raw string comparison against
 *  datetime(?, '-90 days') mixes formats and produces boundary errors. We use
 *  julianday(), which parses the offset into a true instant, so the window and
 *  ordering compare real points in time regardless of textual format.
 */
export async function resolveAffiliateAttribution(
  db: D1Database,
  friendId: string,
  at?: string, // 省略時 jstNow()
  opts?: {
    /**
     * この成果地点だけ期間を変える場合の日数。省略時は全体の既定
     * (ATTRIBUTION_WINDOW_DAYS = 90)。0 以下や整数でない値は無視して既定に戻す
     * —— 報酬の計算に効くので、壊れた値で勝手に狭めない。
     */
    windowDays?: number;
  },
): Promise<{ affiliateId: string; refCode: string } | null> {
  const now = at ?? jstNow();
  const windowDays =
    opts?.windowDays != null && Number.isInteger(opts.windowDays) && opts.windowDays > 0
      ? opts.windowDays
      : ATTRIBUTION_WINDOW_DAYS;
  const row = await db
    .prepare(
      `SELECT al.affiliate_id AS affiliate_id, rt.ref_code AS ref_code
         FROM ref_tracking rt
         JOIN affiliate_links al ON al.ref_code = rt.ref_code
         JOIN affiliates a ON a.id = al.affiliate_id
        WHERE rt.friend_id = ?
          AND julianday(rt.created_at) >= julianday(?) - ${windowDays}
          AND julianday(rt.created_at) <= julianday(?)
          AND al.is_active = 1
          AND a.is_active = 1
          AND (a.friend_id IS NULL OR a.friend_id != rt.friend_id)  -- 自己クリック除外
        ORDER BY julianday(rt.created_at) DESC
        LIMIT 1`,
    )
    .bind(friendId, now, now)
    .first<{ affiliate_id: string; ref_code: string }>();
  return row ? { affiliateId: row.affiliate_id, refCode: row.ref_code } : null;
}

// =============================================================================
// Attribution explanation — 成果の付け方の記録 (#823)
// =============================================================================
//
// 候補になった紹介を並べ、どの決まりで誰に付けたかを1件ずつ説明する。
// 付けなかった紹介には、その理由を残す。同じ成果に2人分は付けない
// (affiliate_attribution_decisions.conversion_event_id が一意)。
// 付け直しはこの行を書き換えず、理由付きの調整で足す。

import {
  getCurrentOfferVersion,
  getOfferCapStatus,
  OFFER_ATTRIBUTION_WINDOW_DEFAULT,
} from './affiliate-offers.js';

export type AttributionReason =
  | 'matched_last_touch'
  | 'no_touch'
  | 'out_of_window'
  | 'self_referral'
  | 'inactive_link'
  | 'inactive_affiliate'
  | 'other_account'
  | 'reception_closed'
  | 'capped_total'
  | 'capped_monthly';

export type AttributionSkipReason = Exclude<AttributionReason, 'matched_last_touch' | 'no_touch'>;

export interface AttributionCandidate {
  affiliateId: string;
  refCode: string;
  touchedAt: string;
  offerId: string | null;
  /** 付けた候補か。 */
  chosen: boolean;
  /** 付けなかった理由。付けた候補は null。 */
  skipReason: AttributionSkipReason | null;
  windowDays: number;
}

export interface AttributionExplanation {
  decision: {
    affiliateId: string;
    refCode: string;
    offerId: string | null;
    offerVersionId: string | null;
  } | null;
  reason: AttributionReason;
  windowDays: number;
  candidates: AttributionCandidate[];
}

export interface ExplainAttributionOptions {
  /**
   * この成果地点だけ期間を変える場合の日数。省略時は案件の版か全体の既定。
   * 0 以下や整数でない値は無視する。
   */
  windowDays?: number;
  /**
   * 成果の所属(LINEアカウント)。指定時は、別アカウントの紹介者を
   * 候補から外し、理由に残す。
   */
  lineAccountId?: string | null;
}

function asValidWindowDays(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * 友だちの紹介候補を新しい順に並べ、決まりに沿って1件を選ぶ。
 * 新しい順に、最初に決まりをすべて満たした紹介が勝つ(last-touch)。
 */
export async function explainAffiliateAttribution(
  db: D1Database,
  friendId: string,
  at?: string,
  opts?: ExplainAttributionOptions,
): Promise<AttributionExplanation> {
  const now = at ?? jstNow();
  const pointWindow = asValidWindowDays(opts?.windowDays);
  const lineAccountId = opts?.lineAccountId ?? null;
  const touches = await db
    .prepare(
      `SELECT rt.ref_code AS ref_code, rt.created_at AS touched_at,
              al.affiliate_id AS affiliate_id, al.offer_id AS offer_id,
              al.is_active AS link_active, al.line_account_id AS link_account,
              a.is_active AS aff_active, a.friend_id AS aff_friend_id,
              a.line_account_id AS aff_account
         FROM ref_tracking rt
         JOIN affiliate_links al ON al.ref_code = rt.ref_code
         JOIN affiliates a ON a.id = al.affiliate_id
        WHERE rt.friend_id = ?
          AND julianday(rt.created_at) <= julianday(?)
        ORDER BY julianday(rt.created_at) DESC
        LIMIT 20`,
    )
    .bind(friendId, now)
    .all<{
      ref_code: string;
      touched_at: string;
      affiliate_id: string;
      offer_id: string | null;
      link_active: number;
      link_account: string | null;
      aff_active: number;
      aff_friend_id: string | null;
      aff_account: string | null;
    }>();
  const candidates: AttributionCandidate[] = [];
  let decision: AttributionExplanation['decision'] = null;
  let reason: AttributionReason = 'no_touch';
  // 案件の無い汎用リンクは、従来の 90 日を legacy として使う。
  let usedWindow = ATTRIBUTION_WINDOW_DAYS;
  const versionCache = new Map<string, Awaited<ReturnType<typeof getCurrentOfferVersion>>>();
  for (const touch of touches.results) {
    let version = null;
    if (touch.offer_id) {
      if (!versionCache.has(touch.offer_id)) {
        versionCache.set(touch.offer_id, await getCurrentOfferVersion(db, touch.offer_id));
      }
      version = versionCache.get(touch.offer_id) ?? null;
    }
    const windowDays = pointWindow
      ?? version?.window_days
      ?? ATTRIBUTION_WINDOW_DAYS;
    const base = {
      affiliateId: touch.affiliate_id,
      refCode: touch.ref_code,
      touchedAt: touch.touched_at,
      offerId: touch.offer_id,
      windowDays,
    };
    const skip = (skipReason: AttributionSkipReason): AttributionCandidate => ({
      ...base, chosen: false, skipReason,
    });
    // 別アカウントの紹介者は候補にしない。推測で付け替えない。
    if (lineAccountId !== null
      && ((touch.link_account !== null && touch.link_account !== lineAccountId)
        || (touch.aff_account !== null && touch.aff_account !== lineAccountId))) {
      candidates.push(skip('other_account'));
      continue;
    }
    if (touch.link_active !== 1) {
      candidates.push(skip('inactive_link'));
      continue;
    }
    if (touch.aff_active !== 1) {
      candidates.push(skip('inactive_affiliate'));
      continue;
    }
    // 自分の紹介には付けない。
    if (touch.aff_friend_id !== null && touch.aff_friend_id === friendId) {
      candidates.push(skip('self_referral'));
      continue;
    }
    const inWindow = await db
      .prepare(`SELECT 1 AS ok WHERE julianday(?) >= julianday(?) - ?`)
      .bind(touch.touched_at, now, windowDays)
      .first<{ ok: number }>();
    if (!inWindow) {
      candidates.push(skip('out_of_window'));
      continue;
    }
    if (version) {
      // 受付の期間外の紹介には付けない。
      if (version.reception_from !== null) {
        const open = await db
          .prepare(`SELECT 1 AS ok WHERE julianday(?) >= julianday(?)`)
          .bind(now, version.reception_from)
          .first<{ ok: number }>();
        if (!open) {
          candidates.push(skip('reception_closed'));
          continue;
        }
      }
      if (version.reception_to !== null) {
        const open = await db
          .prepare(`SELECT 1 AS ok WHERE julianday(?) <= julianday(?)`)
          .bind(now, version.reception_to)
          .first<{ ok: number }>();
        if (!open) {
          candidates.push(skip('reception_closed'));
          continue;
        }
      }
      // 上限に達したら受付を自動で止める。同時の2件が両方通ることがあるが、
      // 記録の一意性で2人付けにはならない(件数の超過は次の判断で止まる)。
      if (version.cap_total !== null || version.cap_monthly_per_affiliate !== null) {
        const status = await getOfferCapStatus(
          db, touch.offer_id!, { affiliateId: touch.affiliate_id, at: now },
        );
        if (status.totalRemaining !== null && status.totalRemaining <= 0) {
          candidates.push(skip('capped_total'));
          continue;
        }
        if (status.monthlyRemaining !== null && status.monthlyRemaining <= 0) {
          candidates.push(skip('capped_monthly'));
          continue;
        }
      }
    }
    // 新しい順の最初の適格が勝ち。それ以前の不適格の理由は残る。
    decision = {
      affiliateId: touch.affiliate_id,
      refCode: touch.ref_code,
      offerId: touch.offer_id,
      offerVersionId: version?.id ?? null,
    };
    reason = 'matched_last_touch';
    usedWindow = windowDays;
    candidates.push({ ...base, chosen: true, skipReason: null });
    break;
  }
  if (!decision && candidates.length > 0) {
    reason = candidates[0]!.skipReason ?? 'no_touch';
    usedWindow = candidates[0]!.windowDays;
  }
  return { decision, reason, windowDays: usedWindow, candidates };
}

export interface AttributionDecisionRow {
  id: string;
  conversion_event_id: string;
  friend_id: string;
  conversion_point_id: string;
  affiliate_id: string | null;
  ref_code: string | null;
  offer_id: string | null;
  offer_version_id: string | null;
  reason: AttributionReason;
  window_days: number;
  created_at: string;
}

/**
 * 付け方の判断を成果に結びつけて残す。同じ成果の再送は最初の記録を保つ
 * (INSERT OR IGNORE)。後から決まりが変わっても、この記録は書き換えない。
 */
export async function recordAttributionDecision(
  db: D1Database,
  conversionEventId: string,
  friendId: string,
  conversionPointId: string,
  explanation: AttributionExplanation,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO affiliate_attribution_decisions
         (id, conversion_event_id, friend_id, conversion_point_id,
          affiliate_id, ref_code, offer_id, offer_version_id, reason, window_days, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      conversionEventId,
      friendId,
      conversionPointId,
      explanation.decision?.affiliateId ?? null,
      explanation.decision?.refCode ?? null,
      explanation.decision?.offerId ?? null,
      explanation.decision?.offerVersionId ?? null,
      explanation.reason,
      explanation.windowDays,
      jstNow(),
    )
    .run();
}

export async function getAttributionDecision(
  db: D1Database,
  conversionEventId: string,
): Promise<AttributionDecisionRow | null> {
  return db
    .prepare(`SELECT * FROM affiliate_attribution_decisions WHERE conversion_event_id = ?`)
    .bind(conversionEventId)
    .first<AttributionDecisionRow>();
}
