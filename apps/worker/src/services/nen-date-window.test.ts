import { expect, it } from 'vitest';
import { daysUntil } from './nen-date-window.js';

it.each(['UTC', 'Asia/Tokyo', 'Pacific/Auckland', 'Pacific/Honolulu'])('日本時間の朝の日付差は実行地域%sで変わらない', (zone) => {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    const now = new Date('2026-09-30T15:09:00Z');
    expect(daysUntil('2026-10-01', now)).toBe(0);
    expect(daysUntil('2026-10-02', now)).toBe(1);
    expect(daysUntil('2026-09-30', now)).toBe(-1);
    expect(daysUntil('invalid', now)).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
