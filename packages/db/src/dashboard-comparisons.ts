import {
  DASHBOARD_COMPARISON_BETTER,
  jstDate,
  jstTimestamp,
  type DashboardComparison,
  type DashboardComparisonBasis,
  type DashboardComparisonKey,
  type DashboardComparisons,
} from '@line-crm/shared';
import { logger } from '@line-crm/shared/server';
import { parseDashboardTime } from './dashboard-freshness.js';
import { accountScopeSql, broadcastScopeSql, count, friendBreakdown } from './dashboard-inbox.js';

/**
 * ダッシュボードの数の帯の「比べる値」。
 *
 * 今日の数は先週の同じ曜日と、今月の数は前の月の同じ日・同じ時刻までと比べる。
 * 比べる期間に記録が無い数は null にする（0 として比べると「変化なし」に見える）。
 * 対応が必要な受信・写真審査は「その時点の残り」を記録していないので比べない。
 *
 * 最初の表示の口（概要）を遅くしないよう、別の口から後で読む。
 */
export async function getDashboardComparisons(
  db: D1Database,
  input: { lineAccountId: string; now?: Date },
): Promise<DashboardComparisons> {
  const now = input.now ?? new Date();
  const generatedAt = jstTimestamp(now);
  const week = weekWindows(now);
  const month = monthWindows(now);
  const scope = { allowedAccountIds: [input.lineAccountId], includeUnassigned: false };
  const skipped: DashboardComparisons['skipped'] = {};

  type Measured = { current: number; previous: number | null };
  const measure = async (
    key: DashboardComparisonKey,
    basis: DashboardComparisonBasis,
    window: { previousFrom: Date; previousTo: Date },
    run: () => Promise<Measured>,
  ): Promise<DashboardComparison | null> => {
    let measured: Measured;
    try {
      measured = await run();
    } catch {
      logger.error('dashboard_comparison_failed');
      skipped[key] = 'source_failed';
      return null;
    }
    if (measured.previous === null) {
      skipped[key] = 'no_previous_record';
      return null;
    }
    return {
      current: measured.current,
      previous: measured.previous,
      basis,
      better: DASHBOARD_COMPARISON_BETTER[key],
      asOf: generatedAt,
      previousFrom: jstTimestamp(window.previousFrom),
      previousTo: jstTimestamp(window.previousTo),
    };
  };

  const accountCreatedAt = db
    .prepare('SELECT created_at FROM line_accounts WHERE id = ?')
    .bind(input.lineAccountId)
    .first<{ created_at: string | null }>()
    .then((row) => toTime(row?.created_at ?? null));
  /** 比べる期間の初めにアカウントがあり、記録がその期間の終わりまでに始まっていたか。 */
  const recordedThrough = async (
    window: { previousFrom: Date; previousTo: Date },
    firstRecord: Promise<string | null> | null,
  ): Promise<boolean> => {
    const created = await accountCreatedAt;
    if (created === null || created > window.previousFrom.getTime()) return false;
    if (firstRecord === null) return true;
    const first = toTime(await firstRecord);
    return first !== null && first < window.previousTo.getTime();
  };

  const [todayBookings, activeFriends, deliveryFailures, monthlySent, monthlyBroadcasts] = await Promise.all([
    // 予約は日の初めから決まっている数なので、先週の同じ曜日の丸 1 日と比べる。
    measure('todayBookings', 'same_weekday_last_week', week.wholeDay, async () => {
      const day = (date: string) => count(
        db,
        `SELECT COUNT(*) AS n FROM bookings
          WHERE line_account_id = ?
            AND date(datetime(starts_at, '+9 hours')) = ?
            AND status NOT IN (${BOOKING_NOT_COUNTED})`,
        input.lineAccountId, date,
      );
      const firstBooking = db
        .prepare('SELECT MIN(created_at) AS first FROM bookings WHERE line_account_id = ?')
        .bind(input.lineAccountId)
        .first<{ first: string | null }>()
        .then((row) => row?.first ?? null);
      const [current, previous, recorded] = await Promise.all([
        day(week.today),
        day(week.previousDay),
        recordedThrough(week.wholeDay, firstBooking),
      ]);
      return { current, previous: recorded ? previous : null };
    }),
    // 友だちは先週の同じ曜日の終わりの日次の記録と比べる。
    measure('activeFriends', 'same_weekday_last_week', week.wholeDay, async () => {
      const [now, snapshot] = await Promise.all([
        friendBreakdown(db, null, accountScopeSql(scope, 'line_account_id')),
        db.prepare(
          `SELECT active FROM friend_daily_snapshots
            WHERE date = ? AND line_account_id = ?`,
        ).bind(week.previousDay, input.lineAccountId).first<{ active: number | null }>(),
      ]);
      // 日次の記録が無い日は比べない（いまの友だちから逆算した推定とは比べない）。
      return { current: now.active, previous: snapshot?.active ?? null };
    }),
    measure('deliveryFailures', 'same_weekday_last_week', week.soFar, async () => {
      const failures = (from: string, to: string | null) => count(
        db,
        `SELECT COUNT(DISTINCT instance_id) AS n FROM notification_deliveries
          WHERE line_account_id = ?
            AND status = 'failed'
            AND execution_mode = 'automatic'
            AND failed_at IS NOT NULL
            AND failed_at >= ?
            ${to === null ? '' : 'AND failed_at < ?'}`,
        input.lineAccountId, from, ...(to === null ? [] : [to]),
      );
      const firstDelivery = db
        .prepare('SELECT MIN(queued_at) AS first FROM notification_deliveries WHERE line_account_id = ?')
        .bind(input.lineAccountId)
        .first<{ first: string | null }>()
        .then((row) => row?.first ?? null);
      const [current, previous, recorded] = await Promise.all([
        // 今日の 0 時から今まで。ダッシュボードの失敗の欄と同じ数え方。
        failures(jstTimestamp(week.todayFrom), null),
        // 先週の同じ曜日の 0 時から同じ時刻まで。1 日の途中の数を丸 1 日と比べない。
        failures(jstTimestamp(week.soFar.previousFrom), jstTimestamp(week.soFar.previousTo)),
        recordedThrough(week.soFar, firstDelivery),
      ]);
      return { current, previous: recorded ? previous : null };
    }),
    measure('monthlySent', 'same_day_last_month', month, async () => {
      const messages = accountScopeSql(scope, 'ml.line_account_id');
      const sent = (from: string, to: string | null) => count(
        db,
        `SELECT COUNT(*) AS n FROM messages_log ml
          WHERE direction = 'outgoing' AND ml.created_at >= ?
            ${to === null ? '' : 'AND ml.created_at < ?'}
            AND ${messages.sql}`,
        from, ...(to === null ? [] : [to]), ...messages.binds,
      );
      const [current, previous, recorded] = await Promise.all([
        // 概要の「今月の配信」と同じ数え方（今月 1 日から）。
        sent(month.currentFromDay, null),
        sent(month.previousFromDay, jstLocal(month.previousTo)),
        recordedThrough(month, null),
      ]);
      return { current, previous: recorded ? previous : null };
    }),
    measure('monthlyBroadcasts', 'same_day_last_month', month, async () => {
      const broadcasts = broadcastScopeSql(scope);
      const sentBroadcasts = (from: string, to: string | null) => count(
        db,
        `SELECT COUNT(*) AS n FROM broadcasts b
          WHERE status = 'sent' AND COALESCE(b.sent_at, b.created_at) >= ?
            ${to === null ? '' : 'AND COALESCE(b.sent_at, b.created_at) < ?'}
            AND ${broadcasts.sql}`,
        from, ...(to === null ? [] : [to]), ...broadcasts.binds,
      );
      const [current, previous, recorded] = await Promise.all([
        sentBroadcasts(month.currentFromDay, null),
        sentBroadcasts(month.previousFromDay, jstLocal(month.previousTo)),
        recordedThrough(month, null),
      ]);
      return { current, previous: recorded ? previous : null };
    }),
  ]);

  return {
    generatedAt,
    comparisons: { todayBookings, activeFriends, deliveryFailures, monthlySent, monthlyBroadcasts },
    skipped,
  };
}

/** 今日の予約として数えない状態。取り消し・断り・期限切れ（予約の表示タブと同じ）。 */
const BOOKING_NOT_COUNTED = `'cancelled','canceled','rejected','expired'`;

const DAY_MS = 86_400_000;

function toTime(value: string | null): number | null {
  if (!value) return null;
  const time = parseDashboardTime(value);
  return Number.isFinite(time) ? time : null;
}

/** 日本時間の暦日の 0 時の瞬間。 */
function jstDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+09:00`);
}

/** 日本時間の「+09:00 を付けない」書き方。messages_log・broadcasts の時刻と比べる。 */
function jstLocal(date: Date): string {
  return jstTimestamp(date).slice(0, 23);
}

/**
 * 今日と、先週の同じ曜日。
 * - `wholeDay`：先週の同じ曜日の丸 1 日（予約・日次の記録）。
 * - `soFar`：先週の同じ曜日の 0 時から今と同じ時刻まで（1 日の途中で増える数）。
 */
export function weekWindows(now: Date): {
  today: string;
  todayFrom: Date;
  previousDay: string;
  wholeDay: { previousFrom: Date; previousTo: Date };
  soFar: { previousFrom: Date; previousTo: Date };
} {
  const today = jstDate(now);
  const previousDay = jstDate(new Date(now.getTime() - 7 * DAY_MS));
  const previousFrom = jstDayStart(previousDay);
  return {
    today,
    todayFrom: jstDayStart(today),
    previousDay,
    wholeDay: { previousFrom, previousTo: new Date(previousFrom.getTime() + DAY_MS) },
    soFar: { previousFrom, previousTo: new Date(now.getTime() - 7 * DAY_MS) },
  };
}

/**
 * 今月と、前の月の 1 日から同じ日・同じ時刻まで。
 * 前の月にその日が無い時（3/31 に対する 2 月など）は前の月の終わりまで。
 */
export function monthWindows(now: Date): {
  currentFromDay: string;
  previousFromDay: string;
  previousFrom: Date;
  previousTo: Date;
} {
  const today = jstDate(now);
  const [year, monthNumber, dayNumber] = today.split('-').map(Number);
  const previousMonthIndex = monthNumber - 2;
  const previousYear = previousMonthIndex < 0 ? year - 1 : year;
  const previousMonth = (previousMonthIndex + 12) % 12 + 1;
  const pad = (value: number) => String(value).padStart(2, '0');
  const previousFromDay = `${previousYear}-${pad(previousMonth)}-01`;
  const lastDay = new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate();
  const elapsedToday = now.getTime() - jstDayStart(today).getTime();
  const previousTo = dayNumber > lastDay
    ? jstDayStart(`${year}-${pad(monthNumber)}-01`)
    : new Date(jstDayStart(`${previousYear}-${pad(previousMonth)}-${pad(dayNumber)}`).getTime() + elapsedToday);
  return {
    currentFromDay: `${today.slice(0, 8)}01`,
    previousFromDay,
    previousFrom: jstDayStart(previousFromDay),
    previousTo,
  };
}
