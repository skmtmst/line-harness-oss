import { HOURS_WEEKDAYS, hoursDateRange, type HoursWorkspace, type HoursWorkspaceEvent, type OpeningPeriod } from '@line-crm/shared';

const periodsText = (periods: OpeningPeriod[]) => periods.length ? periods.map(p => `${p.open}–${p.close === '00:00' ? '翌0:00' : p.close < p.open ? `翌${p.close}` : p.close}`).join(' / ') : '休業';
const dateText = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 保存した差分から表示内容を作る。送信済みの判定は呼び出し側で実記録と照合する。 */
export function hoursWorkspaceEvent(previous: HoursWorkspace, next: HoursWorkspace, sent: boolean): Pick<HoursWorkspaceEvent, 'summary' | 'description' | 'googleState'> | null {
  const source = sent ? previous : next;
  const output = (summary: string, description: string) => ({ summary, description: description.slice(0, 500), googleState: sent ? 'sent' as const : 'draft' as const });
  if (sent || !same(previous.draft.days, next.draft.days) || !same(previous.notes, next.notes)) {
    const days = source.draft.days.filter(day => sent || !same(previous.draft.days.find(d => d.date === day.date), day) || previous.notes[day.date] !== next.notes[day.date]).sort((a,b)=>a.date.localeCompare(b.date));
    if (days.length) {
      const dates = days.map(d=>d.date);
      const continuous = hoursDateRange(dates[0], dates[dates.length-1]).length === dates.length;
      const label = continuous && dates.length > 1 ? `${dateText(dates[0])} – ${dateText(dates[dates.length-1])}` : dates.map(dateText).join('・');
      const equal = days.every(d=>d.closed===days[0].closed && same(d.periods,days[0].periods) && d.remove===days[0].remove);
      const memo = source.notes[dates[0]];
      const commonMemo = memo && dates.every(d=>source.notes[d]===memo);
      const added = days.every(day=>!previous.draft.days.some(d=>d.date===day.date));
      const summary = sent ? '特別営業日の営業時間を反映' : commonMemo ? `${memo.slice(0,120)}を${added?'追加':'変更'}` : '特別営業日の営業時間を変更';
      return output(summary, `${label}${equal ? days[0].remove ? 'を通常の営業時間に戻す' : days[0].closed ? 'を休業' : ` ${periodsText(days[0].periods)}` : `（${dates.length}日の変更）`}`);
    }
    if (!sent) return output('特別営業日の変更を取り消し', '指定していた日付の変更を取り消しました。');
  }
  if (sent && source.draft.holidayChanged || !same(previous.holiday,next.holiday)) {
    const rule=source.holiday;
    return output(sent?'祝日の営業時間を反映':'祝日の営業時間を変更', rule.mode==='weekly'?'曜日どおりに営業':rule.mode==='closed'?'祝日は休業':`${periodsText(rule.periods)}${rule.overrideClosedWeekday?' · 定休日でも祝日は営業':''}`);
  }
  if (sent && source.draft.weekly || !same(previous.draft.weekly,next.draft.weekly)) {
    const week=source.draft.weekly;
    const labels=['月','火','水','木','金','土','日'];
    return output(sent?'毎週の営業時間を反映':'毎週の営業時間を変更', week?HOURS_WEEKDAYS.map((d,i)=>`${labels[i]} ${periodsText(week[d])}`).join(' · '):'毎週の営業時間の変更を取り消しました。');
  }
  if (!same(previous.services,next.services) || sent && source.draft.serviceIds.length) return output(sent?'サービス別の営業時間を反映':'サービス別の営業時間を変更', source.services.map(s=>`${s.label} ${periodsText(s.periods)}`).join(' · '));
  return null;
}
