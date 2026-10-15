import type { StyleMetric } from '@line-crm/shared';

import { closuresForRange, closureAffectsTable } from './restaurant-closures.js';
import { restaurantRotation } from './restaurant-rotation.js';

import { DAY, instant, addDate, eligible, countMetric, ratio, missing } from './style-analytics-core.js';

import type { StyleAnalyticsContext } from './style-analytics-context.js';
export async function restaurantMetrics(context:StyleAnalyticsContext) {
  const {db,account,query,now,window,from,to,timeZone,rows,raw,style,staffId,settings,metrics,analytics,period}=context;
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
}
