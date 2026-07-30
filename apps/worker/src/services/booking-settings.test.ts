import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOKING_SETTINGS,
  isWithinReceptionWindow,
} from './booking-settings.js';

describe('isWithinReceptionWindow', () => {
  const startsAt = new Date('2026-08-10T02:00:00.000Z');

  it('accepts until the configured relative closing time', () => {
    const settings = {
      ...DEFAULT_BOOKING_SETTINGS,
      reception_end_mode: 'relative' as const,
      reception_end_minutes_before: 60,
    };
    expect(
      isWithinReceptionWindow(settings, startsAt, new Date('2026-08-10T00:59:59.000Z')),
    ).toBe(true);
    expect(
      isWithinReceptionWindow(settings, startsAt, new Date('2026-08-10T01:00:01.000Z')),
    ).toBe(false);
  });

  it('does not open before the configured number of days', () => {
    const settings = {
      ...DEFAULT_BOOKING_SETTINGS,
      reception_start_mode: 'relative' as const,
      reception_start_days_before: 30,
    };
    expect(
      isWithinReceptionWindow(settings, startsAt, new Date('2026-07-10T01:59:59.000Z')),
    ).toBe(false);
    expect(
      isWithinReceptionWindow(settings, startsAt, new Date('2026-07-11T02:00:00.000Z')),
    ).toBe(true);
  });
});
