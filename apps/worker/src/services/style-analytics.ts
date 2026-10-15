import { StyleError } from './style-setup.js';
import type {
  IndustryStyle,
  StyleBooking,
  StyleMetric,
  StyleSnapshot,
} from '@line-crm/shared';
import {
  restaurantCivilTime,
  validRestaurantDate,
} from './restaurant-booking.js';
import {
  closuresForRange,
  closureAffectsTable,
} from './restaurant-closures.js';
import { restaurantRotation } from './restaurant-rotation.js';

const DAY = 86_400_000;
export const cancelled = (r: StyleBooking) =>
  ['cancelled', 'rejected', 'expired'].includes(r.status);
export const eligible = (r: StyleBooking) => !cancelled(r) && !r.held;
export function instant(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value += 'T00:00:00';
  return Date.parse(
    /(?:Z|[+-]\d\d:\d\d)$/.test(value)
      ? value
      : value.replace(' ', 'T') + '+09:00',
  );
}
export const countMetric = (
  value: number,
  formula: string,
  unit = '件',
): StyleMetric => ({ value, formula, unit, status: 'available' });
export function ratio(
  numerator: number,
  denominator: number,
  formula: string,
  minimum = 1,
): StyleMetric {
  return {
    value: denominator >= minimum ? numerator / denominator : null,
    numerator,
    denominator,
    formula,
    unit: '割合',
    status: denominator >= minimum ? 'available' : 'insufficient_sample',
  };
}
export const missing = (formula: string): StyleMetric => ({
  value: null,
  formula,
  unit: '件',
  status: 'unconfigured',
});
export function civilDate(now: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}
export function addDate(date: string, days: number) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY)
    .toISOString()
    .slice(0, 10);
}
export function readWindow(
  query: { date?: string; view?: string; from?: string; to?: string },
  timeZone: string,
  now: number,
) {
  const today = query.date ?? civilDate(now, timeZone);
  if (
    !validRestaurantDate(today) ||
    (query.view &&
      !['today', 'tomorrow', 'future', 'date'].includes(query.view))
  )
    throw new StyleError('invalid_date');
  const fromDate =
    query.from ??
    addDate(
      today,
      query.view === 'tomorrow' ? 1 : query.view === 'future' ? 1 : 0,
    );
  const toDate =
    query.to ?? addDate(fromDate, query.view === 'future' ? 30 : 1);
  if (
    !validRestaurantDate(fromDate) ||
    !validRestaurantDate(toDate) ||
    fromDate >= toDate ||
    Date.parse(toDate) - Date.parse(fromDate) > 366 * DAY
  )
    throw new StyleError('invalid_date');
  return {
    from: restaurantCivilTime(fromDate, 0, timeZone),
    to: restaurantCivilTime(toDate, 0, timeZone),
    fromDate,
    toDate,
  };
}

type Row = Record<string, string | number | null>;
function normalized(r: Row): StyleBooking {
  return {
    id: String(r.id),
    version: r.version == null ? null : Number(r.version),
    updatedAt: (r.updatedAt ?? null) as string | null,
    kind: String(r.kind) as StyleBooking['kind'],
    friendId: (r.friendId ?? null) as string | null,
    personKey: String(r.personKey),
    name: String(r.name ?? ''),
    startsAt: String(r.startsAt),
    endsAt: String(r.endsAt),
    requestedAt: String(r.requestedAt),
    status: String(r.status),
    staffId: (r.staffId ?? null) as string | null,
    menuId: (r.menuId ?? null) as string | null,
    storeId: (r.storeId ?? null) as string | null,
    slotId: (r.slotId ?? null) as string | null,
    partySize: Number(r.partySize ?? 1),
    price: Number(r.price ?? 0),
    visited: !!r.visited,
    attendance: (r.attendance ?? null) as string | null,
    held: !!r.held,
    meetingMode: (r.meetingMode ?? null) as string | null,
    meetingUrl: (r.meetingUrl ?? null) as string | null,
    location: (r.location ?? null) as string | null,
    outcome: (r.outcome ?? null) as string | null,
    source: String(r.source ?? ''),
    entryPoint: (r.entryPoint ?? null) as string | null,
    refCode: (r.refCode ?? null) as string | null,
    designation: (r.designation ?? null) as string | null,
    cancelledAt: (r.cancelledAt ?? null) as string | null,
    confirmedResponse: (r.confirmedResponse ?? null) as string | null,
    participationMode: (r.participationMode ?? null) as string | null,
  };
}
/** Every join stays within the selected account. Meet rows linked to bookings are not counted twice. */
export async function styleRows(
  db: D1Database,
  account: string,
  style: IndustryStyle,
): Promise<StyleBooking[]> {
  let sql: string;
  if (style === 'restaurant')
    sql = `SELECT r.id,r.customer_version version,r.updated_at updatedAt,'restaurant' kind,f.id friendId,COALESCE(f.id,'phone:'||r.customer_phone,'reservation:'||r.id) personKey,
    r.customer_name name,r.starts_at startsAt,r.ends_at endsAt,r.created_at requestedAt,r.status,r.staff_id staffId,r.course_id menuId,r.store_id storeId,r.table_id slotId,
    r.guest_count partySize,0 price,r.status IN('visited','seated') visited,r.hold_expires_at IS NOT NULL held,r.source,NULL cancelledAt,
    (SELECT response FROM rt_reservation_confirmations WHERE reservation_id=r.id ORDER BY requested_at DESC LIMIT 1) confirmedResponse
    FROM rt_reservations r JOIN rt_stores s ON s.id=r.store_id LEFT JOIN friends f ON f.line_user_id=r.line_uid AND f.line_account_id=s.line_account_id
    WHERE s.line_account_id=?`;
  else if (style === 'lesson')
    sql = `SELECT b.id,b.updated_at updatedAt,'event' kind,b.friend_id friendId,b.friend_id personKey,f.display_name name,s.starts_at startsAt,s.ends_at endsAt,
    b.requested_at requestedAt,b.status,s.instructor_id staffId,b.event_id menuId,b.slot_id slotId,b.party_size partySize,0 price,b.status='attended' visited,
    0 held,b.status attendance,b.participation_mode participationMode,b.cancelled_at cancelledAt,f.ref_code refCode
    FROM event_bookings b JOIN event_slots s ON s.id=b.slot_id JOIN events e ON e.id=b.event_id
    JOIN friends f ON f.id=b.friend_id AND f.line_account_id=b.line_account_id WHERE b.line_account_id=?`;
  else
    sql = `SELECT b.id,b.lock_version version,b.updated_at updatedAt,'booking' kind,b.friend_id friendId,COALESCE(b.friend_id,'customer:'||b.booking_customer_id) personKey,
    COALESCE(f.display_name,c.display_name,'') name,b.starts_at startsAt,b.ends_at endsAt,b.requested_at requestedAt,b.status,b.staff_id staffId,b.menu_id menuId,
    1 partySize,COALESCE(b.price_at_booking,0) price,
    (b.status='completed' OR EXISTS(SELECT 1 FROM booking_visit_marks v WHERE v.booking_id=b.id AND v.kind IN('visited','late'))) visited,
    (SELECT kind FROM booking_visit_marks v WHERE v.booking_id=b.id ORDER BY marked_at DESC,id DESC LIMIT 1) attendance,
    b.status='pending_payment' held,COALESCE(b.meeting_mode,CASE WHEN m.meeting_mode='customer_choice' THEN NULL ELSE m.meeting_mode END) meetingMode,COALESCE(b.meeting_url,(SELECT mc.meet_url FROM meet_consultations mc WHERE mc.booking_id=b.id AND mc.status='confirmed' LIMIT 1)) meetingUrl,COALESCE(b.meeting_location,m.meeting_location) location,b.consultation_outcome outcome,
    b.source,b.entry_point entryPoint,f.ref_code refCode,b.designation,b.cancelled_at cancelledAt
    FROM bookings b LEFT JOIN menus m ON m.id=b.menu_id AND m.line_account_id=b.line_account_id LEFT JOIN friends f ON f.id=b.friend_id AND f.line_account_id=b.line_account_id
    LEFT JOIN booking_customers c ON c.id=b.booking_customer_id AND c.line_account_id=b.line_account_id WHERE b.line_account_id=?`;
  const rows = (await db.prepare(sql).bind(account).all<Row>()).results.map(
    normalized,
  );
  if (style === 'consult') {
    const meet = (
      await db
        .prepare(
          `SELECT m.id,m.updated_at updatedAt,'meet' kind,m.friend_id friendId,m.friend_id personKey,f.display_name name,m.starts_at startsAt,m.ends_at endsAt,
      m.created_at requestedAt,CASE WHEN m.attendance='no_show' THEN 'no_show' WHEN m.status='confirmed' THEN 'confirmed' ELSE m.status END status,
      m.staff_id staffId,(m.status='completed' OR m.attendance IN('visited','late')) visited,m.attendance,'online' meetingMode,m.meet_url meetingUrl,m.consultation_outcome outcome,f.ref_code refCode
      FROM meet_consultations m JOIN friends f ON f.id=m.friend_id WHERE f.line_account_id=?
      AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.id=m.booking_id AND b.line_account_id=f.line_account_id)`,
        )
        .bind(account)
        .all<Row>()
    ).results.map(normalized);
    rows.push(...meet);
  }
  return rows.sort(
    (a, b) =>
      instant(a.startsAt) - instant(b.startsAt) || a.id.localeCompare(b.id),
  );
}

export function personMetrics(
  rows: StyleBooking[],
  from: number,
  to: number,
  now: number,
  settings: Record<string, number> = {},
) {
  const histories = new Map<string, StyleBooking[]>();
  for (const r of rows.filter(
    (r) => r.visited && !cancelled(r) && instant(r.startsAt) < now,
  ))
    histories.set(r.personKey, [...(histories.get(r.personKey) ?? []), r]);
  const recall: string[] = [],
    people: Array<{
      personKey: string;
      friendId: string | null;
      name: string;
      visits: number;
      lastVisit: string;
      intervalDays: number | null;
      nextBooking: string | null;
      recall: boolean;
    }> = [];
  let second = 0,
    third = 0,
    returned = 0,
    first = 0,
    next = 0,
    visits = 0;
  for (const [key, history] of histories) {
    history.sort((a, b) => instant(a.startsAt) - instant(b.startsAt));
    const gaps = history
      .slice(1)
      .map((r, i) => (instant(r.startsAt) - instant(history[i].startsAt)) / DAY)
      .sort((a, b) => a - b);
    const median = gaps.length
      ? (gaps[Math.floor((gaps.length - 1) / 2)] +
          gaps[Math.ceil((gaps.length - 1) / 2)]) /
        2
      : null;
    const last = history.at(-1)!;
    const future = rows.find(
      (r) =>
        r.personKey === key &&
        eligible(r) &&
        r.status !== 'no_show' &&
        instant(r.startsAt) >= now,
    );
    const isRecall =
      now - instant(last.startsAt) >
        (median === null
          ? (settings.recallFallbackDays ?? 60)
          : median * (settings.recallMultiplier ?? 1.5)) *
          DAY && !future;
    if (isRecall) recall.push(key);
    people.push({
      personKey: key,
      friendId: last.friendId,
      name: last.name,
      visits: history.length,
      lastVisit: last.startsAt,
      intervalDays: median,
      nextBooking: future?.startsAt ?? null,
      recall: isRecall,
    });
    if (
      instant(history[0].startsAt) >= from &&
      instant(history[0].startsAt) < to
    ) {
      first++;
      if (history.length >= 2) second++;
      if (history.length >= 3) third++;
      if (
        history[1] &&
        instant(history[1].startsAt) - instant(history[0].startsAt) <=
          (settings.returnDays ?? 90) * DAY
      )
        returned++;
    }
    for (const visit of history.filter(
      (r) => instant(r.startsAt) >= from && instant(r.startsAt) < to,
    )) {
      visits++;
      if (
        rows.some(
          (r) =>
            r.personKey === key &&
            r.id !== visit.id &&
            eligible(r) &&
            instant(r.startsAt) > instant(visit.endsAt) &&
            instant(r.requestedAt) >= instant(visit.endsAt) &&
            instant(r.requestedAt) <=
              instant(visit.endsAt) +
                (settings.nextBookingHours ?? 24) * 3600000,
        )
      )
        next++;
    }
  }
  return {
    people,
    recall,
    metrics: {
      nextBookingRate: ratio(
        next,
        visits,
        '来店の終了から24時間以内に次回予約が作られた来店 / 来店',
      ),
      secondVisitRate: ratio(
        second,
        first,
        '初回来店の人のうち2回目に来た人 / 初回来店の人',
      ),
      thirdVisitRate: ratio(third, first, '3回目に来た人 / 初回来店の人'),
      returnRate: ratio(
        returned,
        first,
        `初回から${settings.returnDays ?? 90}日以内の再来 / 初回来店の人`,
      ),
      recall: countMetric(
        recall.length,
        '来店間隔×1.5（2回未満60日）を過ぎ次の予約がない人',
        '人',
      ),
    },
  };
}

export async function styleSnapshot(
  db: D1Database,
  account: string,
  style: IndustryStyle,
  query: Record<string, string | undefined>,
  staffId?: string,
  now = Date.now(),
): Promise<
  StyleSnapshot & {
    people: ReturnType<typeof personMetrics>['people'];
    analytics: Record<string, unknown>;
  }
> {
  if (
    query.compare &&
    !['previous', 'last_week', 'last_year'].includes(query.compare)
  )
    throw new StyleError('invalid_comparison');
  const setting = await db
    .prepare('SELECT timezone FROM booking_settings WHERE line_account_id=?')
    .bind(account)
    .first<{ timezone: string }>();
  const accountRow = await db
    .prepare('SELECT timezone FROM line_accounts WHERE id=?')
    .bind(account)
    .first<{ timezone: string }>();
  const timeZone = setting?.timezone ?? accountRow?.timezone ?? 'Asia/Tokyo';
  const window = readWindow(query, timeZone, now),
    from = instant(window.from),
    to = instant(window.to);
  const raw = await styleRows(db, account, style);
  if (query.holidays && !['all', 'exclude', 'only'].includes(query.holidays))
    throw new StyleError('invalid_holiday_filter');
  const holidays = (
    await db
      .prepare('SELECT date,name FROM style_holidays WHERE line_account_id=?')
      .bind(account)
      .all<{ date: string; name: string }>()
  ).results;
  const rows = raw.filter(
    (r) =>
      (!staffId || r.staffId === staffId) &&
      (!query.store_id || r.storeId === query.store_id) &&
      (!query.menu_id || r.menuId === query.menu_id) &&
      (!query.holidays ||
        query.holidays === 'all' ||
        (query.holidays === 'only') ===
          holidays.some(
            (h) => h.date === civilDate(instant(r.startsAt), timeZone),
          )),
  );
  const config = await db
    .prepare(
      'SELECT settings_json,answers_json FROM account_styles WHERE line_account_id=?',
    )
    .bind(account)
    .first<{ settings_json: string; answers_json: string }>();
  const settings: Record<string, number> = JSON.parse(
    config?.settings_json ?? '{}',
  );
  const period = (a: number, b: number) =>
    rows.filter((r) => instant(r.startsAt) >= a && instant(r.startsAt) < b);
  const metricsFor = (a: number, b: number) => {
    const selected = period(a, b),
      active = selected.filter(eligible),
      visits = active.filter((r) => r.visited),
      noshows = active.filter((r) => r.status === 'no_show');
    const people = personMetrics(rows, a, b, now, settings);
    return {
      bookings: countMetric(
        active.filter(
          (r) =>
            r.status !== 'no_show' &&
            (style === 'restaurant' || r.status !== 'requested'),
        ).length,
        '開始日が期間内。確定・完了（飲食は承認待ちも含む）。取消・押さえ・無断を除く',
      ),
      guests: countMetric(
        active
          .filter((r) => r.status !== 'no_show')
          .reduce((n, r) => n + r.partySize, 0),
        '取消・無断・押さえを除いた予約人数',
        '人',
      ),
      visits: countMetric(
        visits.reduce((n, r) => n + r.partySize, 0),
        '来店・出席・実施の印のある人数',
        '人',
      ),
      noShowRate: ratio(
        noshows.length,
        active.length,
        '無断 / （予約 − 取消 − 押さえ）',
      ),
      cancelRate: ratio(
        selected.filter((r) => ['cancelled', 'rejected'].includes(r.status))
          .length,
        selected.filter((r) => !r.held && r.status !== 'expired').length,
        '取消 / 押さえを除く予約',
      ),
      estimatedRevenue:
        style === 'salon'
          ? countMetric(
              active
                .filter((r) => ['confirmed', 'completed'].includes(r.status))
                .reduce((n, r) => n + r.price, 0),
              '予約時の料金×確定・完了。入金とは別',
              '円',
            )
          : missing('見込み売上はサロンのみ'),
      ...people.metrics,
    };
  };
  let previousFrom = from - (to - from),
    previousTo = from;
  if (query.compare === 'last_year') {
    const f = new Date(from),
      t = new Date(to);
    f.setUTCFullYear(f.getUTCFullYear() - 1);
    t.setUTCFullYear(t.getUTCFullYear() - 1);
    previousFrom = +f;
    previousTo = +t;
  } else if (query.compare === 'last_week') {
    previousFrom = from - 7 * DAY;
    previousTo = to - 7 * DAY;
  }
  const metrics: Record<string, StyleMetric> = metricsFor(from, to),
    previous = metricsFor(previousFrom, previousTo);
  const noShowDays = settings.noShowDays ?? 30;
  const last30 = period(now - noShowDays * DAY, now).filter(eligible),
    past = rows.filter(
      (r) =>
        eligible(r) &&
        instant(r.endsAt) < now &&
        instant(r.endsAt) >= now - 30 * DAY,
    );
  metrics.noShowRate = ratio(
    last30.filter((r) => r.status === 'no_show').length,
    last30.length,
    '過去30日の無断 / （予約 − 取消 − 押さえ）',
  );
  const comparisonOffset =
    query.compare === 'last_week'
      ? 7 * DAY
      : query.compare === 'last_year'
        ? 365 * DAY
        : noShowDays * DAY;
  metrics.nextBookingRate = personMetrics(
    rows,
    now - 30 * DAY,
    now,
    now,
    settings,
  ).metrics.nextBookingRate;
  previous.nextBookingRate = personMetrics(
    rows,
    now - comparisonOffset - 30 * DAY,
    now - comparisonOffset,
    now - comparisonOffset,
    settings,
  ).metrics.nextBookingRate;
  const previousNoShows = period(
    now - comparisonOffset - noShowDays * DAY,
    now - comparisonOffset,
  ).filter(eligible);
  previous.noShowRate = ratio(
    previousNoShows.filter((r) => r.status === 'no_show').length,
    previousNoShows.length,
    '比較期間の無断 / （予約 − 取消 − 押さえ）',
  );
  metrics.resultPending = countMetric(
    past.filter((r) => r.status !== 'no_show' && (!r.visited || !r.outcome))
      .length,
    '終了から30日以内で実施・結果のいずれかが未入力',
  );
  metrics.attention = countMetric(
    rows.filter(
      (r) =>
        r.status === 'requested' ||
        (eligible(r) &&
          !r.visited &&
          r.status !== 'no_show' &&
          instant(r.startsAt) <
            now - (style === 'restaurant' ? 30 : 15) * 60000 &&
          civilDate(instant(r.startsAt), timeZone) ===
            civilDate(now, timeZone)),
    ).length,
    '承認待ち＋本日開始15分（飲食30分）超過の来店未入力',
  );
  const todayDate = civilDate(now, timeZone),
    weekday = new Date(todayDate + 'T00:00:00Z').getUTCDay(),
    weekDate = addDate(todayDate, -((weekday + 6) % 7)),
    weekFrom = instant(restaurantCivilTime(weekDate, 0, timeZone)),
    weekTo = instant(restaurantCivilTime(addDate(weekDate, 7), 0, timeZone));
  metrics.weekBookings = countMetric(
    period(weekFrom, weekTo).filter(eligible).length,
    '月曜〜日曜に始まる予約（予約が入った日ではない）',
  );
  const performed = rows.filter(
    (r) =>
      r.visited &&
      eligible(r) &&
      instant(r.startsAt) >= now - 90 * DAY &&
      instant(r.startsAt) < now,
  );
  metrics.conversionRate = ratio(
    new Set(
      performed.filter((r) => r.outcome === 'won').map((r) => r.personKey),
    ).size,
    new Set(performed.map((r) => r.personKey)).size,
    '過去90日の成約した人 / 実施した人',
  );
  if (
    !performed.some((r) => r.outcome !== null) &&
    JSON.parse(config?.answers_json ?? '{}').outcome?.mode !== 'configured'
  )
    metrics.conversionRate = missing('面談の結果が未設定');
  const analytics: Record<string, unknown> = {
    periodMetrics: metricsFor(from, to),
  };
  if (style === 'restaurant') {
    const stores = (
      await db
        .prepare('SELECT id FROM rt_stores WHERE line_account_id=?')
        .bind(account)
        .all<{ id: string }>()
    ).results.filter((s) => !query.store_id || s.id === query.store_id);
    const rotation = [];
    for (
      let date = window.fromDate;
      date < window.toDate;
      date = addDate(date, 1)
    )
      for (const store of stores)
        rotation.push({
          storeId: store.id,
          ...(await restaurantRotation(db, store.id, date, now)),
        });
    analytics.rotation = rotation;
    const openMinutes = rotation.reduce(
        (n, r) => n + (r.openTableMinutes ?? 0),
        0,
      ),
      occupiedMinutes = rotation.reduce(
        (n, r) => n + (r.occupiedTableMinutes ?? 0),
        0,
      ),
      departures = rotation.reduce((n, r) => n + r.departedGroups, 0),
      tableDays = rotation.reduce((n, r) => n + r.activeTables, 0),
      measured = rotation.reduce((n, r) => n + r.measuredDepartures, 0);
    analytics.rotationSummary = {
      turnover: ratio(
        departures,
        tableDays,
        '期間の退店組数 / 期間の営業卓日数',
      ),
      utilization: rotation.some((r) => r.occupiedTableMinutes === null)
        ? missing('営業時間または来店時刻が未取得')
        : ratio(
            occupiedMinutes,
            openMinutes,
            '期間の着席分数 / 期間の営業卓分数',
          ),
      averageStayMinutes: measured
        ? rotation.reduce((n, r) => n + r.totalStayMinutes, 0) / measured
        : null,
      noShowRate: (analytics.periodMetrics as Record<string, StyleMetric>)
        .noShowRate,
    };

    const currentPeople = new Map(
      period(from, to)
        .filter((r) => eligible(r) && r.status !== 'no_show')
        .map((r) => [r.personKey, r]),
    );
    const priorVisits = (key: string) =>
      rows.filter(
        (r) => r.personKey === key && r.visited && instant(r.startsAt) < from,
      ).length;
    metrics.firstTime = countMetric(
      [...currentPeople.keys()].filter((key) => priorVisits(key) === 0).length,
      '期間の予約者で期間より前の来店0回',
      '人',
    );
    metrics.regular = countMetric(
      [...currentPeople.keys()].filter((key) => priorVisits(key) >= 3).length,
      '期間の予約者で期間より前の来店3回以上',
      '人',
    );
    const tables = (
      await db
        .prepare(
          `SELECT t.id,t.store_id FROM rt_tables t JOIN rt_stores s ON s.id=t.store_id WHERE s.line_account_id=? AND t.is_active=1`,
        )
        .bind(account)
        .all<{ id: string; store_id: string }>()
    ).results;
    const occupied = (
      await db
        .prepare(
          `SELECT DISTINCT l.table_id FROM rt_reservation_table_links l JOIN rt_reservations r ON r.id=l.reservation_id JOIN rt_stores s ON s.id=r.store_id WHERE s.line_account_id=? AND r.status NOT IN('cancelled','no_show') AND r.departed_at IS NULL AND (r.hold_expires_at IS NULL OR julianday(r.hold_expires_at)>julianday('now')) AND julianday(r.starts_at)<=julianday(?) AND julianday(r.ends_at)>julianday(?)`,
        )
        .bind(account, new Date(now).toISOString(), new Date(now).toISOString())
        .all<{ table_id: string }>()
    ).results;
    const pendingTasks =
      (
        await db
          .prepare(
            `SELECT COUNT(*) count FROM (SELECT t.id FROM rt_channel_close_tasks t JOIN rt_stores s ON s.id=t.store_id WHERE s.line_account_id=? AND t.status='open' UNION ALL SELECT t.id FROM rt_reservation_close_tasks t JOIN rt_stores s ON s.id=t.store_id WHERE s.line_account_id=? AND t.status='open' UNION ALL SELECT t.id FROM rt_closure_close_tasks t JOIN rt_stores s ON s.id=t.store_id WHERE s.line_account_id=? AND t.status='open')`,
          )
          .bind(account, account, account)
          .first<{ count: number }>()
      )?.count ?? 0;
    metrics.mediaCloseTasks = countMetric(
      pendingTasks,
      '媒体の枠を閉じる未対応',
    );
    metrics.unseated = countMetric(
      rows
        .filter(
          (r) =>
            eligible(r) &&
            instant(r.startsAt) >= now &&
            instant(r.startsAt) < now + 7 * DAY,
        )
        .filter(
          (r) =>
            !raw.find((p) => p.id === r.id && p.storeId === r.storeId)?.slotId,
        ).length,
      '今日から7日の未配席',
    );
    metrics.attention.value =
      (metrics.attention.value ?? 0) +
      pendingTasks +
      (metrics.unseated.value ?? 0);
    const closed = await Promise.all(
      stores.map(async (store) => ({
        storeId: store.id,
        items: await closuresForRange(
          db,
          store.id,
          new Date(now).toISOString(),
          new Date(now + 60000).toISOString(),
        ),
      })),
    );
    metrics.freeTables = countMetric(
      tables.filter(
        (t) =>
          !closed.some(
            (c) =>
              c.storeId === t.store_id &&
              c.items.some((item) => closureAffectsTable(item, t.id)),
          ) &&
          (!query.store_id || t.store_id === query.store_id) &&
          !occupied.some((o) => o.table_id === t.id),
      ).length,
      '有効卓のうち現在の予約が重なっていない卓',
      '卓',
    );
  }
  if (style === 'salon' || style === 'consult') {
    const shifts = (
      await db
        .prepare(
          `SELECT sh.*,s.id staffId FROM staff_shifts sh JOIN staff s ON s.id=sh.staff_id WHERE s.line_account_id=? AND sh.work_date>=? AND sh.work_date<?`,
        )
        .bind(account, window.fromDate, window.toDate)
        .all<{
          staffId: string;
          work_date: string;
          start_time: string;
          end_time: string;
        }>()
    ).results;
    analytics.staff = [
      ...new Set(rows.map((r) => r.staffId).filter((v): v is string => !!v)),
    ]
      .filter((id) => !staffId || id === staffId)
      .map((id) => {
        const reservations = period(from, to).filter(
          (r) => r.staffId === id && eligible(r),
        );
        const minutes = shifts
          .filter((s) => s.staffId === id)
          .reduce(
            (n, s) =>
              n +
              (Number(s.end_time.slice(0, 2)) * 60 +
                Number(s.end_time.slice(3))) -
              (Number(s.start_time.slice(0, 2)) * 60 +
                Number(s.start_time.slice(3))),
            0,
          );
        return {
          staffId: id,
          bookings: reservations.length,
          utilization: ratio(
            reservations
              .filter((r) => r.status !== 'no_show')
              .reduce(
                (n, r) => n + (instant(r.endsAt) - instant(r.startsAt)) / 60000,
                0,
              ),
            minutes,
            '予約時間 / 勤務表の時間',
          ),
          designationRate: ratio(
            reservations.filter((r) => r.designation === 'designated').length,
            reservations.filter((r) => r.designation !== 'unspecified').length,
            '指名 / 指名の選択が記録された予約',
          ),
          ...personMetrics(
            rows.filter((r) => r.staffId === id),
            from,
            to,
            now,
            settings,
          ).metrics,
        };
      });
  }
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
    UNION SELECT DISTINCT m.id,'meet' kind FROM meet_consultation_reminders r JOIN meet_consultations m ON m.id=r.consultation_id JOIN friends f ON f.id=m.friend_id WHERE f.line_account_id=? AND r.status='sent'`,
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
  if (style === 'lesson')
    await lessonMetrics(
      db,
      account,
      rows,
      from,
      to,
      weekFrom,
      weekTo,
      now,
      metrics,
      analytics,
      staffId,
      settings,
    );
  analytics.resultPending = past.filter(
    (r) => r.status !== 'no_show' && (!r.visited || !r.outcome),
  );
  const people = personMetrics(rows, from, to, now, settings).people;
  const selection = query.selection ?? 'bookings';
  if (
    ![
      'bookings',
      'visits',
      'no_show',
      'recall',
      'result_pending',
      'inactive_members',
    ].includes(selection)
  )
    throw new StyleError('invalid_selection');
  const selectionRows =
    selection === 'visits'
      ? selected.filter((r) => r.visited && eligible(r))
      : selection === 'no_show'
        ? selected.filter((r) => r.status === 'no_show' && eligible(r))
        : selection === 'recall'
          ? rows.filter((r) =>
              people.some((p) => p.personKey === r.personKey && p.recall),
            )
          : selection === 'result_pending'
            ? past.filter(
                (r) => r.status !== 'no_show' && (!r.visited || !r.outcome),
              )
            : selected.filter(
                (r) =>
                  eligible(r) &&
                  r.status !== 'no_show' &&
                  (style === 'restaurant' ||
                    style === 'lesson' ||
                    r.status !== 'requested'),
              );
  const selectedPeople =
    selection === 'inactive_members'
      ? (
          (analytics.members as Array<{
            id: string;
            lastAttendance: string | null;
            assigned_at: string;
            nextBooking: string | null;
          }>) ?? []
        )
          .filter(
            (p) =>
              !p.nextBooking &&
              now - instant(p.lastAttendance ?? p.assigned_at) >=
                (settings.inactiveDays ?? 14) * DAY,
          )
          .map((p) => ({
            id: p.id,
            kind: 'event',
            friendId: p.id,
            personKey: p.id,
          }))
      : selectionRows.map((r) => ({
          id: r.id,
          kind: r.kind,
          friendId: r.friendId,
          personKey: r.personKey,
        }));
  const minimumSample = settings.minimumSample ?? 1;
  const suppress = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') return;
    const record = obj as Record<string, unknown>;
    if (
      typeof record.denominator === 'number' &&
      record.status === 'available' &&
      record.denominator < minimumSample
    ) {
      record.value = null;
      record.status = 'insufficient_sample';
    } else for (const value of Object.values(record)) suppress(value);
  };
  suppress(metrics);
  suppress(previous);
  suppress(analytics);
  analytics.holidays = holidays;
  analytics.targets = (
    await db
      .prepare(
        'SELECT metric,period,value FROM style_targets WHERE line_account_id=?',
      )
      .bind(account)
      .all()
  ).results;
  await db
    .prepare(
      `DELETE FROM style_analytics_results WHERE id IN(SELECT r.id FROM style_analytics_results r WHERE r.expires_at<=? AND NOT EXISTS(SELECT 1 FROM analytics_result_audiences a WHERE a.source_result_id=r.id AND a.expires_at>?) LIMIT 100)`,
    )
    .bind(new Date(now).toISOString(), new Date(now).toISOString())
    .run();
  const resultId = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO style_analytics_results(id,line_account_id,style,selection_json,created_at,expires_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      resultId,
      account,
      style,
      JSON.stringify({
        ids: selectedPeople,
        selection,
        staffId: staffId ?? null,
      }),
      new Date(now).toISOString(),
      new Date(now + DAY).toISOString(),
    )
    .run();
  return {
    style,
    asOf: new Date(now).toISOString(),
    timeZone,
    from: window.from,
    to: window.to,
    dateBasis: 'visit',
    metrics,
    previous,
    items: selected,
    newBookings: rows.filter(
      (r) => instant(r.requestedAt) >= from && instant(r.requestedAt) < to,
    ),
    resultId,
    people: personMetrics(rows, from, to, now, settings).people,
    analytics,
  };
}

async function lessonMetrics(
  db: D1Database,
  account: string,
  rows: StyleBooking[],
  from: number,
  to: number,
  weekFrom: number,
  weekTo: number,
  now: number,
  metrics: Record<string, StyleMetric>,
  analytics: Record<string, unknown>,
  staffId: string | undefined,
  settings: Record<string, number>,
) {
  const slots = (
    await db
      .prepare(
        `SELECT s.*,e.name,e.is_trial FROM event_slots s JOIN events e ON e.id=s.event_id WHERE e.line_account_id=? AND s.deleted_at IS NULL AND e.deleted_at IS NULL AND s.is_active=1`,
      )
      .bind(account)
      .all<{
        id: string;
        event_id: string;
        starts_at: string;
        ends_at: string;
        capacity: number | null;
        classroom_capacity: number | null;
        online_capacity: number | null;
        instructor_id: string | null;
        is_trial: number;
        name: string;
      }>()
  ).results.filter((s) => !staffId || s.instructor_id === staffId);
  const selected = slots.filter(
    (s) => instant(s.starts_at) >= from && instant(s.starts_at) < to,
  );
  analytics.classes = selected.map((s) => ({
    ...s,
    bookings: rows.filter((r) => r.slotId === s.id && eligible(r)),
    classroomReserved: rows
      .filter(
        (r) =>
          r.slotId === s.id &&
          eligible(r) &&
          r.participationMode === 'classroom',
      )
      .reduce((n, r) => n + r.partySize, 0),
    onlineReserved: rows
      .filter(
        (r) =>
          r.slotId === s.id && eligible(r) && r.participationMode === 'online',
      )
      .reduce((n, r) => n + r.partySize, 0),
  }));
  metrics.classes = countMetric(selected.length, '期間に始まる有効な回', '回');
  analytics.attendancePending = slots.filter(
    (s) =>
      instant(s.ends_at) < now &&
      instant(s.ends_at) >= now - 7 * DAY &&
      rows.some((r) => r.slotId === s.id && r.status === 'confirmed'),
  );
  metrics.attendancePending = countMetric(
    slots.filter(
      (s) =>
        instant(s.ends_at) < now &&
        instant(s.ends_at) >= now - 7 * DAY &&
        rows.some((r) => r.slotId === s.id && r.status === 'confirmed'),
    ).length,
    '終了7日以内で出欠未入力の人がいる回',
    '回',
  );
  metrics.capacity = countMetric(
    selected.reduce(
      (n, s) =>
        n +
        (s.classroom_capacity ?? s.capacity ?? 0) +
        (s.online_capacity ?? 0),
      0,
    ),
    '上限がある回の定員のみ合計',
    '人',
  );
  metrics.unlimitedClasses = countMetric(
    selected.filter(
      (s) =>
        s.capacity === null &&
        s.classroom_capacity === null &&
        s.online_capacity === null,
    ).length,
    '上限なしの回',
    '回',
  );
  for (const mode of ['classroom', 'online'] as const) {
    const week = slots.filter(
      (s) =>
        instant(s.starts_at) >= weekFrom &&
        instant(s.starts_at) < weekTo &&
        (mode === 'classroom'
          ? (s.classroom_capacity ?? s.capacity)
          : s.online_capacity) !== null,
    );
    const capacity = week.reduce(
      (n, s) =>
        n +
        (mode === 'classroom'
          ? (s.classroom_capacity ?? s.capacity ?? 0)
          : (s.online_capacity ?? 0)),
      0,
    );
    const reserved = rows
      .filter(
        (r) =>
          week.some((s) => s.id === r.slotId) &&
          eligible(r) &&
          r.participationMode === mode,
      )
      .reduce((n, r) => n + r.partySize, 0);
    metrics[mode + 'Occupancy'] = ratio(
      reserved,
      capacity,
      '今週の上限がある回の予約人数 / 定員',
    );
  }
  const members = (
    await db
      .prepare(
        `SELECT f.id,f.display_name,ft.assigned_at FROM friends f JOIN friend_tags ft ON ft.friend_id=f.id JOIN tags t ON t.id=ft.tag_id AND t.line_account_id=f.line_account_id WHERE f.line_account_id=? AND t.name='会員'`,
      )
      .bind(account)
      .all<{ id: string; display_name: string; assigned_at: string }>()
  ).results;
  const people = members.map((m) => {
    const visits = rows.filter(
      (r) => r.friendId === m.id && r.visited && instant(r.startsAt) < now,
    );
    return {
      ...m,
      lastAttendance: visits.at(-1)?.startsAt ?? null,
      nextBooking:
        rows.find(
          (r) =>
            r.friendId === m.id && eligible(r) && instant(r.startsAt) >= now,
        )?.startsAt ?? null,
    };
  });
  analytics.members = people;
  metrics.inactiveMembers = countMetric(
    people.filter(
      (p) =>
        !p.nextBooking &&
        now - instant(p.lastAttendance ?? p.assigned_at) >=
          (settings.inactiveDays ?? 14) * DAY,
    ).length,
    '会員タグがあり14日以上出席がなく次の予約もない人',
    '人',
  );
  const trial = rows.filter(
    (r) =>
      r.visited &&
      instant(r.startsAt) >= from &&
      instant(r.startsAt) < to &&
      slots.some((s) => s.id === r.slotId && s.is_trial === 1),
  );
  const ids = [...new Set(trial.map((r) => r.friendId))];
  metrics.trialConversion = ratio(
    ids.filter((id) =>
      members.some(
        (m) =>
          m.id === id &&
          trial.some(
            (r) =>
              r.friendId === id &&
              instant(m.assigned_at) >= instant(r.startsAt) &&
              instant(m.assigned_at) <= instant(r.startsAt) + 30 * DAY,
          ),
      ),
    ).length,
    ids.length,
    '体験から30日以内の入会 / 期間中に体験へ出席した人',
  );
}
