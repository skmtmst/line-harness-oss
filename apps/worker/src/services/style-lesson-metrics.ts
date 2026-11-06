import type { StyleBooking, StyleMetric } from '@line-crm/shared';

import { DAY, instant, eligible, countMetric, ratio } from './style-analytics-core.js';

export async function lessonMetrics(
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
