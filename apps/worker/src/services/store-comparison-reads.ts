import { comparisonKeys, type ComparisonKey, type comparisonPeriod } from './store-comparison.js';

type Period = ReturnType<typeof comparisonPeriod>;
type ComparisonNumbers = {
  name: string;
  style: string | null;
  computedAt: string | null;
  values: Record<ComparisonKey, number | null>;
};
const summedFields = ['friends_added', 'friends_blocked', 'broadcast_recipients', 'broadcast_clicks', 'bookings', 'visits', 'no_shows'] as const;
type Aggregate = Record<typeof summedFields[number], number | null> & {
  account_id: string;
  name: string | null;
  style: string | null;
  observed: number | null;
  friends_at_start: number | null;
  computed_at: string | null;
  response_minutes: number | null;
};

/** The caller supplies authorized IDs. Return one aggregate row per account, never raw histories. */
export async function readStoreComparisonNumbers(db: D1Database, accountIds: readonly string[], period: Period): Promise<Map<string, ComparisonNumbers>> {
  if (accountIds.length === 0) return new Map();
  const from = new Date(`${period.from}T00:00:00+09:00`).toISOString();
  const until = new Date(Date.parse(`${period.to}T00:00:00+09:00`) + 86400000).toISOString();
  const sums = summedFields.map(field => `CASE WHEN COUNT(${field})=COUNT(*) THEN SUM(${field}) END ${field}`).join(',');
  const result = await db.prepare(`WITH requested(account_id) AS (
      SELECT DISTINCT CAST(value AS TEXT) FROM json_each(?)
    ), daily AS (
      SELECT account_id,COUNT(*) observed,MIN(date) first_date,MIN(computed_at) computed_at,${sums}
      FROM hq_store_daily_metrics
      WHERE account_id IN (SELECT account_id FROM requested) AND date BETWEEN ? AND ? AND state!='failed'
      GROUP BY account_id
    ), ranked_responses AS (
      SELECT samples.account_id,samples.minutes,
        ROW_NUMBER() OVER (PARTITION BY samples.account_id ORDER BY samples.minutes) position,
        COUNT(*) OVER (PARTITION BY samples.account_id) sample_count
      FROM hq_store_response_samples samples JOIN daily ON daily.account_id=samples.account_id AND daily.observed=?
      WHERE julianday(samples.responded_at)>=julianday(?) AND julianday(samples.responded_at)<julianday(?) AND samples.minutes>=0
    ), medians AS (
      SELECT account_id,AVG(minutes) response_minutes FROM ranked_responses
      WHERE position IN ((sample_count+1)/2,(sample_count+2)/2) GROUP BY account_id
    )
    SELECT requested.account_id,account.name,style.style,daily.observed,daily.computed_at,
      ${summedFields.map(field => 'daily.' + field).join(',')},first_day.friends_at_start,medians.response_minutes
    FROM requested
    LEFT JOIN line_accounts account ON account.id=requested.account_id
    LEFT JOIN account_styles style ON style.line_account_id=requested.account_id AND style.selection_mode='configured'
    LEFT JOIN daily ON daily.account_id=requested.account_id
    LEFT JOIN hq_store_daily_metrics first_day ON first_day.account_id=daily.account_id AND first_day.date=daily.first_date
    LEFT JOIN medians ON medians.account_id=requested.account_id`)
    .bind(JSON.stringify(accountIds), period.from, period.to, period.days, from, until).all<Aggregate>();
  return new Map(result.results.map(row => {
    const complete = row.observed === period.days;
    const sum = (field: typeof summedFields[number]) => complete ? row[field] : null;
    const added = sum('friends_added'), blocked = sum('friends_blocked'), start = complete ? row.friends_at_start : null;
    const recipients = sum('broadcast_recipients'), clicks = sum('broadcast_clicks'), visits = sum('visits'), noShows = sum('no_shows');
    const values: Record<ComparisonKey, number | null> = {
      friendChange: added !== null && blocked !== null ? added - blocked : null,
      blockRate: start && blocked !== null ? 100 * blocked / start : null,
      clickRate: recipients && clicks !== null ? 100 * clicks / recipients : null,
      bookings: sum('bookings'), visits,
      noShowRate: visits !== null && noShows !== null && visits + noShows > 0 ? 100 * noShows / (visits + noShows) : null,
      responseMinutes: complete ? row.response_minutes : null,
    };
    if (!complete) for (const key of comparisonKeys) values[key] = null;
    return [row.account_id, { name: row.name ?? '', style: row.style, computedAt: complete ? row.computed_at : null, values }];
  }));
}
