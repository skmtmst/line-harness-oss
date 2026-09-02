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
