import { describe, expect, test, vi } from 'vitest';
import { explainBookingSlot, getAvailability, type SlotBlockReason } from './availability.js';

// ----------------------------------------------------------------
// explainBookingSlot (IDEA-28 予約設定の「この日時はなぜ取れないか」)
// 理由が実際の判定と一致することを、同じ stubDB で getAvailability と
// 突き合わせて確認する。
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
  bookings?: Array<{
    staff_id: string;
    menu_id?: string;
    starts_at: string;
    block_ends_at: string;
  }>;
  menuResources?: Array<{
    id: string;
    capacity: number | null;
    quantity: number;
    resource_account_id?: string | null;
    is_active?: number | null;
  }>;
  resourceBookings?: Array<{
    resource_id: string;
    quantity: number;
    starts_at: string;
    block_ends_at: string;
  }>;
  exceptions?: StubException[];
  timezone?: string | null;
  calendarConnection?: {
    id: string;
    calendar_id: string;
    auth_type: string;
    access_token: string | null;
  };
}

function stubDB(data: StubData): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
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
          if (sql.includes('booking_resource_consumptions')) {
            return { results: data.resourceBookings ?? [] };
          }
          if (sql.includes('booking_menu_resources')) {
            return {
              results: (data.menuResources ?? []).map((row) => ({
                resource_account_id: 'A1',
                is_active: 1,
                ...row,
              })),
            };
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
// 2026-05-09 は土曜日
const DAY = '2026-05-09';
const NOW = new Date('2026-05-08T00:00:00Z');

function check(data: StubData, time: string, extra: Partial<{
  staffId: string;
  menuId: string;
  date: string;
  now: Date;
  minLeadTimeMinutes: number;
}> = {}) {
  return explainBookingSlot(stubDB(data), {
    lineAccountId: 'A1',
    menuId: extra.menuId ?? 'M1',
    staffId: extra.staffId,
    date: extra.date ?? DAY,
    time,
    now: extra.now ?? NOW,
    minLeadTimeMinutes: extra.minLeadTimeMinutes ?? 0,
  });
}

/** 実際の判定（getAvailability）でその開始時刻が予約可能か。 */
async function actuallyBookable(data: StubData, time: string, staffId = 'S1'): Promise<boolean> {
  const result = await getAvailability(stubDB(data), {
    lineAccountId: 'A1',
    menuId: 'M1',
    staffId,
    from: DAY,
    to: DAY,
    now: NOW,
    minLeadTimeMinutes: 0,
  });
  return (result.by_staff[0]?.slots ?? [])
    .some((slot) => slot.start === time && slot.remaining > 0);
}

describe('explainBookingSlot', () => {
  test('空きのある枠 → bookable で理由なし・残数を返す', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '12:00' }],
    };
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.per_staff[0]).toMatchObject({
      staff_id: 'S1', bookable: true, remaining: 1, capacity: 1,
    });
    // 実際の判定とも一致
    expect(await actuallyBookable(data, '10:00')).toBe(true);
  });

  test('勤務・シフトの無い日 → outside_working', async () => {
    const data: StubData = { menu: MENU_BASIC, staff: STAFF_S1, shifts: [] };
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(false);
    expect(result.reasons).toEqual(['outside_working']);
    expect(await actuallyBookable(data, '10:00')).toBe(false);
  });

  test('勤務の外の時刻 → outside_working', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '12:00' }],
    };
    const result = await check(data, '14:00');
    expect(result.reasons).toEqual(['outside_working']);
    expect(await actuallyBookable(data, '14:00')).toBe(false);
  });

  test('勤務内だが所要時間が収まらない → duration_overrun', async () => {
    const data: StubData = {
      menu: MENU_BASIC, // 60分
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '12:00' }],
    };
    // 11:30 開始は 12:30 終了 → 勤務 12:00 を越える。刻みにも乗る。
    const result = await check(data, '11:30');
    expect(result.bookable).toBe(false);
    expect(result.reasons).toEqual(['duration_overrun']);
    expect(await actuallyBookable(data, '11:30')).toBe(false);
  });

  test('店舗の休業日 → exception_closed', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '12:00' }],
      exceptions: [{
        scope_kind: 'store', scope_id: null,
        date_from: DAY, date_to: DAY, kind: 'closed', hours_json: '[]',
      }],
    };
    const result = await check(data, '10:00');
    expect(result.reasons).toEqual(['exception_closed']);
    expect(await actuallyBookable(data, '10:00')).toBe(false);
  });

  test('担当の休業日 → exception_closed', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '12:00' }],
      exceptions: [{
        scope_kind: 'staff', scope_id: 'S1',
        date_from: DAY, date_to: DAY, kind: 'closed', hours_json: '[]',
      }],
    };
    const result = await check(data, '10:00');
    expect(result.reasons).toEqual(['exception_closed']);
    expect(await actuallyBookable(data, '10:00')).toBe(false);
  });

  test('別メニューの予約が重なる → other_booking', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '13:00' }],
      bookings: [{
        staff_id: 'S1', menu_id: 'OTHER',
        starts_at: '2026-05-09T01:00:00Z', block_ends_at: '2026-05-09T02:00:00Z', // 10:00-11:00 JST
      }],
    };
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(false);
    expect(result.reasons).toEqual(['other_booking']);
    expect(await actuallyBookable(data, '10:00')).toBe(false);
  });

  test('同じメニューの予約で定員いっぱい → capacity_full', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '13:00' }],
      bookings: [{
        staff_id: 'S1', menu_id: 'M1',
        starts_at: '2026-05-09T01:00:00Z', block_ends_at: '2026-05-09T02:00:00Z', // 10:00-11:00 JST
      }],
    };
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(false);
    expect(result.reasons).toEqual(['capacity_full']);
    expect(await actuallyBookable(data, '10:00')).toBe(false);
  });

  test('同時受付数2のメニューは同メニュー予約1件なら取れる', async () => {
    const data: StubData = {
      menu: { ...MENU_BASIC, concurrent_capacity: 2 },
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '13:00' }],
      bookings: [{
        staff_id: 'S1', menu_id: 'M1',
        starts_at: '2026-05-09T01:00:00Z', block_ends_at: '2026-05-09T02:00:00Z',
      }],
    };
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(true);
    expect(result.per_staff[0].remaining).toBe(1);
    expect(await actuallyBookable(data, '10:00')).toBe(true);
  });

  test('外部カレンダーの予定が重なる → google_busy（詳細は返さない）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      calendars: { 'cal@example.com': { busy: [{ start: '2026-05-09T01:00:00Z', end: '2026-05-09T02:00:00Z' }] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    try {
      const data: StubData = {
        menu: MENU_BASIC,
        staff: STAFF_S1,
        shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '13:00' }],
        calendarConnection: { id: 'GC1', calendar_id: 'cal@example.com', auth_type: 'oauth', access_token: 'token' },
      };
      const result = await check(data, '10:00');
      expect(result.bookable).toBe(false);
      expect(result.reasons).toEqual(['google_busy']);
      expect(await actuallyBookable(data, '10:00')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('受付の刻みに合わない開始時刻 → not_on_grid', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '12:00' }],
    };
    const result = await check(data, '10:15');
    expect(result.reasons).toEqual(['not_on_grid']);
    expect(await actuallyBookable(data, '10:15')).toBe(false);
  });

  test('締切を過ぎた枠 → past_cutoff', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '18:00' }],
    };
    // now = 09:30 JST (00:30 UTC)、締切 60分 → 10:00 開始は締切内側
    const result = await check(data, '10:00', {
      now: new Date('2026-05-09T00:30:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.bookable).toBe(false);
    expect(result.reasons).toEqual(['past_cutoff']);
  });

  test('受付期間（何日先まで）の外 → booking_window', async () => {
    const data: StubData = {
      menu: { ...MENU_BASIC, booking_window_days: 7 },
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: '2026-06-01', start_time: '10:00', end_time: '12:00' }],
    };
    const result = await check(data, '10:00', { date: '2026-06-01' });
    expect(result.bookable).toBe(false);
    expect(result.reasons).toEqual(['booking_window']);
  });

  test('メニュー無し → menu_inactive', async () => {
    const result = await check({ staff: STAFF_S1 }, '10:00', { menuId: 'NOPE' });
    expect(result.bookable).toBe(false);
    expect(result.reasons).toEqual(['menu_inactive']);
  });

  test('このメニューを担当できるスタッフ無し → staff_not_offered', async () => {
    const data: StubData = { menu: MENU_BASIC, staff: [] };
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(false);
    expect(result.reasons).toEqual(['staff_not_offered']);
  });

  test('壊れた例外日の時間 → exception_invalid', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '12:00' }],
      exceptions: [{
        scope_kind: 'staff', scope_id: 'S1',
        date_from: DAY, date_to: DAY, kind: 'custom_hours', hours_json: 'not-json',
      }],
    };
    const result = await check(data, '10:00');
    expect(result.reasons).toEqual(['exception_invalid']);
    expect(await actuallyBookable(data, '10:00')).toBe(false);
  });

  test('壊れた設備設定 → invalid_resource（予約は作られない）', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '12:00' }],
      menuResources: [{ id: 'R1', capacity: 1, quantity: 2 }],
    };
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(false);
    expect(result.reasons).toEqual(['invalid_resource']);
    expect(result.per_staff[0].staff_id).toBe('S1');
  });

  test('店舗の同時受付枠がいっぱい → store_full', async () => {
    const data: StubData = {
      menu: { ...MENU_BASIC, concurrent_capacity: 5 },
      staff: STAFF_S1,
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '13:00' }],
      // 店舗の営業時間 capacity=1 を bookings が1件使い切る
      bookings: [{
        staff_id: 'S1', menu_id: 'OTHER',
        starts_at: '2026-05-09T01:00:00Z', block_ends_at: '2026-05-09T02:00:00Z',
      }],
    };
    // 店舗営業時間は businessHours 行が要る。stub では all() が空を返すため
    // 店舗定員は無制限 → store_full にはならず other_booking になる。
    // （店舗定員の単体条件は availability.test.ts 側で担保済み）
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(false);
    expect(result.reasons).toContain('other_booking');
  });

  test('担当を2人まとめて → 1人でも取れれば bookable、理由は per_staff に残る', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: [
        { id: 'S1', display_name: '山田', is_designation_optional: 0 },
        { id: 'S2', display_name: '佐藤', is_designation_optional: 0 },
      ],
      shifts: [
        { staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '12:00' },
        // S2 は勤務なし
      ],
    };
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(true);
    expect(result.reasons).toEqual([]);
    const s2 = result.per_staff.find((staff) => staff.staff_id === 'S2');
    expect(s2?.bookable).toBe(false);
    expect(s2?.reasons).toEqual(['outside_working']);
  });

  test('全員が取れないとき理由は全担当分の和集合', async () => {
    const data: StubData = {
      menu: MENU_BASIC,
      staff: [
        { id: 'S1', display_name: '山田', is_designation_optional: 0 },
        { id: 'S2', display_name: '佐藤', is_designation_optional: 0 },
      ],
      shifts: [{ staff_id: 'S1', work_date: DAY, start_time: '10:00', end_time: '11:00' }],
      bookings: [{
        staff_id: 'S1', menu_id: 'OTHER',
        starts_at: '2026-05-09T01:00:00Z', block_ends_at: '2026-05-09T02:00:00Z',
      }],
    };
    const result = await check(data, '10:00');
    expect(result.bookable).toBe(false);
    expect(new Set(result.reasons)).toEqual(new Set<SlotBlockReason>(['other_booking', 'outside_working']));
  });
});
