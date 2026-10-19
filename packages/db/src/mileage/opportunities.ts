import { resolveMileageMultiplier } from './multiplier.js';
import { jstNow } from '../utils.js';
import { type MileageEarningOpportunity, type MileageRuleConditions } from './types.js';
import { DEFAULT_MILEAGE_PROGRAM_ID } from './program.js';


/**
 * Build actionable, person-specific ways to earn more mileage.
 *
 * The first opportunity provider is the auto-webinar system. It compares the
 * person's best viewing position (across linked friend rows) with the active
 * mileage rules, then only returns webinars that still have an attainable
 * reward. The returned LIFF URL always uses the webinar's own LINE account.
 */
export async function getMileageEarningOpportunitiesForFriend(
  db: D1Database,
  friendId: string,
  options: { limit?: number; now?: string } = {},
): Promise<MileageEarningOpportunity[]> {
  const limit = Math.min(10, Math.max(1, options.limit ?? 10));
  const now = options.now ?? jstNow();
  const eventTypes = [
    'webinar_watch_5m',
    'webinar_watch_15m',
    'webinar_completed',
    'webinar_cta_clicked',
  ] as const;

  const [rulesResult, webinarsResult, accountsResult, multiplier] = await Promise.all([
    db
      .prepare(
        `SELECT event_type, source, amount, conditions
           FROM mileage_rules
          WHERE program_id = ?
            AND event_type IN ('friend_registered', ?, ?, ?, ?)
            AND is_active = 1
            AND (line_account_id IS NULL
                 OR line_account_id = (SELECT line_account_id FROM friends WHERE id = ?))
            AND (conditions IS NULL
                 OR COALESCE(json_extract(conditions, '$.beneficiary'), 'actor') = 'actor')
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_until IS NULL OR valid_until >= ?)
          ORDER BY created_at ASC, id ASC`,
      )
      .bind(
        DEFAULT_MILEAGE_PROGRAM_ID,
        ...eventTypes,
        friendId,
        now,
        now,
      )
      .all<{ event_type: string; source: string | null; amount: number; conditions: string | null }>(),
    db
      .prepare(
        `WITH identity AS (
           SELECT user_id, line_account_id FROM friends WHERE id = ?
         ), friend_scope AS (
           SELECT f.id
             FROM friends f
             LEFT JOIN identity ON 1 = 1
            WHERE f.id = ?
               OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id)
         )
         SELECT w.id, w.title, w.slug, w.duration_seconds, w.updated_at,
                la.liff_id,
                COALESCE(MAX(v.last_position_seconds), 0) AS max_position_seconds,
                MAX(CASE WHEN v.cta_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS cta_clicked,
                MAX(CASE WHEN wc.id IS NOT NULL OR w.cta_json IS NOT NULL THEN 1 ELSE 0 END) AS has_cta
           FROM webinars w
           JOIN identity ON w.account_id = identity.line_account_id
           JOIN line_accounts la ON la.id = w.account_id
           LEFT JOIN webinar_viewers v
             ON v.webinar_id = w.id
            AND v.friend_id IN (SELECT id FROM friend_scope)
           LEFT JOIN webinar_ctas wc ON wc.webinar_id = w.id
          WHERE w.status = 'active'
            AND w.duration_seconds > 0
            AND la.is_active = 1
            AND la.liff_id IS NOT NULL
            AND la.liff_id != ''
          GROUP BY w.id, w.title, w.slug, w.duration_seconds, w.updated_at, la.liff_id
          ORDER BY w.updated_at DESC, w.id ASC`,
      )
      .bind(friendId, friendId)
      .all<{
        id: string;
        title: string;
        slug: string;
        duration_seconds: number;
        updated_at: string;
        liff_id: string;
        max_position_seconds: number;
        cta_clicked: number;
        has_cta: number;
      }>(),
    db
      .prepare(
        `WITH identity AS (
           SELECT user_id FROM friends WHERE id = ?
         ), scoped_friends AS (
           SELECT f.id, f.line_account_id, f.is_following
             FROM friends f
             LEFT JOIN identity ON 1 = 1
            WHERE f.line_account_id IS NOT NULL
              AND (f.id = ?
                   OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id))
         )
         SELECT la.id, la.name, la.liff_id, la.display_order,
                EXISTS(
                  SELECT 1 FROM scoped_friends sf
                   WHERE sf.line_account_id = la.id AND sf.is_following = 1
                ) AS is_registered,
                COALESCE((
                  SELECT SUM(ml.amount)
                    FROM scoped_friends sf
                    JOIN engagement_events ee
                      ON ee.actor_friend_id = sf.id
                     AND ee.event_type = 'friend_registered'
                     AND ee.source = 'line_relationship'
                    JOIN mileage_ledger ml
                      ON ml.engagement_event_id = ee.id
                     AND ml.program_id = 'default'
                     AND ml.mileage_rule_id = 'builtin-friend-registered'
                     AND ml.entry_type = 'grant'
                     AND ml.status = 'available'
                   WHERE sf.line_account_id = la.id
                ), 0) AS credited_miles,
                COALESCE((
                  SELECT SUM(ml.amount)
                    FROM scoped_friends sf
                    JOIN engagement_events ee
                      ON ee.actor_friend_id = sf.id
                     AND ee.event_type = 'friend_registered'
                     AND ee.source = 'line_relationship'
                    JOIN mileage_ledger ml
                      ON ml.engagement_event_id = ee.id
                     AND ml.program_id = 'default'
                     AND ml.mileage_rule_id = 'builtin-friend-registered'
                     AND ml.entry_type = 'grant'
                     AND ml.status = 'pending'
                   WHERE sf.line_account_id = la.id
                ), 0) AS pending_miles
           FROM line_accounts la
          WHERE la.is_active = 1
            AND la.liff_id IS NOT NULL
            AND la.liff_id != ''
          ORDER BY la.display_order ASC, la.created_at ASC, la.id ASC`,
      )
      .bind(friendId, friendId)
      .all<{
        id: string;
        name: string;
        liff_id: string;
        display_order: number;
        is_registered: number;
        credited_miles: number;
        pending_miles: number;
      }>(),
    resolveMileageMultiplier(db, friendId, now),
  ]);

  const amounts = new Map<string, number>();
  for (const rule of rulesResult.results) {
    const sourceMatches = rule.event_type === 'friend_registered'
      ? rule.source === null || rule.source === 'line_relationship'
      : rule.source === null || rule.source === 'webinar';
    if (!sourceMatches) continue;
    let conditions: MileageRuleConditions = {};
    if (rule.conditions) {
      try { conditions = JSON.parse(rule.conditions) as MileageRuleConditions; } catch { conditions = {}; }
    }
    const adjustedAmount = conditions.ignoreMultiplier
      ? Number(rule.amount)
      : Math.max(1, Math.round((Number(rule.amount) * multiplier.bps) / 10000));
    amounts.set(rule.event_type, (amounts.get(rule.event_type) ?? 0) + adjustedAmount);
  }
  const opportunities: Array<MileageEarningOpportunity & { secondsToNext: number }> = [];

  const friendAddReward = amounts.get('friend_registered') ?? 0;
  if (friendAddReward > 0) {
    for (const account of accountsResult.results) {
      const completed = Boolean(account.is_registered);
      const creditedMiles = Number(account.credited_miles ?? 0);
      const pendingMiles = Number(account.pending_miles ?? 0);
      const mileageStatus = !completed
        ? undefined
        : creditedMiles > 0
          ? 'credited'
          : pendingMiles > 0
            ? 'pending'
            : 'waiting';
      const description = !completed
        ? `友だち追加で +${friendAddReward} mile。追加後は4アカウント分のマイルを合算できます`
        : mileageStatus === 'credited'
          ? `友だち登録済み・+${creditedMiles} mile 加算済み`
          : mileageStatus === 'pending'
            ? `友だち登録済み・+${pendingMiles} mile 確定待ち`
            : '友だち登録済み・マイルは定期集計で反映されます';
      opportunities.push({
        id: `friend-add:${account.id}`,
        type: 'friend_add',
        title: completed ? account.name : `${account.name}を友だち追加`,
        description,
        rewardMiles: friendAddReward,
        nextRewardMiles: completed ? 0 : friendAddReward,
        progressPercent: completed ? 100 : 0,
        ctaLabel: completed ? '登録済み' : '友だち追加する',
        url: `https://liff.line.me/${account.liff_id}/?page=affiliate&liffId=${encodeURIComponent(account.liff_id)}`,
        targetAccountId: account.id,
        completed,
        mileageStatus,
        creditedMiles,
        secondsToNext: 0,
      });
    }
  }

  for (const webinar of webinarsResult.results) {
    const duration = Number(webinar.duration_seconds);
    const position = Math.max(0, Math.min(duration, Number(webinar.max_position_seconds)));
    const milestones = [
      ...(duration >= 300 && (amounts.get('webinar_watch_5m') ?? 0) > 0
        ? [{ seconds: 300, amount: amounts.get('webinar_watch_5m')!, label: '5分視聴' }]
        : []),
      ...(duration >= 900 && (amounts.get('webinar_watch_15m') ?? 0) > 0
        ? [{ seconds: 900, amount: amounts.get('webinar_watch_15m')!, label: '15分視聴' }]
        : []),
      ...((amounts.get('webinar_completed') ?? 0) > 0
        ? [{
            seconds: Math.max(1, Math.floor(duration * 0.9)),
            amount: amounts.get('webinar_completed')!,
            label: '90%視聴完了',
          }]
        : []),
    ]
      .filter((milestone) => position < milestone.seconds)
      .sort((a, b) => a.seconds - b.seconds);

    const ctaReward = webinar.has_cta && !webinar.cta_clicked
      ? (amounts.get('webinar_cta_clicked') ?? 0)
      : 0;
    const rewardMiles = milestones.reduce((sum, milestone) => sum + milestone.amount, 0) + ctaReward;
    if (rewardMiles <= 0) continue;

    const next = milestones[0];
    const secondsToNext = next ? Math.max(0, next.seconds - position) : duration;
    const minutesToNext = Math.max(1, Math.ceil(secondsToNext / 60));
    const description = next
      ? position > 0
        ? `続きからあと約${minutesToNext}分で「${next.label}」+${next.amount} mile`
        : `まず${next.label}で +${next.amount} mile`
      : `配信内の案内を確認すると +${ctaReward} mile`;

    opportunities.push({
      id: `webinar:${webinar.id}`,
      type: 'webinar',
      title: webinar.title,
      description,
      rewardMiles,
      nextRewardMiles: next?.amount ?? ctaReward,
      progressPercent: Math.min(100, Math.max(0, Math.round((position / duration) * 100))),
      ctaLabel: position > 0 ? '続きから参加する' : '今すぐ参加する',
      url: `https://liff.line.me/${webinar.liff_id}/?page=webinar&slug=${encodeURIComponent(webinar.slug)}`,
      secondsToNext,
    });
  }

  return opportunities
    .sort((a, b) => a.secondsToNext - b.secondsToNext || b.rewardMiles - a.rewardMiles)
    .slice(0, limit)
    .map(({ secondsToNext: _secondsToNext, ...opportunity }) => opportunity);
}
