import { instant, eligible, ratio } from './style-analytics-core.js';
import { personMetrics } from './style-person-metrics.js';
import type { StyleAnalyticsContext } from './style-analytics-context.js';
export async function staffMetrics(context:StyleAnalyticsContext) {
  const {db,account,query,now,window,from,to,timeZone,rows,raw,style,staffId,settings,metrics,analytics,period}=context;
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
}
