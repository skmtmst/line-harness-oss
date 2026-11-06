import type { IndustryStyle, StyleBooking, StyleMetric } from '@line-crm/shared';
import { restaurantCivilTime } from './restaurant-booking.js';

import { DAY, instant, civilDate, addDate, eligible, countMetric, ratio, missing } from './style-analytics-core.js';
import { personMetrics } from './style-person-metrics.js';
export function stylePeriodMetrics(rows: StyleBooking[], style: IndustryStyle, from: number, to: number, query: Record<string,string|undefined>, now: number, settings: Record<string,number>, timeZone: string, config: {answers_json:string}|null) {
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
        ['booking', 'meet'].includes(r.kind) &&
        instant(r.endsAt) < now &&
        instant(r.endsAt) >= now - 30 * DAY,
    );
  metrics.noShowRate = ratio(
    last30.filter((r) => r.status === 'no_show').length,
    last30.length,
    `過去${noShowDays}日の無断 / （予約 − 取消 − 押さえ）`,
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
      ['booking', 'meet'].includes(r.kind) &&
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
  return {period, metricsFor, metrics, previous, previousFrom, previousTo, past, weekFrom, weekTo};
}
