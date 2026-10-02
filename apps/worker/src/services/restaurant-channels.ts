/** 店舗の暦日に合わせて集計する（受信時刻はUTC、日付境界は店舗の時間帯）。 */
function offsetAt(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(date);
  const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
  return match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000 : 0;
}

export function restaurantDayBounds(timezone: string, now = new Date()): [string, string] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const midnight = Date.UTC(get('year'), get('month') - 1, get('day'));
  const localToUtc = (civil: number) => {
    let utc = civil;
    for (let i = 0; i < 3; i++) utc = civil - offsetAt(new Date(utc), timezone);
    return new Date(utc).toISOString();
  };
  return [localToUtc(midnight), localToUtc(midnight + 86_400_000)];
}

export function restaurantChannelState(lastReceivedAt: string | null, active: boolean, now = new Date()) {
  if (!active || !lastReceivedAt) return { status: 'preparing', daysWithoutReceipt: null };
  const utc = /(?:Z|[+-]\d\d:\d\d)$/.test(lastReceivedAt) ? lastReceivedAt : `${lastReceivedAt.replace(' ', 'T')}Z`;
  const days = Math.max(0, Math.floor((now.getTime() - new Date(utc).getTime()) / 86_400_000));
  return { status: days > 0 ? 'not_receiving' : 'receiving', daysWithoutReceipt: days };
}
