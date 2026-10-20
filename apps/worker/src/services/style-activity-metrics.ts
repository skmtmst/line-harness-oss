import type { StyleBooking } from '@line-crm/shared';

import { DAY, instant, civilDate, eligible, cancelled, ratio } from './style-analytics-core.js';

import type { StyleAnalyticsContext } from './style-analytics-context.js';
export async function activityMetrics(context:StyleAnalyticsContext) {
  const {db,account,query,now,window,from,to,timeZone,rows,raw,style,staffId,settings,metrics,analytics,period}=context;
  const routeGroups = new Map<string, StyleBooking[]>();
  for (const r of period(from, to)) {
    const k = r.refCode ?? 'unknown';
    routeGroups.set(k, [...(routeGroups.get(k) ?? []), r]);
  }
  analytics.funnel = [...routeGroups].map(([route, rs]) => ({
    route,
    bookings: rs.filter(eligible).length,
    performed: rs.filter((r) => eligible(r) && r.visited).length,
    won: rs.filter((r) => r.outcome === 'won').length,
  }));
  const selected = period(from, to);
  analytics.customerHistory = selected.map((r) => {
    const before = rows.filter(
      (p) =>
        p.personKey === r.personKey &&
        p.visited &&
        instant(p.startsAt) < instant(r.startsAt),
    );
    return {
      id: r.id,
      visits: before.length,
      lastVisit: before.at(-1)?.startsAt ?? null,
      segment:
        before.length === 0
          ? 'first'
          : before.length >= 3
            ? 'regular'
            : 'returning',
    };
  });
  const reminderRows = (
    await db
      .prepare(
        `SELECT DISTINCT r.booking_id id,'booking' kind FROM booking_reminders r JOIN bookings b ON b.id=r.booking_id WHERE b.line_account_id=? AND r.status='sent'
    UNION SELECT DISTINCT r.booking_id id,'event' kind FROM event_booking_reminders r JOIN event_bookings b ON b.id=r.booking_id WHERE b.line_account_id=? AND r.status='sent'
    UNION SELECT DISTINCT m.id,'meet' kind FROM meet_consultation_notification_runs r JOIN meet_consultations m ON m.id=r.consultation_id JOIN friends f ON f.id=m.friend_id WHERE f.line_account_id=? AND r.status='sent'`,
      )
      .bind(account, account, account)
      .all<{ id: string; kind: string }>()
  ).results;
  analytics.reminderDeliveryComparison = [true, false].map((sent) => {
    const group = selected.filter(
      (r) =>
        eligible(r) &&
        reminderRows.some((m) => m.id === r.id && m.kind === r.kind) === sent,
    );
    return {
      sent,
      noShowRate: ratio(
        group.filter((r) => r.status === 'no_show').length,
        group.length,
        'リマインド送信記録あり／なしごとの無断 / 取消・押さえを除く予約',
      ),
    };
  });
  analytics.reminderComparison = ['going', 'unanswered'].map((response) => {
    const rs = selected.filter(
      (r) =>
        (response === 'going'
          ? r.confirmedResponse !== null
          : r.confirmedResponse === null) && eligible(r),
    );
    return {
      response,
      noShowRate: ratio(
        rs.filter((r) => r.status === 'no_show').length,
        rs.length,
        '返事あり／なしごとの無断 / 取消・押さえを除く予約',
      ),
    };
  });
  const sent = (
    await db
      .prepare(
        `SELECT m.broadcast_id,m.friend_id,m.created_at FROM messages_log m JOIN friends f ON f.id=m.friend_id AND f.line_account_id=m.line_account_id WHERE m.line_account_id=? AND m.direction='outgoing' AND m.broadcast_id IS NOT NULL AND julianday(m.created_at)>=julianday(?) AND julianday(m.created_at)<julianday(?)`,
      )
      .bind(
        account,
        new Date(from - 7 * DAY).toISOString(),
        new Date(to).toISOString(),
      )
      .all<{ broadcast_id: string; friend_id: string; created_at: string }>()
  ).results;
  analytics.broadcasts = [...new Set(sent.map((s) => s.broadcast_id))].map(
    (id) => {
      const rs = selected.filter((r) =>
        sent.some(
          (s) =>
            s.broadcast_id === id &&
            s.friend_id === r.friendId &&
            instant(r.requestedAt) >= instant(s.created_at) &&
            instant(r.requestedAt) < instant(s.created_at) + 7 * DAY,
        ),
      );
      return {
        id,
        attribution: 'associated_within_7_days',
        bookings: rs.filter(eligible).length,
        guests: rs.filter(eligible).reduce((n, r) => n + r.partySize, 0),
        visits: rs.filter((r) => eligible(r) && r.visited).length,
        visitedGuests: rs
          .filter((r) => eligible(r) && r.visited)
          .reduce((n, r) => n + r.partySize, 0),
      };
    },
  );
  const byDay = new Map<string, StyleBooking[]>(),
    byMenu = new Map<string, StyleBooking[]>();
  for (const row of selected) {
    const day = civilDate(instant(row.startsAt), timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
    byMenu.set(row.menuId ?? 'unknown', [
      ...(byMenu.get(row.menuId ?? 'unknown') ?? []),
      row,
    ]);
  }
  const groupMetrics = (rs: StyleBooking[]) => ({
    bookings: rs.filter(eligible).length,
    visits: rs.filter((r) => eligible(r) && r.visited).length,
    noShowRate: ratio(
      rs.filter((r) => eligible(r) && r.status === 'no_show').length,
      rs.filter(eligible).length,
      '無断 / 取消・押さえを除く予約',
    ),
    cancellations: rs.filter(cancelled).length,
    estimatedRevenue:
      style === 'salon'
        ? rs
            .filter((r) => ['confirmed', 'completed'].includes(r.status))
            .reduce((n, r) => n + r.price, 0)
        : null,
  });
  analytics.daily = [...byDay].map(([date, rs]) => ({
    date,
    ...groupMetrics(rs),
  }));
  analytics.menus = [...byMenu].map(([menuId, rs]) => ({
    menuId,
    ...groupMetrics(rs),
  }));
  analytics.cancellationReasons = (
    await db
      .prepare(
        `SELECT COALESCE(cancellation_reason,'未記録') reason,COUNT(*) count FROM bookings WHERE line_account_id=? AND status IN('cancelled','rejected') AND julianday(starts_at)>=julianday(?) AND julianday(starts_at)<julianday(?) AND (? IS NULL OR staff_id=?) GROUP BY cancellation_reason`,
      )
      .bind(account, window.from, window.to, staffId ?? null, staffId ?? null)
      .all()
  ).results;
  const sources = (
    await db
      .prepare(
        "SELECT COALESCE(ref_code,'unknown') route,COUNT(*) friends FROM friends WHERE line_account_id=? GROUP BY ref_code",
      )
      .bind(account)
      .all<{ route: string; friends: number }>()
  ).results;
  analytics.funnel = [...routeGroups].map(([route, rs]) => ({
    route,
    friends: sources.find((r) => r.route === route)?.friends ?? 0,
    bookings: rs.filter(eligible).length,
    performed: rs.filter((r) => eligible(r) && r.visited).length,
    won: rs.filter((r) => r.outcome === 'won').length,
  }));
  analytics.pageViews =
    (
      await db
        .prepare(
          'SELECT COUNT(*) count FROM booking_page_views WHERE line_account_id=? AND julianday(viewed_at)>=julianday(?) AND julianday(viewed_at)<julianday(?)',
        )
        .bind(account, window.from, window.to)
        .first<{ count: number }>()
    )?.count ?? 0;
  analytics.rescheduled =
    (
      await db
        .prepare(
          `SELECT COUNT(*) count FROM booking_audit_logs WHERE line_account_id=? AND action IN('reschedule','update','updated','change') AND julianday(occurred_at)>=julianday(?) AND julianday(occurred_at)<julianday(?) AND json_extract(before_json,'$.starts_at') IS NOT json_extract(after_json,'$.starts_at') AND (? IS NULL OR EXISTS(SELECT 1 FROM bookings b WHERE b.id=booking_audit_logs.booking_id AND b.staff_id=?))`,
        )
        .bind(account, window.from, window.to, staffId ?? null, staffId ?? null)
        .first<{ count: number }>()
    )?.count ?? 0;
return selected;
}
