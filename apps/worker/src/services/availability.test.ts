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
  };
  staff?: Array<{ id: string; display_name: string; is_designation_optional: number }>;
  shifts?: Array<{ staff_id: string; work_date: string; start_time: string; end_time: string }>;
  rules?: Array<{ staff_id: string; weekday: number; start_time: string; end_time: string }>;
  bookings?: Array<{ staff_id: string; starts_at: string; block_ends_at: string }>;
  menuResources?: Array<{ id: string; capacity: number; quantity: number }>;
  exceptions?: StubException[];
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
