import type { StyleBooking } from '@line-crm/shared';

import { DAY, instant, cancelled, eligible, countMetric, ratio } from './style-analytics-core.js';
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
            (r.kind !== visit.kind || r.id !== visit.id) &&
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
