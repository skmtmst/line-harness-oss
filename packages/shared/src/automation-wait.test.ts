import { expect, it } from 'vitest';
import { automationWaitLabel, nextDayWaitAt, parseAutomationWait } from './automation-wait.js';

it('既存の分数と翌日の時刻を区別し、不正な時刻や待ち時間を保存しない', () => {
  expect(parseAutomationWait({ minutes: 30 })).toEqual({ durationMinutes: 30 });
  expect(parseAutomationWait({ mode: 'next_day', sendAtTime: '00:05', durationMinutes: 5 })).toEqual({ mode: 'next_day', sendAtTime: '00:05' });
  for (const params of [{ durationMinutes: 0 }, { durationMinutes: 6 }, { durationMinutes: 525605 }, { durationMinutes: '5' },
    { mode: 'unknown', durationMinutes: 5 }, { mode: 'next_day', sendAtTime: '24:00' }, { mode: 'next_day', sendAtTime: '9:00' }]) {
    expect(parseAutomationWait(params)).toBeNull();
  }
  expect(parseAutomationWait({ durationMinutes: 525605 }, Number.POSITIVE_INFINITY)).toEqual({ durationMinutes: 525605 });
});

it.each([
  ['2026-10-30T16:00:00Z', '10:00', 'Asia/Tokyo', '2026-11-01T01:00:00.000Z'],
  ['2026-03-07T22:00:00Z', '02:30', 'America/New_York', '2026-03-08T07:30:00.000Z'],
  ['2026-10-31T22:00:00Z', '01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'],
  ['2026-12-31T14:00:00Z', '10:00', 'Asia/Tokyo', '2027-01-01T01:00:00.000Z'],
  ['2028-02-28T14:00:00Z', '10:00', 'Asia/Tokyo', '2028-02-29T01:00:00.000Z'],
])('元の出来事の現地暦の翌日を使う（%s）', (origin, time, zone, expected) => {
  expect(nextDayWaitAt(origin, time, zone)).toBe(expected);
});

it('待機の表示は保存した時刻・時間を示す', () => {
  expect(automationWaitLabel({ mode: 'next_day', sendAtTime: '10:15' })).toBe('きっかけの翌日 10:15 まで待つ');
  expect(automationWaitLabel({ durationMinutes: 60 })).toBe('1 時間待つ');
  expect(automationWaitLabel({ minutes: 1440 })).toBe('1 日待つ');
  expect(automationWaitLabel({ durationMinutes: 525605 })).toBe('525605 分待つ');
});
