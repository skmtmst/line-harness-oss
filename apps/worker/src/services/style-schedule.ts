import type {
  StyleSchedule,
  StyleSnapshot,
  RestaurantOpeningDay,
} from '@line-crm/shared';
import {
  addDate,
  civilDate,
  instant,
  styleRows,
  cancelled,
} from './style-analytics.js';
import { StyleError } from './style-setup.js';
import { getAvailability } from './availability.js';
import { eventModeRemaining } from './event-mode-capacity.js';
import {
  closuresForRange,
  openSeatTablePeriods,
  type ClosurePeriod,
} from './restaurant-closures.js';
import { restaurantCivilTime } from './restaurant-booking.js';
import type { GoogleServiceAccountCredentials } from './google-service-account.js';

/** Data shared by the board, list and day/week/month calendar. No display strings or colors. */
export async function styleSchedule(
  db: D1Database,
  account: string,
  snapshot: Pick<
    StyleSnapshot,
    'style' | 'asOf' | 'timeZone' | 'range' | 'from' | 'to'
  >,
  query: Record<string, string | undefined>,
  staffId?: string,
  googleCredentials?: GoogleServiceAccountCredentials,
): Promise<StyleSchedule> {
  const { style, asOf, timeZone, range, from, to } = snapshot;
  const display = query.display ?? 'list';
  const calendarView =
    query.calendar_view ??
    ({ today: 'day', week: 'week', month: 'month' } as const)[range];
  if (
    !['board', 'list', 'calendar'].includes(display) ||
    !['day', 'week', 'month'].includes(calendarView) ||
    (query.sort && !['time', 'name'].includes(query.sort))
  )
    throw new StyleError('invalid_display');
  if (query.from || query.to)
    throw new StyleError('schedule_requires_calendar_range');
  const firstDate = civilDate(instant(from), timeZone),
    lastDate = civilDate(instant(to) - 1, timeZone);
  const days: StyleSchedule['days'] = [];
  for (let date = firstDate; date <= lastDate; date = addDate(date, 1))
    days.push({ date, entryIds: [], bookings: 0, people: 0 });
  const columns: StyleSchedule['columns'] = (
    await db
      .prepare(
        'SELECT id,display_name name FROM staff WHERE line_account_id=? AND (? IS NULL OR id=?) ORDER BY sort_order,id',
      )
      .bind(account, staffId ?? null, staffId ?? null)
      .all<{ id: string; name: string }>()
  ).results.map((s) => ({ ...s, kind: 'staff' }));
  const entries: StyleSchedule['entries'] = [];
  const closures: StyleSchedule['closures'] = [];
  const availability: StyleSchedule['availability'] = {
    status: 'available',
    reason: null,
    resources: [...columns],
    slots: [],
    closedDates: [],
  };
  const rows = (await styleRows(db, account, style)).filter(
    (r) =>
      (!staffId || r.staffId === staffId) &&
      (!query.store_id || r.storeId === query.store_id) &&
      (!query.menu_id || r.menuId === query.menu_id) &&
      instant(r.startsAt) < instant(to) &&
      instant(r.endsAt) > instant(from),
  );
  const links =
    style === 'restaurant'
      ? (
          await db
            .prepare(
              'SELECT l.reservation_id,l.table_id FROM rt_reservation_table_links l JOIN rt_reservations r ON r.id=l.reservation_id JOIN rt_stores s ON s.id=r.store_id WHERE s.line_account_id=?',
            )
            .bind(account)
            .all<{ reservation_id: string; table_id: string }>()
        ).results
      : [];
  if (style === 'restaurant') {
    const tables = (
      await db
        .prepare(
          'SELECT t.id,t.label name,t.store_id storeId FROM rt_tables t JOIN rt_stores s ON s.id=t.store_id WHERE s.line_account_id=? AND (? IS NULL OR s.id=?) AND t.is_active=1 ORDER BY t.id',
        )
        .bind(account, query.store_id ?? null, query.store_id ?? null)
        .all<{ id: string; name: string; storeId: string }>()
    ).results;
    availability.resources = tables;
    // Time × staff is the default board. A table axis is available for the seats tab.
    if (query.axis === 'table')
      columns.splice(
        0,
        columns.length,
        ...tables.map((t) => ({ ...t, kind: 'table' as const })),
      );
    else if (query.axis && query.axis !== 'staff')
      throw new StyleError('invalid_axis');
  } else if (query.axis && query.axis !== 'staff')
    throw new StyleError('invalid_axis');
  if (style !== 'lesson')
    for (const booking of rows) {
      const tableIds = links
        .filter((l) => l.reservation_id === booking.id)
        .map((l) => l.table_id);
      const ids =
        query.axis === 'table'
          ? tableIds.length
            ? tableIds
            : booking.slotId
              ? [booking.slotId]
              : []
          : booking.staffId
            ? [booking.staffId]
            : [];
      entries.push({
        id: booking.kind + ':' + booking.id,
        kind: booking.kind,
        columnIds: ids.length ? ids : ['unassigned'],
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        title: booking.name,
        booking,
      });
    }
  if (style === 'lesson') {
    const slots = (
      await db
        .prepare(
          `SELECT s.id,s.event_id,s.starts_at,s.ends_at,s.instructor_id,e.name
      FROM event_slots s JOIN events e ON e.id=s.event_id WHERE e.line_account_id=? AND s.deleted_at IS NULL AND e.deleted_at IS NULL AND s.is_active=1
      AND (? IS NULL OR s.instructor_id=?) AND (? IS NULL OR e.id=?)
      AND julianday(s.starts_at)<julianday(?) AND julianday(s.ends_at)>julianday(?) ORDER BY s.starts_at,s.id`,
        )
        .bind(
          account,
          staffId ?? null,
          staffId ?? null,
          query.menu_id ?? null,
          query.menu_id ?? null,
          to,
          from,
        )
        .all<{
          id: string;
          event_id: string;
          starts_at: string;
          ends_at: string;
          instructor_id: string | null;
          name: string;
        }>()
    ).results;
    for (const slot of slots) {
      const columnId = slot.instructor_id ?? 'unassigned';
      entries.push({
        id: 'class:' + slot.id,
        kind: 'class',
        classId: slot.event_id,
        columnIds: [columnId],
        startsAt: slot.starts_at,
        endsAt: slot.ends_at,
        title: slot.name,
        booking: null,
      });
      for (const mode of ['classroom', 'online'] as const)
        availability.slots.push({
          columnId,
          menuId: slot.event_id,
          date: civilDate(instant(slot.starts_at), timeZone),
          startsAt: slot.starts_at,
          endsAt: slot.ends_at,
          remaining: await eventModeRemaining(db, slot.id, mode),
          mode,
          entryId: 'class:' + slot.id,
        });
    }
  }
  if (style === 'salon' || style === 'consult' || style === 'lesson') {
    const exceptions = (
      await db
        .prepare(
          `SELECT id,scope_kind,scope_id,date_from,date_to,kind,hours_json,reason
      FROM booking_availability_exceptions WHERE line_account_id=? AND date_from<=? AND date_to>=?
      AND (? IS NULL OR scope_kind='store' OR (scope_kind='staff' AND scope_id=?)) ORDER BY date_from,id`,
        )
        .bind(account, lastDate, firstDate, staffId ?? null, staffId ?? null)
        .all<{
          id: string;
          scope_kind: 'store' | 'staff' | 'resource';
          scope_id: string | null;
          date_from: string;
          date_to: string;
          kind: string;
          hours_json: string;
          reason: string | null;
        }>()
    ).results;
    closures.push(
      ...exceptions.map((e) => ({
        id: e.id,
        target: e.scope_kind,
        targetIds: [e.scope_id ?? account],
        dateFrom: e.date_from,
        dateTo: e.date_to,
        kind: e.kind,
        hours: JSON.parse(e.hours_json),
        reason: e.reason,
      })),
    );
  }
  if (style === 'salon' || style === 'consult') {
    const configured = await db
      .prepare(
        'SELECT business_hours_configured FROM booking_settings WHERE line_account_id=?',
      )
      .bind(account)
      .first<{ business_hours_configured: number }>();
    if (!configured?.business_hours_configured) {
      availability.status = 'unconfigured';
      availability.reason = 'business_hours_required';
    }
    const menus = (
      await db
        .prepare(
          'SELECT id FROM menus WHERE line_account_id=? AND is_active=1 AND deleted_at IS NULL AND (? IS NULL OR id=?) ORDER BY id LIMIT 21',
        )
        .bind(account, query.menu_id ?? null, query.menu_id ?? null)
        .all<{ id: string }>()
    ).results;
    if (menus.length > 20)
      throw new StyleError('select_menu_for_availability', 422);
    if (!menus.length) {
      availability.status = 'unconfigured';
      availability.reason = 'active_menu_required';
    }
    const closedByMenu: string[][] = [];
    for (const menu of menus) {
      const result = await getAvailability(db, {
        lineAccountId: account,
        menuId: menu.id,
        staffId,
        from: firstDate,
        to: lastDate,
        now: new Date(asOf),
        minLeadTimeMinutes: 0,
        googleCredentials,
      });
      if (!result.by_staff.length && availability.status === 'available') {
        availability.status = 'unconfigured';
        availability.reason = 'staff_menu_required';
      }
      const sync = (
        result as typeof result & {
          calendar_sync?: Array<{ configured: boolean; ok: boolean }>;
        }
      ).calendar_sync;
      if (sync?.some((s) => s.configured && !s.ok)) {
        availability.status = 'unavailable';
        availability.reason = 'calendar_unavailable';
      }
      for (const s of result.by_staff)
        for (const slot of s.slots)
          availability.slots.push({
            columnId: s.staff_id,
            menuId: menu.id,
            date: slot.date,
            startsAt: slot.startUtc,
            endsAt: slot.endUtc,
            remaining: slot.remaining,
          });
      closedByMenu.push(result.closed_dates);
    }
    availability.closedDates = days
      .filter(
        (day) =>
          closedByMenu.length &&
          closedByMenu.every((dates) => dates.includes(day.date)),
      )
      .map((d) => d.date);
    if (availability.status === 'unavailable') availability.slots = [];
    availability.slots = availability.slots.filter(
      (s) =>
        !rows.some(
          (r) =>
            r.kind === 'meet' &&
            !cancelled(r) &&
            (!r.staffId || r.staffId === s.columnId) &&
            instant(r.startsAt) < instant(s.endsAt) &&
            instant(r.endsAt) > instant(s.startsAt),
        ),
    );
  }
  if (style === 'restaurant') {
    const duration = Number(query.duration_minutes ?? 120),
      guests = Number(query.guest_count ?? 1);
    if (
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 1440 ||
      !Number.isInteger(guests) ||
      guests < 1 ||
      guests > 100
    )
      throw new StyleError('invalid_slot');
    const stores = (
      await db
        .prepare(
          'SELECT id,timezone FROM rt_stores WHERE line_account_id=? AND (? IS NULL OR id=?) ORDER BY id',
        )
        .bind(account, query.store_id ?? null, query.store_id ?? null)
        .all<{ id: string; timezone: string }>()
    ).results;
    if (!stores.length) {
      availability.status = 'unconfigured';
      availability.reason = 'store_required';
    }
    const closedByStore: string[][] = [];
    for (const store of stores) {
      const setting = await db
        .prepare(
          'SELECT hours_json FROM rt_opening_hours_settings WHERE store_id=?',
        )
        .bind(store.id)
        .first<{ hours_json: string }>();
      if (!setting) {
        availability.status = 'unconfigured';
        availability.reason = 'business_hours_required';
      }
      const hours: RestaurantOpeningDay[] = setting
        ? JSON.parse(setting.hours_json)
        : [];
      const closed = await closuresForRange(db, store.id, from, to);
      for (const c of closed)
        closures.push({
          id: c.id,
          target: JSON.parse(c.table_ids_json).length ? 'table' : 'store',
          targetIds: JSON.parse(c.table_ids_json).length
            ? JSON.parse(c.table_ids_json)
            : [store.id],
          dateFrom: c.start_date,
          dateTo: c.end_date,
          kind: c.kind,
          hours: c.all_day ? [] : [{ start: c.start_time!, end: c.end_time! }],
          reason: c.memo,
        });
      const closedDates: string[] = [];
      const candidates: ClosurePeriod[] = [];
      for (const day of days) {
        const weekday = new Date(day.date + 'T00:00:00Z').getUTCDay();
        const periods = hours.find((h) => h.weekday === weekday)?.periods ?? [];
        if (
          setting &&
          (!periods.length ||
            closed.some(
              (c) =>
                c.all_day &&
                !JSON.parse(c.table_ids_json).length &&
                c.start_date <= day.date &&
                c.end_date >= day.date,
            ))
        )
          closedDates.push(day.date);
        // Opening hours are not availability: every displayed candidate must pass the existing seat check.
        const seen = new Set<number>();
        for (const period of periods) {
          const minute = (t: string) =>
            Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
          for (
            let start = minute(period.opensAt);
            start + duration <= minute(period.closesAt);
            start += 30
          ) {
            if (seen.has(start)) continue;
            seen.add(start);
            const startsAt = restaurantCivilTime(
                day.date,
                start,
                store.timezone,
              ),
              endsAt = restaurantCivilTime(
                day.date,
                start + duration,
                store.timezone,
              );
            if (instant(startsAt) < instant(asOf)) continue;
            candidates.push({ startsAt, endsAt });
          }
        }
      }
      for (const period of await openSeatTablePeriods(
        db,
        store.id,
        candidates,
        guests,
      ))
        for (const table of period.tables)
          availability.slots.push({
            columnId: table.id,
            resourceIds: table.tableIds ?? [table.id],
            menuId: null,
            date: civilDate(instant(period.startsAt), timeZone),
            startsAt: period.startsAt,
            endsAt: period.endsAt,
            remaining: table.maxCapacity,
          });
      closedByStore.push(closedDates);
    }
    availability.closedDates = days
      .filter(
        (day) =>
          closedByStore.length &&
          closedByStore.every((dates) => dates.includes(day.date)),
      )
      .map((d) => d.date);
  }
  if (entries.some((e) => e.columnIds.includes('unassigned')))
    columns.push({ id: 'unassigned', kind: 'unassigned', name: '担当未定' });
  entries.sort((a, b) =>
    query.sort === 'name'
      ? a.title.localeCompare(b.title, 'ja') ||
        instant(a.startsAt) - instant(b.startsAt)
      : instant(a.startsAt) - instant(b.startsAt) || a.id.localeCompare(b.id),
  );
  for (const day of days) {
    const a = instant(restaurantCivilTime(day.date, 0, timeZone)),
      b = instant(restaurantCivilTime(addDate(day.date, 1), 0, timeZone));
    day.entryIds = entries
      .filter((e) => instant(e.startsAt) < b && instant(e.endsAt) > a)
      .map((e) => e.id);
    const selected = rows.filter(
      (r) =>
        civilDate(instant(r.startsAt), timeZone) === day.date &&
        !cancelled(r) &&
        !r.held,
    );
    day.bookings = selected.filter(
      (r) =>
        r.status !== 'no_show' &&
        (style === 'restaurant' || r.status !== 'requested'),
    ).length;
    day.people = selected
      .filter((r) => r.status !== 'no_show')
      .reduce((sum, r) => sum + r.partySize, 0);
  }
  return {
    style,
    asOf,
    timeZone,
    range,
    display: display as StyleSchedule['display'],
    calendarView: calendarView as StyleSchedule['calendarView'],
    from,
    to,
    columns,
    entries,
    days,
    closures,
    availability,
  };
}
