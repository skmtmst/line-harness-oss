import { zonedWallTime } from './zoned-time.js';

export type AutomationWait = { durationMinutes: number } | { mode: 'next_day'; sendAtTime: string };

/** 下書き・共通アクション・実行で同じ待機設定を読む。 */
export function parseAutomationWait(params: Record<string, unknown>, maxDurationMinutes = 525600): AutomationWait | null {
  if (params.mode === 'next_day') {
    return typeof params.sendAtTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(params.sendAtTime)
      ? { mode: 'next_day', sendAtTime: params.sendAtTime } : null;
  }
  if (params.mode !== undefined && params.mode !== 'duration') return null;
  const minutes = params.durationMinutes ?? params.minutes;
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes > 0 && minutes % 5 === 0 && minutes <= maxDurationMinutes
    ? { durationMinutes: minutes } : null;
}

/** 翌日は元の出来事の現地暦で固定し、実行の遅れで基準を動かさない。 */
export function nextDayWaitAt(occurredAt: string, time: string, timeZone: string): string {
  const instant = new Date(occurredAt);
  if (!Number.isFinite(instant.getTime())) throw new Error('invalid_wait_origin');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(instant).map(item => [item.type, item.value]));
  return zonedWallTime(`${p.year}-${p.month}-${p.day}`, time, timeZone, 1);
}

export function automationWaitLabel(params: Record<string, unknown>): string {
  const wait = parseAutomationWait(params, Number.POSITIVE_INFINITY);
  if (!wait) return '待つ時間を決める';
  if ('mode' in wait) return `きっかけの翌日 ${wait.sendAtTime} まで待つ`;
  const minutes = wait.durationMinutes;
  return minutes % 1440 === 0 ? `${minutes / 1440} 日待つ` : minutes % 60 === 0 ? `${minutes / 60} 時間待つ` : `${minutes} 分待つ`;
}
