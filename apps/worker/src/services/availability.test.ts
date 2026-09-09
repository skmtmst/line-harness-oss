import { describe, expect, test, vi } from 'vitest';
import { computeSlots, getAvailability, type Interval } from './availability.js';

const MENU_60 = { duration_minutes: 60, buffer_after_minutes: 0 };
const MENU_60_BUF15 = { duration_minutes: 60, buffer_after_minutes: 15 };

describe('computeSlots', () => {
  test('シフトのみ、予約なし → 30分刻みで列挙', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const slots = computeSlots({ working, busy: [], menu: MENU_60, granularityMinutes: 30 });
    expect(slots).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '10:30', end: '11:30' },
      { start: '11:00', end: '12:00' },
    ]);
  });

  test('既存予約と重なるスロットは除外', () => {
    const working: Interval[] = [{ start: '10:00', end: '13:00' }];
    const busy: Interval[] = [{ start: '11:00', end: '12:00' }];
    const slots = computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 });
    expect(slots).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '12:00', end: '13:00' },
    ]);
  });

  test('buffer_after が次のスロットへ波及', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const slots = computeSlots({
      working,
      busy: [],
      menu: MENU_60_BUF15,
      granularityMinutes: 30,
    });
    expect(slots).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '10:30', end: '11:30' },
    ]);
  });

  test('working の終端でメニューが収まらないと除外', () => {
    const working: Interval[] = [{ start: '10:00', end: '11:00' }];
    expect(
      computeSlots({ working, busy: [], menu: MENU_60, granularityMinutes: 30 }),
    ).toEqual([{ start: '10:00', end: '11:00' }]);
  });

  test('working なし → 空配列', () => {
    expect(
      computeSlots({ working: [], busy: [], menu: MENU_60, granularityMinutes: 30 }),
    ).toEqual([]);
  });

  test('複数の working 区間（昼休みあり）', () => {
    const working: Interval[] = [
      { start: '10:00', end: '12:00' },
      { start: '13:00', end: '15:00' },
    ];
    const slots = computeSlots({ working, busy: [], menu: MENU_60, granularityMinutes: 30 });
    expect(slots.map((s) => s.start)).toEqual([
      '10:00',
      '10:30',
      '11:00',
      '13:00',
      '13:30',
      '14:00',
    ]);
  });

  test('busy 完全包含 → working 全部消える', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const busy: Interval[] = [{ start: '09:00', end: '13:00' }];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }),
    ).toEqual([]);
  });

  test('busy 完全交差なし → working 全部残る', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const busy: Interval[] = [{ start: '13:00', end: '14:00' }];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }),
    ).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '10:30', end: '11:30' },
      { start: '11:00', end: '12:00' },
    ]);
  });

  test('busy が working 末尾にかかる', () => {
    const working: Interval[] = [{ start: '10:00', end: '13:00' }];
    const busy: Interval[] = [{ start: '12:30', end: '14:00' }];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }).map(
        (s) => s.start,
      ),
    ).toEqual(['10:00', '10:30', '11:00', '11:30']);
  });

  test('複数 busy が連続', () => {
    const working: Interval[] = [{ start: '10:00', end: '15:00' }];
    const busy: Interval[] = [
      { start: '11:00', end: '12:00' },
      { start: '12:00', end: '13:00' },
    ];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }).map(
        (s) => s.start,
      ),
    ).toEqual(['10:00', '13:00', '13:30', '14:00']);
  });

  test('30分刻みでない busy にも対応 (10:15-10:45)', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const busy: Interval[] = [{ start: '10:15', end: '10:45' }];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }).map(
        (s) => s.start,
      ),
    ).toEqual(['11:00']);
  });
});

// ----------------------------------------------------------------
// getAvailability (DB 層 + リードタイム + 仮想スタッフ)
// ----------------------------------------------------------------

interface StubException {
  scope_kind: string;
  scope_id: string | null;
  date_from: string;
  date_to: string;
  kind: string;
  hours_json: string;
}

interface StubData {
  menu?: {
    duration_minutes: number;
    buffer_after_minutes: number;
    override_duration: number | null;
    override_price: number | null;
    concurrent_capacity?: number | null;
    booking_window_days?: number | null;
    cutoff_hours_before?: number | null;
  };
  staff?: Array<{ id: string; display_name: string; is_designation_optional: number }>;
  shifts?: Array<{ staff_id: string; work_date: string; start_time: string; end_time: string }>;
  rules?: Array<{ staff_id: string; weekday: number; start_time: string; end_time: string }>;
  bookings?: Array<{ staff_id: string; starts_at: string; block_ends_at: string }>;
  menuResources?: Array<{ id: string; capacity: number; quantity: number }>;
  exceptions?: StubException[];
  timezone?: string | null;
  calendarConnection?: {
    id: string;
    calendar_id: string;
    auth_type: string;
    access_token: string | null;
  };
}

function stubDB(data: StubData, seen?: Array<{ sql: string; args: unknown[] }>): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          seen?.push({ sql, args });
          return this;
        },
        async first() {
          if (sql.includes('FROM booking_settings')) {
            return data.timezone === undefined ? null : { timezone: data.timezone };
          }
          if (sql.includes('FROM menus')) return data.menu ?? null;
          if (sql.includes('FROM google_calendar_connections')) return data.calendarConnection ?? null;
          return null;
        },
        async all() {
          if (sql.includes('booking_availability_exceptions')) {
            return { results: data.exceptions ?? [] };
          }
          if (sql.includes('booking_menu_resources')) {
            return { results: data.menuResources ?? [] };
          }
          if (sql.includes('FROM staff') && sql.includes('staff_menus')) {
            return { results: data.staff ?? [] };
          }
          if (sql.includes('FROM staff_shifts')) {
            return { results: data.shifts ?? [] };
          }
          if (sql.includes('FROM staff_availability_rules')) {
            return { results: data.rules ?? [] };
          }
          if (sql.includes('FROM bookings')) {
            return { results: data.bookings ?? [] };
          }
          return { results: [] };
        },
        async run() { return { success: true, meta: {} }; },
      };
    },
  } as unknown as D1Database;
}

const STAFF_S1 = [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }];
const MENU_BASIC = {
  duration_minutes: 60,
  buffer_after_minutes: 0,
  override_duration: null,
  override_price: null,
};

function closedException(over: Partial<StubException> = {}): StubException {
  return {
    scope_kind: 'store',
    scope_id: null,
    date_from: '2026-05-09',
    date_to: '2026-05-09',
    kind: 'closed',
    hours_json: '[]',
    ...over,
  };
}

describe('getAvailability', () => {
  test('指名なしで 1 スタッフ 1 日、シフト内で空き', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff).toHaveLength(1);
    expect(result.by_staff[0].slots.map((s) => `${s.date} ${s.start}`)).toEqual([
      '2026-05-09 10:00',
      '2026-05-09 10:30',
      '2026-05-09 11:00',
    ]);
  });

  test('リードタイム未満のスロットは除外', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    // 現在: 2026-05-09 10:30 JST = 2026-05-09 01:30 UTC
    // リードタイム 60 分 → 11:30 JST 以降だが、10:00/10:30/11:00 開始しか枠が無い → 全除外
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-09T01:30:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff[0].slots).toEqual([]);
  });

  test('既存予約があるとその時間帯は除外', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '13:00' }],
      // 11:00-12:00 JST = 02:00-03:00 UTC
      bookings: [{ staff_id: 'S1', starts_at: '2026-05-09T02:00:00Z', block_ends_at: '2026-05-09T03:00:00Z' }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    // 11:00-12:00 が busy なので 10:00 / 12:00 だけが残るはず
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '12:00']);
  });

  test('シフト無い日はスロット出ない', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff[0].slots).toEqual([]);
  });

  test('曜日ルールは有限シフトなしでも将来の日付に適用される', async () => {
    const db = stubDB({
      menu: { duration_minutes: 60, buffer_after_minutes: 0, override_duration: null, override_price: null },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [],
      // 2030-01-05 is Saturday. This verifies the rule does not expire.
      rules: [{ staff_id: 'S1', weekday: 6, start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1', menuId: 'M1', from: '2030-01-05', to: '2030-01-05',
      now: new Date('2029-12-01T00:00:00Z'), minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((slot) => slot.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('Googleカレンダーのbusy時間を予約候補から除外する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      calendars: { 'cal@example.com': { busy: [{ start: '2026-05-09T02:00:00Z', end: '2026-05-09T03:00:00Z' }] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    try {
      const db = stubDB({
        menu: { duration_minutes: 60, buffer_after_minutes: 0, override_duration: null, override_price: null },
        staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
        shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '13:00' }],
        bookings: [],
        calendarConnection: { id: 'GC1', calendar_id: 'cal@example.com', auth_type: 'oauth', access_token: 'token' },
      });
      const result = await getAvailability(db, {
        lineAccountId: 'A1', menuId: 'M1', from: '2026-05-09', to: '2026-05-09',
        now: new Date('2026-05-08T00:00:00Z'), minLeadTimeMinutes: 0,
      });
      expect(result.by_staff[0].slots.map((slot) => slot.start)).toEqual(['10:00', '12:00']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('staff_id 指定 → そのスタッフのみ', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      staffId: 'S1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff).toHaveLength(1);
    expect(result.by_staff[0].staff_id).toBe('S1');
  });

  test('メニュー無し → 空 by_staff', async () => {
    const db = stubDB({});
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'NOPE',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff).toEqual([]);
  });
});

describe('getAvailability の例外日（休業日・終日・時間帯）', () => {
  test('店舗の休業日はシフトがあっても枠を出さない', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      exceptions: [closedException()],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots).toEqual([]);
  });

  test('担当者の終日例外はその人だけ塞ぎ、別担当は残る', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: [
        ...STAFF_S1,
        { id: 'S2', display_name: '佐藤', is_designation_optional: 0 },
      ],
      shifts: [
        { staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' },
        { staff_id: 'S2', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' },
      ],
      exceptions: [closedException({ scope_kind: 'staff', scope_id: 'S1' })],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff.find((s) => s.staff_id === 'S1')?.slots).toEqual([]);
    expect(
      result.by_staff.find((s) => s.staff_id === 'S2')?.slots.map((s) => s.start),
    ).toEqual(['10:00', '10:30', '11:00']);
  });

  test('担当の時間帯例外（短縮）はその日の稼働を置き換える', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '18:00' }],
      exceptions: [{
        scope_kind: 'staff',
        scope_id: 'S1',
        date_from: '2026-05-09',
        date_to: '2026-05-09',
        kind: 'custom_hours',
        hours_json: JSON.stringify([{ start: '13:00', end: '15:00' }]),
      }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['13:00', '13:30', '14:00']);
  });

  test('店舗の時間帯例外（短縮）は稼働との共通部分に絞る', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '18:00' }],
      exceptions: [{
        scope_kind: 'store',
        scope_id: null,
        date_from: '2026-05-09',
        date_to: '2026-05-09',
        kind: 'custom_hours',
        hours_json: JSON.stringify([{ start: '10:00', end: '12:00' }]),
      }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('担当の臨時営業はシフトの無い日に枠を作る', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [],
      exceptions: [{
        scope_kind: 'staff',
        scope_id: 'S1',
        date_from: '2026-05-10',
        date_to: '2026-05-10',
        kind: 'open',
        hours_json: JSON.stringify([{ start: '10:00', end: '12:00' }]),
      }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-10',
      to: '2026-05-10',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('重複例外は closed が勝ち、時間帯の重なりは union になる', async () => {
    const customA: StubException = {
      scope_kind: 'staff',
      scope_id: 'S1',
      date_from: '2026-05-09',
      date_to: '2026-05-09',
      kind: 'custom_hours',
      hours_json: JSON.stringify([{ start: '10:00', end: '11:00' }]),
    };
    const customB: StubException = {
      ...customA,
      hours_json: JSON.stringify([{ start: '11:00', end: '12:00' }]),
    };
    const unionDb = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '18:00' }],
      exceptions: [customA, customB],
    });
    const unionResult = await getAvailability(unionDb, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(unionResult.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);

    const closedWinsDb = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '18:00' }],
      exceptions: [customA, closedException({ scope_kind: 'staff', scope_id: 'S1' })],
    });
    const closedWins = await getAvailability(closedWinsDb, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(closedWins.by_staff[0].slots).toEqual([]);
  });

  test('日跨ぎの期間休業は範囲内の各日を塞ぎ、範囲外は残す', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [
        { staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' },
        { staff_id: 'S1', work_date: '2026-05-10', start_time: '10:00', end_time: '12:00' },
        { staff_id: 'S1', work_date: '2026-05-11', start_time: '10:00', end_time: '12:00' },
        { staff_id: 'S1', work_date: '2026-05-12', start_time: '10:00', end_time: '12:00' },
      ],
      exceptions: [closedException({ date_from: '2026-05-09', date_to: '2026-05-11' })],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-12',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    const byDate = new Map<string, number>();
    for (const slot of result.by_staff[0].slots) {
      byDate.set(slot.date, (byDate.get(slot.date) ?? 0) + 1);
    }
    expect(byDate.get('2026-05-09')).toBeUndefined();
    expect(byDate.get('2026-05-10')).toBeUndefined();
    expect(byDate.get('2026-05-11')).toBeUndefined();
    expect(byDate.get('2026-05-12')).toBe(3);
  });

  test('JST の日付で突合する（前日・翌日には波及しない）', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [
        { staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' },
        { staff_id: 'S1', work_date: '2026-05-10', start_time: '10:00', end_time: '12:00' },
      ],
      exceptions: [closedException({ date_from: '2026-05-09', date_to: '2026-05-09' })],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-10',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    const dates = result.by_staff[0].slots.map((s) => s.date);
    expect(dates.length).toBeGreaterThan(0);
    expect(new Set(dates)).toEqual(new Set(['2026-05-10']));
  });

  test('例外日の取得は要求アカウントに絞る（他アカウントの休業を見ない）', async () => {
    const seen: Array<{ sql: string; args: unknown[] }> = [];
    const db = stubDB(
      {
        menu: MENU_BASIC,
        staff: STAFF_S1,
        shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
        exceptions: [],
      },
      seen,
    );
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    const query = seen.find((s) => s.sql.includes('booking_availability_exceptions'));
    expect(query?.sql).toContain('line_account_id = ?');
    expect(query?.args[0]).toBe('A1');
    // 他アカウントの休業行が混ざらない前提では枠が出る
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('例外日の変更直後に空きへ反映される', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      exceptions: [],
    };
    const db = stubDB(data);
    const params = {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    };
    const before = await getAvailability(db, params);
    expect(before.by_staff[0].slots).not.toEqual([]);
    data.exceptions = [closedException()];
    const after = await getAvailability(db, params);
    expect(after.by_staff[0].slots).toEqual([]);
    data.exceptions = [];
    const reopened = await getAvailability(db, params);
    expect(reopened.by_staff[0].slots).not.toEqual([]);
  });

  test('使う資源の休業日は枠を塞ぎ、使わない資源の休業は塞がない', async () => {
    const base: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      menuResources: [{ id: 'R1', capacity: 2, quantity: 1 }],
    };
    const params = {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    };
    const usedClosed = await getAvailability(
      stubDB({ ...base, exceptions: [closedException({ scope_kind: 'resource', scope_id: 'R1' })] }),
      params,
    );
    expect(usedClosed.by_staff[0].slots).toEqual([]);
    const unusedClosed = await getAvailability(
      stubDB({ ...base, exceptions: [closedException({ scope_kind: 'resource', scope_id: 'R9' })] }),
      params,
    );
    expect(unusedClosed.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('未知の種類の行は無視する', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      exceptions: [{
        scope_kind: 'store',
        scope_id: null,
        date_from: '2026-05-09',
        date_to: '2026-05-09',
        kind: 'future_kind',
        hours_json: JSON.stringify([{ start: '00:00', end: '23:59' }]),
      }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('壊れた例外日の時間はその日を fail-closed にする', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      exceptions: [{
        scope_kind: 'store',
        scope_id: null,
        date_from: '2026-05-09',
        date_to: '2026-05-09',
        kind: 'custom_hours',
        hours_json: 'not-json',
      }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots).toEqual([]);
  });
});

describe('getAvailability の例外日・差し戻し対応（3範囲×3種）', () => {
  const PARAMS = {
    lineAccountId: 'A1',
    menuId: 'M1',
    from: '2026-05-09',
    to: '2026-05-09',
    now: new Date('2026-05-08T00:00:00Z'),
    minLeadTimeMinutes: 0,
  };

  function timeException(over: Partial<StubException> & { kind: string }): StubException {
    return {
      scope_kind: 'store',
      scope_id: null,
      date_from: '2026-05-09',
      date_to: '2026-05-09',
      hours_json: JSON.stringify([{ start: '10:00', end: '12:00' }]),
      ...over,
    };
  }

  test('店舗 open はシフトの無い通常休業日へ枠を出す', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [],
      exceptions: [timeException({ kind: 'open' })],
    });
    const result = await getAvailability(db, PARAMS);
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('店舗 open は担当 closed・資源 closed を越えない', async () => {
    const staffClosedDb = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [],
      exceptions: [
        timeException({ kind: 'open' }),
        closedException({ scope_kind: 'staff', scope_id: 'S1' }),
      ],
    });
    expect((await getAvailability(staffClosedDb, PARAMS)).by_staff[0].slots).toEqual([]);

    const resourceClosedDb = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [],
      menuResources: [{ id: 'R1', capacity: 2, quantity: 1 }],
      exceptions: [
        timeException({ kind: 'open' }),
        closedException({ scope_kind: 'resource', scope_id: 'R1' }),
      ],
    });
    expect((await getAvailability(resourceClosedDb, PARAMS)).by_staff[0].slots).toEqual([]);
  });

  test('店舗 open は同日の店舗 closed を切り抜く（臨時営業）', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [],
      exceptions: [closedException(), timeException({ kind: 'open' })],
    });
    const result = await getAvailability(db, PARAMS);
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('担当 open は担当 closed を越えない', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      exceptions: [
        timeException({ kind: 'open', scope_kind: 'staff', scope_id: 'S1' }),
        closedException({ scope_kind: 'staff', scope_id: 'S1' }),
      ],
    });
    expect((await getAvailability(db, PARAMS)).by_staff[0].slots).toEqual([]);
  });

  test('資源の短縮 10-12 は使うメニューの 9-10/12-17 枠を出さない', async () => {
    const base: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '09:00', end_time: '17:00' }],
      menuResources: [{ id: 'R1', capacity: 2, quantity: 1 }],
    };
    for (const kind of ['custom_hours', 'open']) {
      const db = stubDB({
        ...base,
        exceptions: [timeException({ kind, scope_kind: 'resource', scope_id: 'R1' })],
      });
      expect((await getAvailability(db, PARAMS)).by_staff[0].slots.map((s) => s.start)).toEqual(
        ['10:00', '10:30', '11:00'],
      );
    }
  });

  test('資源 open は資源 closed を越えない', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '09:00', end_time: '17:00' }],
      menuResources: [{ id: 'R1', capacity: 2, quantity: 1 }],
      exceptions: [
        timeException({ kind: 'open', scope_kind: 'resource', scope_id: 'R1' }),
        closedException({ scope_kind: 'resource', scope_id: 'R1' }),
      ],
    });
    expect((await getAvailability(db, PARAMS)).by_staff[0].slots).toEqual([]);
  });

  test('空の custom_hours は枠 0（置き換え先が無い）', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      exceptions: [timeException({
        kind: 'custom_hours',
        scope_kind: 'staff',
        scope_id: 'S1',
        hours_json: '[]',
      })],
    });
    expect((await getAvailability(db, PARAMS)).by_staff[0].slots).toEqual([]);
  });

  test('空の open は枠 0（足す時間が無いのに開けない）', async () => {
    const staffEmpty = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      exceptions: [timeException({
        kind: 'open',
        scope_kind: 'staff',
        scope_id: 'S1',
        hours_json: '[]',
      })],
    });
    expect((await getAvailability(staffEmpty, PARAMS)).by_staff[0].slots).toEqual([]);

    const storeEmpty = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      exceptions: [timeException({ kind: 'open', hours_json: '[]' })],
    });
    expect((await getAvailability(storeEmpty, PARAMS)).by_staff[0].slots).toEqual([]);
  });

  test('空の店舗 custom は全員の枠 0', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: [
        ...STAFF_S1,
        { id: 'S2', display_name: '佐藤', is_designation_optional: 0 },
      ],
      shifts: [
        { staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' },
        { staff_id: 'S2', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' },
      ],
      exceptions: [timeException({ kind: 'custom_hours', hours_json: '[]' })],
    });
    const result = await getAvailability(db, PARAMS);
    expect(result.by_staff.map((s) => s.slots)).toEqual([[], []]);
  });

  test('壊れた時間は適用範囲だけ塞ぐ（別担当・使わない資源は無事）', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: [
        ...STAFF_S1,
        { id: 'S2', display_name: '佐藤', is_designation_optional: 0 },
      ],
      shifts: [
        { staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' },
        { staff_id: 'S2', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' },
      ],
      menuResources: [{ id: 'R1', capacity: 2, quantity: 1 }],
      exceptions: [
        timeException({
          kind: 'custom_hours',
          scope_kind: 'staff',
          scope_id: 'S1',
          hours_json: 'broken',
        }),
        timeException({
          kind: 'custom_hours',
          scope_kind: 'resource',
          scope_id: 'R9',
          hours_json: 'broken',
        }),
      ],
    });
    const result = await getAvailability(db, PARAMS);
    expect(result.by_staff.find((s) => s.staff_id === 'S1')?.slots).toEqual([]);
    expect(
      result.by_staff.find((s) => s.staff_id === 'S2')?.slots.map((s) => s.start),
    ).toEqual(['10:00', '10:30', '11:00']);
  });

  test('壊れた資源の時間は使うメニューだけ塞ぐ', async () => {
    const base: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      menuResources: [{ id: 'R1', capacity: 2, quantity: 1 }],
    };
    const usedBroken = stubDB({
      ...base,
      exceptions: [timeException({
        kind: 'custom_hours',
        scope_kind: 'resource',
        scope_id: 'R1',
        hours_json: 'broken',
      })],
    });
    expect((await getAvailability(usedBroken, PARAMS)).by_staff[0].slots).toEqual([]);
  });

  test('日跨ぎの open 期間は各日へ枠を出す', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [],
      exceptions: [timeException({
        kind: 'open',
        date_from: '2026-05-09',
        date_to: '2026-05-10',
      })],
    });
    const result = await getAvailability(db, {
      ...PARAMS,
      to: '2026-05-11',
    });
    const byDate = new Map<string, number>();
    for (const slot of result.by_staff[0].slots) {
      byDate.set(slot.date, (byDate.get(slot.date) ?? 0) + 1);
    }
    expect(byDate.get('2026-05-09')).toBe(3);
    expect(byDate.get('2026-05-10')).toBe(3);
    expect(byDate.get('2026-05-11')).toBeUndefined();
  });

  test('closed＋部分 open は open 区間だけ再開する（通常勤務は足さない）', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '09:00', end_time: '17:00' }],
      exceptions: [closedException(), timeException({ kind: 'open' })],
    });
    const result = await getAvailability(db, PARAMS);
    // open 10-12 だけ。09-17 の通常勤務は出ない。
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('複数資源の時間は資源ごとに union・資源間で intersection', async () => {
    const base: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '09:00', end_time: '17:00' }],
      menuResources: [
        { id: 'R1', capacity: 2, quantity: 1 },
        { id: 'R2', capacity: 2, quantity: 1 },
      ],
    };
    // R1 10-12 × R2 14-16 → 共通部分なし → 枠 0
    const disjoint = stubDB({
      ...base,
      exceptions: [
        timeException({ kind: 'custom_hours', scope_kind: 'resource', scope_id: 'R1' }),
        timeException({
          kind: 'custom_hours',
          scope_kind: 'resource',
          scope_id: 'R2',
          hours_json: JSON.stringify([{ start: '14:00', end: '16:00' }]),
        }),
      ],
    });
    expect((await getAvailability(disjoint, PARAMS)).by_staff[0].slots).toEqual([]);
    // R1 10-12 × R2 09-17 → 共通部分 10-12
    const overlap = stubDB({
      ...base,
      exceptions: [
        timeException({ kind: 'custom_hours', scope_kind: 'resource', scope_id: 'R1' }),
        timeException({
          kind: 'custom_hours',
          scope_kind: 'resource',
          scope_id: 'R2',
          hours_json: JSON.stringify([{ start: '09:00', end: '17:00' }]),
        }),
      ],
    });
    expect((await getAvailability(overlap, PARAMS)).by_staff[0].slots.map((s) => s.start)).toEqual(
      ['10:00', '10:30', '11:00'],
    );
  });

  test('空 custom_hours の資源が1つでもあれば fail-closed', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '09:00', end_time: '17:00' }],
      menuResources: [
        { id: 'R1', capacity: 2, quantity: 1 },
        { id: 'R2', capacity: 2, quantity: 1 },
      ],
      exceptions: [
        timeException({
          kind: 'custom_hours',
          scope_kind: 'resource',
          scope_id: 'R1',
          hours_json: '[]',
        }),
        timeException({ kind: 'custom_hours', scope_kind: 'resource', scope_id: 'R2' }),
      ],
    });
    expect((await getAvailability(db, PARAMS)).by_staff[0].slots).toEqual([]);
  });
});

describe('getAvailability のタイムゾーン（非JST）', () => {
  test('既存予約は店舗TZの日付へ帰属する（日またぎ境界）', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      // New York (EDT, UTC-4)。13:30Z-14:30Z = 現地 09:30-10:30。
      timezone: 'America/New_York',
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '18:00' }],
      bookings: [
        // 現地 05-08 の予約。JST なら 05-09 12:30-13:30 になり 12:00 枠を塞ぐ。
        { staff_id: 'S1', starts_at: '2026-05-09T03:30:00Z', block_ends_at: '2026-05-09T04:30:00Z' },
        // 現地 05-09 09:30-10:30。10:00 枠を塞ぐ。
        { staff_id: 'S1', starts_at: '2026-05-09T13:30:00Z', block_ends_at: '2026-05-09T14:30:00Z' },
      ],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    const starts = result.by_staff[0].slots.map((s) => s.start);
    expect(starts[0]).toBe('10:30');
    expect(starts).toContain('12:00');
    expect(starts).toContain('12:30');
    expect(starts).not.toContain('10:00');
  });

  test('例外日と締切は店舗TZで判定する（Honolulu）', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      // Honolulu (UTC-10, 夏時間なし)。01:30Z-02:30Z = 現地 05-08 15:30-16:30。
      timezone: 'Pacific/Honolulu',
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      // JST なら 05-09 10:30-11:30 になり 05-09 を全滅させる。
      bookings: [{ staff_id: 'S1', starts_at: '2026-05-09T01:30:00Z', block_ends_at: '2026-05-09T02:30:00Z' }],
      exceptions: [closedException({ date_from: '2026-05-10', date_to: '2026-05-10' })],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-10',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    const byDate = new Map<string, string[]>();
    for (const slot of result.by_staff[0].slots) {
      byDate.set(slot.date, [...(byDate.get(slot.date) ?? []), slot.start]);
    }
    expect(byDate.get('2026-05-09')).toEqual(['10:00', '10:30', '11:00']);
    expect(byDate.get('2026-05-10')).toBeUndefined();
  });

  test('締切境界は店舗TZの瞬間で切る（Honolulu）', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      timezone: 'Pacific/Honolulu',
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    // 現在 19:30Z = 現地 09:30。リード 60 分 → 現地 10:30 以降だけ残る。
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-09T19:30:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:30', '11:00']);
  });

  test('Google 予定は店舗TZの日へ落とす（New York）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      calendars: { 'cal@example.com': { busy: [{ start: '2026-05-09T14:00:00Z', end: '2026-05-09T15:00:00Z' }] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    try {
      const db = stubDB({
        menu: MENU_BASIC,
        staff: STAFF_S1,
        // 14:00Z-15:00Z = 現地 10:00-11:00。JST なら 23:00-24:00 で枠に当たらない。
        timezone: 'America/New_York',
        shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
        bookings: [],
        calendarConnection: { id: 'GC1', calendar_id: 'cal@example.com', auth_type: 'oauth', access_token: 'token' },
      });
      const result = await getAvailability(db, {
        lineAccountId: 'A1',
        menuId: 'M1',
        from: '2026-05-09',
        to: '2026-05-09',
        now: new Date('2026-05-08T00:00:00Z'),
        minLeadTimeMinutes: 0,
      });
      expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['11:00']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('壊れた timezone は Asia/Tokyo に寄せる', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      timezone: 'Not/AZone',
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '13:00' }],
      // JST 11:00-12:00。10:00 枠だけ残るはず（JST 換算どおり）。
      bookings: [{ staff_id: 'S1', starts_at: '2026-05-09T02:00:00Z', block_ends_at: '2026-05-09T03:00:00Z' }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '12:00']);
  });
});

describe('getAvailability の夏時間切替日（New York）', () => {
  const MENU_60_HOURLY = { ...MENU_BASIC };

  function googleDb(busy: Array<{ start: string; end: string }>, extra: Partial<StubData> = {}) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      calendars: { 'cal@example.com': { busy } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    return stubDB({
      menu: MENU_60_HOURLY,
      staff: STAFF_S1,
      timezone: 'America/New_York',
      bookings: [],
      calendarConnection: { id: 'GC1', calendar_id: 'cal@example.com', auth_type: 'oauth', access_token: 'token' },
      ...extra,
    });
  }

  // 2026-03-08 は DST 開始（02:00 → 03:00、EST → EDT）。07:00Z は壁時刻 03:00。
  test('DST 開始日：07:00Z の予定は 03:00 枠を塞ぐ（02:00 扱いにしない）', async () => {
    const db = googleDb(
      [{ start: '2026-03-08T07:00:00Z', end: '2026-03-08T07:30:00Z' }],
      { shifts: [{ staff_id: 'S1', work_date: '2026-03-08', start_time: '03:00', end_time: '05:00' }] },
    );
    try {
      const result = await getAvailability(db, {
        lineAccountId: 'A1',
        menuId: 'M1',
        from: '2026-03-08',
        to: '2026-03-08',
        now: new Date('2026-03-07T00:00:00Z'),
        minLeadTimeMinutes: 0,
      });
      expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['03:30', '04:00']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('DST 開始日：切替をまたぐ予定は壁時刻の範囲で塞ぐ', async () => {
    const db = googleDb(
      // 壁 01:30(EST)〜03:30(EDT)。実経過では 90〜150 分で「01:30-02:30」になる。
      [{ start: '2026-03-08T06:30:00Z', end: '2026-03-08T07:30:00Z' }],
      { shifts: [{ staff_id: 'S1', work_date: '2026-03-08', start_time: '00:00', end_time: '05:00' }] },
    );
    try {
      const result = await getAvailability(db, {
        lineAccountId: 'A1',
        menuId: 'M1',
        from: '2026-03-08',
        to: '2026-03-08',
        now: new Date('2026-03-07T00:00:00Z'),
        minLeadTimeMinutes: 0,
      });
      expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['00:00', '00:30', '03:30', '04:00']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // 2026-11-01 は DST 終了（02:00 → 01:00、EDT → EST、25 時間の日）。
  test('DST 終了日：07:30Z の予定は 02:30 枠として塞ぐ', async () => {
    const db = googleDb(
      // 壁 02:30-03:30(EST)。実経過では 210〜270 分で「03:30-04:30」になる。
      [{ start: '2026-11-01T07:30:00Z', end: '2026-11-01T08:30:00Z' }],
      { shifts: [{ staff_id: 'S1', work_date: '2026-11-01', start_time: '01:00', end_time: '05:00' }] },
    );
    try {
      const result = await getAvailability(db, {
        lineAccountId: 'A1',
        menuId: 'M1',
        from: '2026-11-01',
        to: '2026-11-01',
        now: new Date('2026-10-31T00:00:00Z'),
        minLeadTimeMinutes: 0,
      });
      expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['01:00', '01:30', '03:30', '04:00']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('候補は店舗timezone＋offset付きinstantを持つ', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      timezone: 'America/New_York',
      shifts: [{ staff_id: 'S1', work_date: '2026-10-10', start_time: '10:00', end_time: '11:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-10-10',
      to: '2026-10-10',
      now: new Date('2026-10-09T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots[0]).toMatchObject({
      date: '2026-10-10',
      start: '10:00',
      timeZone: 'America/New_York',
      startUtc: '2026-10-10T10:00:00-04:00',
      endUtc: '2026-10-10T11:00:00-04:00',
    });
  });

  test('fold を跨ぐ Google 予定は instant で塞ぐ（壁 01:30→01:30 でも消えない）', async () => {
    // 05:30Z-06:30Z = 壁 01:30(EDT)→01:30(EST)。壁だけ見ると長さ 0 で消える。
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      calendars: { 'cal@example.com': { busy: [{ start: '2026-11-01T05:30:00Z', end: '2026-11-01T06:30:00Z' }] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    try {
      const db = stubDB({
        menu: MENU_BASIC,
        staff: STAFF_S1,
        timezone: 'America/New_York',
        shifts: [{ staff_id: 'S1', work_date: '2026-11-01', start_time: '01:00', end_time: '03:00' }],
        bookings: [],
        calendarConnection: { id: 'GC1', calendar_id: 'cal@example.com', auth_type: 'oauth', access_token: 'token' },
      });
      const result = await getAvailability(db, {
        lineAccountId: 'A1',
        menuId: 'M1',
        from: '2026-11-01',
        to: '2026-11-01',
        now: new Date('2026-10-31T00:00:00Z'),
        minLeadTimeMinutes: 0,
      });
      expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['02:00']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('fold を跨ぐ保存済み予約は instant で塞ぐ', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      timezone: 'America/New_York',
      shifts: [{ staff_id: 'S1', work_date: '2026-11-01', start_time: '01:00', end_time: '03:00' }],
      bookings: [{ staff_id: 'S1', starts_at: '2026-11-01T05:30:00Z', block_ends_at: '2026-11-01T06:30:00Z' }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-11-01',
      to: '2026-11-01',
      now: new Date('2026-10-31T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['02:00']);
  });

  test('busy なし DST 開始日は gap（02:00 台）を候補にしない', async () => {
    const db = stubDB({
      menu: MENU_BASIC,
      staff: STAFF_S1,
      timezone: 'America/New_York',
      shifts: [{ staff_id: 'S1', work_date: '2026-03-08', start_time: '00:00', end_time: '05:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-03-08',
      to: '2026-03-08',
      now: new Date('2026-03-07T00:00:00Z'),
      minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual([
      '00:00', '00:30', '01:00', '01:30', '03:00', '03:30', '04:00',
    ]);
  });

  test('受付 window は暦日で足す（DST 開始でずらさない）', async () => {
    const db = stubDB({
      menu: { ...MENU_BASIC, booking_window_days: 1 },
      staff: STAFF_S1,
      timezone: 'America/New_York',
      shifts: [
        { staff_id: 'S1', work_date: '2026-03-08', start_time: '10:00', end_time: '12:00' },
        { staff_id: 'S1', work_date: '2026-03-09', start_time: '10:00', end_time: '12:00' },
      ],
      bookings: [],
    });
    // 現在は現地 03-07 23:30。24 時間加算なら最終日は 03-09 になるが、暦日 +1 日は 03-08。
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-03-08',
      to: '2026-03-09',
      now: new Date('2026-03-08T04:30:00Z'),
      minLeadTimeMinutes: 0,
    });
    const dates = new Set(result.by_staff[0].slots.map((s) => s.date));
    expect(dates).toEqual(new Set(['2026-03-08']));
  });
});
