import { describe, it, expect } from 'vitest';
import { computeNextDeliveryAt, type ScenarioRow, type StepRow } from './scenario-schedule.js';

/**
 * computeNextDeliveryAt は「JST clock-time を UTC として表現する Date
 * (shifted frame)」を前提にしている(呼び出し元: apps/worker/src/routes/scenarios.ts,
 * apps/worker/src/services/step-delivery.ts — いずれも
 * `new Date(realInstant.getTime() + 9*60*60_000)` で作って渡す)。
 *
 * `new Date('...+09:00')` のような実オフセット付きの値は、その呼び出し元が
 * 渡す形と一致しない。JST の時計の値をそのまま `Z` 付きで書くことで
 * shifted frame を再現する。
 */
function jst(isoWithoutOffset: string): Date {
  return new Date(`${isoWithoutOffset}Z`);
}

const enrolledAt = jst('2026-05-09T14:32:00');
const now = jst('2026-05-09T14:32:00');

describe('computeNextDeliveryAt', () => {
  describe('relative mode', () => {
    it('adds delay_minutes to previousDeliveredAt', () => {
      const scenario: ScenarioRow = { delivery_mode: 'relative' };
      const step: StepRow = { delay_minutes: 60, offset_days: null, offset_minutes: null, delivery_time: null };
      const previous = jst('2026-05-09T15:00:00');
      const result = computeNextDeliveryAt(scenario, step, { enrolledAt, previousDeliveredAt: previous, now });
      expect(result.toISOString()).toBe(jst('2026-05-09T16:00:00').toISOString());
    });

    it('handles delay_minutes=0 (immediate)', () => {
      const scenario: ScenarioRow = { delivery_mode: 'relative' };
      const step: StepRow = { delay_minutes: 0, offset_days: null, offset_minutes: null, delivery_time: null };
      const result = computeNextDeliveryAt(scenario, step, { enrolledAt, previousDeliveredAt: enrolledAt, now });
      expect(result.toISOString()).toBe(enrolledAt.toISOString());
    });
  });

  describe('elapsed mode', () => {
    it('adds offset_days*1440 + offset_minutes to enrolledAt', () => {
      const scenario: ScenarioRow = { delivery_mode: 'elapsed' };
      const step: StepRow = { delay_minutes: 0, offset_days: 1, offset_minutes: 120, delivery_time: null };
      const result = computeNextDeliveryAt(scenario, step, { enrolledAt, previousDeliveredAt: enrolledAt, now });
      expect(result.toISOString()).toBe(jst('2026-05-10T16:32:00').toISOString());
    });

    it('offset_days=0 offset_minutes=0 = immediate', () => {
      const scenario: ScenarioRow = { delivery_mode: 'elapsed' };
      const step: StepRow = { delay_minutes: 0, offset_days: 0, offset_minutes: 0, delivery_time: null };
      const result = computeNextDeliveryAt(scenario, step, { enrolledAt, previousDeliveredAt: enrolledAt, now });
      expect(result.toISOString()).toBe(enrolledAt.toISOString());
    });

    it('handles month boundary', () => {
      const scenario: ScenarioRow = { delivery_mode: 'elapsed' };
      const step: StepRow = { delay_minutes: 0, offset_days: 25, offset_minutes: 0, delivery_time: null };
      const result = computeNextDeliveryAt(scenario, step, { enrolledAt, previousDeliveredAt: enrolledAt, now });
      expect(result.toISOString()).toBe(jst('2026-06-03T14:32:00').toISOString());
    });

    it('ignores previousDeliveredAt (anchored to enrolledAt)', () => {
      const scenario: ScenarioRow = { delivery_mode: 'elapsed' };
      const step: StepRow = { delay_minutes: 0, offset_days: 2, offset_minutes: 360, delivery_time: null };
      const farFuturePrev = jst('2026-12-31T00:00:00');
      const result = computeNextDeliveryAt(scenario, step, {
        enrolledAt,
        previousDeliveredAt: farFuturePrev,
        now: enrolledAt,
      });
      expect(result.toISOString()).toBe(jst('2026-05-11T20:32:00').toISOString());
    });
  });

  describe('absolute_time mode', () => {
    it('schedules for offset_days later at delivery_time HH:MM JST', () => {
      const scenario: ScenarioRow = { delivery_mode: 'absolute_time' };
      const step: StepRow = { delay_minutes: 0, offset_days: 1, offset_minutes: null, delivery_time: '09:00' };
      const result = computeNextDeliveryAt(scenario, step, { enrolledAt, previousDeliveredAt: enrolledAt, now });
      expect(result.toISOString()).toBe(jst('2026-05-10T09:00:00').toISOString());
    });

    it('clamps past time to now', () => {
      const scenario: ScenarioRow = { delivery_mode: 'absolute_time' };
      const step: StepRow = { delay_minutes: 0, offset_days: 0, offset_minutes: null, delivery_time: '09:00' };
      const result = computeNextDeliveryAt(scenario, step, { enrolledAt, previousDeliveredAt: enrolledAt, now });
      expect(result.toISOString()).toBe(now.toISOString());
    });

    it('handles year boundary', () => {
      const lateYear = jst('2026-12-30T14:32:00');
      const scenario: ScenarioRow = { delivery_mode: 'absolute_time' };
      const step: StepRow = { delay_minutes: 0, offset_days: 5, offset_minutes: null, delivery_time: '08:00' };
      const result = computeNextDeliveryAt(scenario, step, {
        enrolledAt: lateYear,
        previousDeliveredAt: lateYear,
        now: lateYear,
      });
      expect(result.toISOString()).toBe(jst('2027-01-04T08:00:00').toISOString());
    });
  });
});
