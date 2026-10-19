import { jstDayStartIso } from '@line-crm/shared';



export function daysUntil(value: unknown, now: Date): number | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(`${value.slice(0, 10)}T00:00:00+09:00`);
  if (!Number.isFinite(time)) return null;
  const todayJst = new Date(jstDayStartIso(now));
  return Math.ceil((time - todayJst.getTime()) / 86_400_000);
}
