import { jstCalendar } from './jst-datetime.js';
import { parseExecutionDateRange } from './date-range.js';

export type ReportPeriodInput = { from?: string; to?: string; period?: 'this_month' | 'last_month' | 'all' };
/** Report dates use Japan's calendar, including the whole final day. Bounds use the DB's JST format. */
export function reportPeriod(input: ReportPeriodInput, now = new Date()): { from?: string; until?: string } {
  if (input.period !== undefined && !['this_month','last_month','all'].includes(input.period)) throw new Error('期間の指定を確認してください');
  if (input.period && (input.from || input.to)) throw new Error('日付と月の指定はどちらか1つにしてください');
  if (input.period === 'all') return {};
  if (input.period) {
    const jst = jstCalendar(now), year = jst.getUTCFullYear(), month = jst.getUTCMonth()-(input.period==='last_month'?1:0);
    const first = new Date(Date.UTC(year,month,1)), end = new Date(Date.UTC(year,month+1,1));
    return {from:`${first.toISOString().slice(0,10)} 00:00:00`,until:`${end.toISOString().slice(0,10)} 00:00:00`};
  }
  const range = parseExecutionDateRange(input);
  return { ...(range.from ? {from:range.from.slice(0,19).replace('T',' ')} : {}), ...(range.until ? {until:range.until.slice(0,19).replace('T',' ')} : {}) };
}
