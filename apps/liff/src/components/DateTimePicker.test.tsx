// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import DateTimePicker from './DateTimePicker.js';
import { dayStateLabel } from './DateTimePicker.js';

/**
 * 1-2 リスト／カレンダー切替の描画試験。
 * 今日は 2026-10-15（木）に固定し、設定・空き枠は偽物で返す。
 */

let todayOverride = '2026-10-15';

vi.mock('../lib/datetime.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/datetime.js')>();
  return { ...actual, jstToday: () => todayOverride };
});

vi.mock('../lib/user-message.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/user-message.js')>();
  return { ...actual, logFailure: vi.fn() };
});

const { api } = await import('../lib/api.js');
vi.mock('../lib/api.js', () => ({
  api: {
    availability: vi.fn(),
    bookingSettings: vi.fn(),
  },
}));

type Slot = {
  date: string;
  start: string;
  end: string;
  remaining?: number;
  state?: 'available' | 'limited' | 'full' | 'closed';
};
const MASTER_SLOTS: Slot[] = [
  { date: '2026-10-16', start: '10:00', end: '11:00' },
  { date: '2026-10-16', start: '11:00', end: '12:00' },
  // 10-18 は枠があって全部埋まった日（残り0）。カレンダーの「満」になる。
  { date: '2026-10-18', start: '10:00', end: '11:00', remaining: 0, state: 'full' },
  { date: '2026-10-18', start: '11:00', end: '12:00', remaining: 0, state: 'full' },
  { date: '2026-10-20', start: '09:00', end: '10:00' },
  { date: '2026-10-30', start: '10:00', end: '11:00' },
  { date: '2026-11-02', start: '10:00', end: '11:00' },
];
const MASTER_CLOSED = ['2026-10-21'];

const availability = vi.mocked(api.availability);
const bookingSettings = vi.mocked(api.bookingSettings);

function mockAvailability() {
  availability.mockImplementation(async (_menuId: string, _staffId: string | undefined, from: string, to: string) => ({
    by_staff: [
      {
        staff_id: 's1',
        display_name: '担当A',
        slots: MASTER_SLOTS.filter((s) => s.date >= from && s.date <= to),
      },
    ],
    closed_dates: MASTER_CLOSED.filter((d) => d >= from && d <= to),
  }));
}

function mockSettings(view: 'list' | 'calendar' = 'list', windowDays = 60) {
  bookingSettings.mockResolvedValue({
    liff_date_view: view,
    booking_window_days: windowDays,
  });
}

function renderPicker() {
  const onSelect = vi.fn();
  const onLoadState = vi.fn();
  render(
    <DateTimePicker
      menuId="m1"
      staffId="s1"
      selected={null}
      onSelect={onSelect}
      onLoadState={onLoadState}
    />,
  );
  return { onSelect, onLoadState };
}

async function openCalendar() {
  renderPicker();
  const group = await screen.findByRole('radiogroup', { name: '表示の切り替え' });
  fireEvent.click(within(group).getByRole('radio', { name: 'カレンダー' }));
  return group;
}

const memoryValues = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => memoryValues.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryValues.set(key, String(value));
    },
    removeItem: (key: string) => {
      memoryValues.delete(key);
    },
    clear: () => memoryValues.clear(),
  },
  configurable: true,
  writable: true,
});

beforeEach(() => {
  // 「今日」は 2026-10-15（木）に固定する。部品が読む jstToday を
  // 偽装しているので、実機の日付が何日でも選ばれる日は変わらない。
  todayOverride = '2026-10-15';
  // 時計そのものも固定する（jstToday 偽装との二重固定。Date だけを
  // 偽物にし、タイマーは本物のままなので待ち受けは壊れない）。
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T00:00:00+09:00'));
  memoryValues.clear();
  vi.clearAllMocks();
  mockAvailability();
  mockSettings('list', 60);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('切り替え', () => {
  it('手順の下にリスト｜カレンダーが並び、今どちらかが読み上げで分かる', async () => {
    renderPicker();
    const group = await screen.findByRole('radiogroup', { name: '表示の切り替え' });
    const list = within(group).getByRole('radio', { name: 'リスト' });
    const calendar = within(group).getByRole('radio', { name: 'カレンダー' });
    expect(list.getAttribute('aria-checked')).toBe('true');
    expect(calendar.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(calendar);
    expect(calendar.getAttribute('aria-checked')).toBe('true');
    expect(list.getAttribute('aria-checked')).toBe('false');
  });

  it('最初の形は管理画面の設定に従う', async () => {
    mockSettings('calendar', 60);
    renderPicker();
    const group = await screen.findByRole('radiogroup', { name: '表示の切り替え' });
    expect(
      within(group).getByRole('radio', { name: 'カレンダー' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(await screen.findByText('2026年10月')).toBeTruthy();
  });

  it('端末で切り替えた形を次回も使う（設定より優先）', async () => {
    window.localStorage.setItem('liff-booking-date-view', 'list');
    mockSettings('calendar', 60);
    renderPicker();
    const group = await screen.findByRole('radiogroup', { name: '表示の切り替え' });
    expect(
      within(group).getByRole('radio', { name: 'リスト' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('切り替えたら端末に覚える', async () => {
    const group = await openCalendar();
    expect(window.localStorage.getItem('liff-booking-date-view')).toBe('calendar');
    fireEvent.click(within(group).getByRole('radio', { name: 'リスト' }));
    expect(window.localStorage.getItem('liff-booking-date-view')).toBe('list');
  });

  it('設定が読めなくてもリスト（既定）で開く', async () => {
    bookingSettings.mockRejectedValue(new Error('offline'));
    renderPicker();
    const group = await screen.findByRole('radiogroup', { name: '表示の切り替え' });
    expect(
      within(group).getByRole('radio', { name: 'リスト' }).getAttribute('aria-checked'),
    ).toBe('true');
    // リストの枠は読めているので時刻が出る。
    expect(await screen.findByRole('button', { name: '10:00' })).toBeTruthy();
  });

  it('localStorage が使えなくても落ちない（設定の値に戻る）', async () => {
    const storage = window.localStorage;
    const getSpy = vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setSpy = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    mockSettings('calendar', 60);
    renderPicker();
    const group = await screen.findByRole('radiogroup', { name: '表示の切り替え' });
    expect(
      within(group).getByRole('radio', { name: 'カレンダー' }).getAttribute('aria-checked'),
    ).toBe('true');
    // 書けなくても切り替え自体は動く。
    fireEvent.click(within(group).getByRole('radio', { name: 'リスト' }));
    expect(setSpy).toHaveBeenCalled();
    expect(
      within(group).getByRole('radio', { name: 'リスト' }).getAttribute('aria-checked'),
    ).toBe('true');
  });
});

describe('カレンダー', () => {
  it('各日に印があり、読み上げは日付と状態（色だけにしない）', async () => {
    await openCalendar();
    expect(
      await screen.findByRole('button', { name: '10月16日 空きあり' }),
    ).toBeTruthy();
    // 10-18 は枠があって全部埋まった日だけ「満席」。枠の無い 10-17 は「空きなし」。
    expect(screen.getByRole('button', { name: '10月18日 満席' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '10月17日 空きなし' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '10月21日 お休み' })).toBeTruthy();
    // 見た目の印（●／満／休）も文字で出る。
    expect(screen.getByText('2026年10月').parentElement?.parentElement?.textContent).toContain('満');
    expect(screen.getByText('2026年10月').parentElement?.parentElement?.textContent).toContain('休');
    // 印の見方。
    expect(screen.getByText(/空きあり/)).toBeTruthy();
    expect(screen.getByText(/満席/)).toBeTruthy();
    expect(screen.getByText(/お休み/)).toBeTruthy();
  });

  it('過去・期間の外・お休み・満席・空きなしの日は押せない', async () => {
    await openCalendar();
    await screen.findByRole('button', { name: '10月16日 空きあり' });
    expect(screen.getByRole('button', { name: '10月14日 過ぎた日' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '10月18日 満席' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '10月17日 空きなし' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '10月21日 お休み' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '10月16日 空きあり' }).hasAttribute('disabled')).toBe(false);
  });

  it('最初に開いた時は空きのある一番早い日を選んだ状態', async () => {
    await openCalendar();
    // 10-16 が一番早い空き日。リストと同じ「10/16(金)の空き」の段が出る。
    expect(await screen.findByText('10/16(金) の空き')).toBeTruthy();
    expect(screen.getByRole('button', { name: '10:00' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '11:00' })).toBeTruthy();
  });

  it('日を押すと下にその日の時刻が3列で出る（リストと同じ部品）', async () => {
    const { onSelect } = renderPicker();
    const group = await screen.findByRole('radiogroup', { name: '表示の切り替え' });
    fireEvent.click(within(group).getByRole('radio', { name: 'カレンダー' }));
    await screen.findByRole('button', { name: '10月16日 空きあり' });
    fireEvent.click(screen.getByRole('button', { name: '10月20日 空きあり' }));
    expect(await screen.findByText('10/20(火) の空き')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '09:00' }));
    expect(onSelect).toHaveBeenCalledWith({ date: '2026-10-20', start: '09:00' });
  });

  it('月は今月より前へ戻れず、期間の外へ進めない', async () => {
    mockSettings('calendar', 20);
    renderPicker();
    await screen.findByText('2026年10月');
    // 今月なので前へは戻れない。
    expect(screen.getByRole('button', { name: '前の月' }).hasAttribute('disabled')).toBe(true);
    // 受付は 11-04 まで。11月へは進めるが、12月へは進めない。
    fireEvent.click(screen.getByRole('button', { name: '次の月' }));
    expect(await screen.findByText('2026年11月')).toBeTruthy();
    expect(screen.getByRole('button', { name: '前の月' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '次の月' }).hasAttribute('disabled')).toBe(true);
    // 11-05 以降は期間の外で押せない。
    expect(screen.getByRole('button', { name: '11月5日 選択できません' }).hasAttribute('disabled')).toBe(true);
    // 戻れる。
    fireEvent.click(screen.getByRole('button', { name: '前の月' }));
    expect(await screen.findByText('2026年10月')).toBeTruthy();
  });

  it('月のぶんは28日ずつに割って読む（口の上限を超えない）', async () => {
    todayOverride = '2026-10-01';
    vi.setSystemTime(new Date('2026-10-01T00:00:00+09:00'));
    mockSettings('calendar', 60);
    renderPicker();
    await screen.findByRole('button', { name: '10月30日 空きあり' });
    const calls = availability.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [, , from, to] of calls) {
      const days =
        (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
          86400000 +
        1;
      expect(days).toBeLessThanOrEqual(28);
    }
    // 割ったぶんを合わせてある（後半の枠も印になる）。
    const covered = calls.map(([, , from, to]) => `${from}〜${to}`).join(' ');
    expect(covered).toContain('2026-10-01');
    expect(covered).toContain('2026-10-31');
  });

  it('空きが無い月はその旨だけ出す', async () => {
    availability.mockResolvedValue({ by_staff: [{ staff_id: 's1', display_name: '担当A', slots: [] }], closed_dates: [] });
    mockSettings('calendar', 60);
    renderPicker();
    await screen.findByText('2026年10月');
    expect(
      await screen.findByText('この月は空きがありません。'),
    ).toBeTruthy();
  });
});

describe('枠の二重読み', () => {
  it('月をまたいで割って読んでも、同じ日の同じ時刻は1つだけ出る', async () => {
    todayOverride = '2026-09-27';
    vi.setSystemTime(new Date('2026-09-27T00:00:00+09:00'));
    // 口が期間を広めに返し、二口ぶんに同じ枠が入ってきた場合。
    const octSlots: Slot[] = [
      { date: '2026-10-01', start: '10:00', end: '11:00' },
      { date: '2026-10-01', start: '11:00', end: '12:00' },
      { date: '2026-10-05', start: '10:00', end: '11:00' },
    ];
    availability.mockImplementation(async () => ({
      by_staff: [{ staff_id: 's1', display_name: '担当A', slots: octSlots }],
      closed_dates: [],
    }));
    mockSettings('calendar', 60);
    renderPicker();
    // 9月に空きが無いので10月を開く。10月は28日ずつ2口で読む。
    expect(await screen.findByText('2026年10月')).toBeTruthy();
    expect(await screen.findByText('10/1(木) の空き')).toBeTruthy();
    // 同じ枠が二重に来ても時刻の札は1つずつ。
    expect(screen.getAllByRole('button', { name: '10:00' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '11:00' })).toHaveLength(1);
    // 別の日も1つずつ。
    fireEvent.click(screen.getByRole('button', { name: '10月5日 空きあり' }));
    expect(await screen.findByText('10/5(月) の空き')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '10:00' })).toHaveLength(1);
  });

  it('リストでも同じ枠は1つだけ出る', async () => {
    availability.mockImplementation(async () => ({
      by_staff: [
        {
          staff_id: 's1',
          display_name: '担当A',
          slots: [
            { date: '2026-10-16', start: '10:00', end: '11:00' },
            { date: '2026-10-16', start: '10:00', end: '11:00' },
            { date: '2026-10-16', start: '11:00', end: '12:00' },
            { date: '2026-10-16', start: '11:00', end: '12:00' },
          ],
        },
      ],
      closed_dates: [],
    }));
    renderPicker();
    expect(await screen.findByText('10/16(金) の空き')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '10:00' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '11:00' })).toHaveLength(1);
  });
});

describe('カレンダーの最初の月と月送り', () => {
  it('今月に空きが無く来月にある時は、来月を開いて1日を選ぶ', async () => {
    todayOverride = '2026-09-27';
    vi.setSystemTime(new Date('2026-09-27T00:00:00+09:00'));
    availability.mockImplementation(
      async (_menuId: string, _staffId: string | undefined, from: string, to: string) => ({
        by_staff: [
          {
            staff_id: 's1',
            display_name: '担当A',
            slots: [
              { date: '2026-10-01', start: '10:00', end: '11:00' },
              { date: '2026-10-01', start: '11:00', end: '12:00' },
              { date: '2026-10-05', start: '10:00', end: '11:00' },
            ].filter((s) => s.date >= from && s.date <= to),
          },
        ],
        closed_dates: [],
      }),
    );
    mockSettings('calendar', 60);
    renderPicker();
    // 9月ではなく、空きのある一番早い日（10/1）の月を開く。
    expect(await screen.findByText('2026年10月')).toBeTruthy();
    expect(await screen.findByText('10/1(木) の空き')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '10月1日 空きあり' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('月を送ると、その月で空きのある一番早い日を選び直す', async () => {
    mockSettings('calendar', 60);
    renderPicker();
    // 今月（10月）の一番早い空き日から始まる。
    expect(await screen.findByText('10/16(金) の空き')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '次の月' }));
    expect(await screen.findByText('2026年11月')).toBeTruthy();
    // 来月の一番早い空き日（11/2）に変わり、前の月の日は下に残らない。
    expect(await screen.findByText('11/2(月) の空き')).toBeTruthy();
    expect(screen.queryByText('10/16(金) の空き')).toBeNull();
  });

  it('送った先の月に空きが無ければその旨だけ出す', async () => {
    mockSettings('calendar', 60);
    renderPicker();
    expect(await screen.findByText('10/16(金) の空き')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '次の月' }));
    expect(await screen.findByText('11/2(月) の空き')).toBeTruthy();
    // 12月に空きは無い（受付期限は12-14）。
    fireEvent.click(screen.getByRole('button', { name: '次の月' }));
    expect(await screen.findByText('2026年12月')).toBeTruthy();
    expect(await screen.findByText('この月は空きがありません。')).toBeTruthy();
  });
});

describe('dayStateLabel', () => {
  it('「10月4日 満席」のように日付と状態を返す', () => {
    expect(dayStateLabel('2026-10-04', 'full')).toBe('10月4日 満席');
    expect(dayStateLabel('2026-10-01', 'open')).toBe('10月1日 空きあり');
    expect(dayStateLabel('2026-10-07', 'closed')).toBe('10月7日 お休み');
    expect(dayStateLabel('2026-09-30', 'off')).toBe('9月30日 選択できません');
    expect(dayStateLabel('2026-10-14', 'past')).toBe('10月14日 過ぎた日');
    expect(dayStateLabel('2026-10-02', 'empty')).toBe('10月2日 空きなし');
  });
});

describe('カレンダーの見た目（設計合わせ）', () => {
  it('過ぎた日は押せず、枠が無く、薄い文字で「過ぎた日」と読む', async () => {
    await openCalendar();
    const past = await screen.findByRole('button', { name: '10月14日 過ぎた日' });
    // 押せない。
    expect(past.hasAttribute('disabled')).toBe(true);
    // 枠なし（border 系の見せ方を残さない）・薄い文字。
    expect(past.className).not.toContain('border');
    expect(past.className).toContain('text-ink-faint');
  });

  it.each([
    // [試験の今日, 最初に選ばれる日の読み上げ]
    ['2026-10-15', '10月16日 空きあり'],
    ['2026-10-01', '10月16日 空きあり'],
    ['2026-10-17', '10月20日 空きあり'],
  ])(
    'ます目は枠なし・高さが幅以下（h-10）で、塗るのは選んだ日だけ（今日=%s）',
    async (today, expectedLabel) => {
      // 実機の日付が何日でも同じ結果になるよう時計を固定する。
      // 最初に選ぶ日は今日によって変わるので日付を決め打ちせず、
      // 「押した状態のます目」を読み上げ名（aria-label）で探して確かめる。
      vi.setSystemTime(new Date(`${today}T00:00:00+09:00`));
      todayOverride = today;
      await openCalendar();
      // 月の読み込みが終わるまで待ってからます目を探す。
      const grid = await screen.findByLabelText('2026年10月の日付');
      expect(grid.className).toContain('grid-cols-7');
      // 枠の読み込みと「選ぶ」は別の描画で来るので、押した状態の
      // ます目が出るまで待つ。ます目は切り替え釦なので、選んだ状態は
      // aria-pressed が持つ（aria-selected は釦に付けられない）。
      const selected = await within(grid).findByRole('button', { pressed: true });
      expect(selected.getAttribute('aria-label')).toBe(expectedLabel);
      const cells = within(grid).getAllByRole('button');
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) {
        // 枠なし・縦長にしない（h-10 = 40px。375px幅で1ます≈42px）。
        expect(cell.className).not.toContain('border');
        expect(cell.className).not.toContain('min-h-14');
        expect(cell.className).toContain('h-10');
      }
      // 選んだ日だけ濃い緑で塗る。ほかは塗らない。
      expect(selected.className).toContain('bg-accent-deep');
      expect(selected.className).toContain('rounded-lg');
      const others = cells.filter((cell) => cell !== selected);
      expect(others.length).toBeGreaterThan(0);
      for (const cell of others) {
        expect(cell.className).not.toContain('bg-accent-deep');
      }
    },
  );

  it('空きありは点・満席は「満」・お休みは「休」の印が出る', async () => {
    await openCalendar();
    await screen.findByRole('button', { name: '10月16日 空きあり' });
    // 空きありのますには点、満席・お休みのますには文字の印。
    expect(screen.getByRole('button', { name: '10月16日 空きあり' }).textContent).toContain('●');
    expect(screen.getByRole('button', { name: '10月18日 満席' }).textContent).toContain('満');
    expect(screen.getByRole('button', { name: '10月21日 お休み' }).textContent).toContain('休');
  });

  it('枠が無い日は「満」を出さない（印なし・薄字・押せない・空きなしと読む）', async () => {
    await openCalendar();
    const empty = await screen.findByRole('button', { name: '10月17日 空きなし' });
    expect(empty.hasAttribute('disabled')).toBe(true);
    // 満・休・点の印は付けない。
    expect(empty.textContent).not.toContain('満');
    expect(empty.textContent).not.toContain('休');
    expect(empty.textContent).not.toContain('●');
    // 薄い文字。
    expect(empty.className).toContain('text-ink-faint');
  });
});
