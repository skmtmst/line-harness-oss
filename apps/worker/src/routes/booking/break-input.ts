

// 日付指定はシフトと同じ上限

export type BreakRow = {
  id: string;
  weekday: number | null;
  work_date: string | null;
  start_time: string;
  end_time: string;
};

/** 同時更新の検出用。行の中身から決まる不透明な版。保存のたびに変わる。 */
export function breaksFingerprint(rows: BreakRow[]): string {
  const canonical = rows
    .map((row) => `${row.id}|${row.weekday ?? ''}|${row.work_date ?? ''}|${row.start_time}|${row.end_time}`)
    .sort()
    .join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${rows.length}:${(hash >>> 0).toString(16)}`;
}

export function tzOffsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUTC - utcMs) / 60000);
}

/**
 * 店舗時間での「日付 時刻」をUTCへ解く。存在しない時刻(DSTのgap)は null。
 * あいまいな時刻(fold)は早い側(=夏時間側)の発生に決めてオフセットを返す。
 */
export function resolveWallTime(
  date: string,
  time: string,
  timeZone: string,
): { offsetMinutes: number } | null {
  const wallAsUTC = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(wallAsUTC)) return null;
  let utc = wallAsUTC;
  for (let i = 0; i < 4; i++) {
    utc = wallAsUTC - tzOffsetMinutes(timeZone, utc) * 60000;
  }
  const check = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utc));
  const get = (type: string) => check.find((part) => part.type === type)?.value ?? '';
  const same =
    `${get('year')}-${get('month')}-${get('day')}` === date &&
    `${get('hour')}:${get('minute')}` === time;
  if (!same) return null;
  return { offsetMinutes: tzOffsetMinutes(timeZone, utc) };
}

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

export async function staffStoreTimeZone(db: D1Database, accountId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT timezone FROM booking_settings WHERE line_account_id = ? LIMIT 1`)
    .bind(accountId)
    .first<{ timezone: string | null }>()
    .catch(() => null);
  return row?.timezone?.trim() || 'Asia/Tokyo';
}

/** 同じ曜日・同じ日の範囲が重なっていたら 422 の理由を返す。境界の一致は重なりと見ない。 */
export function findBreakOverlap(
  items: Array<{ key: string; start_time: string; end_time: string }>,
): string | null {
  const sorted = [...items].sort((a, b) => (
    a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0
  ));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_time < sorted[i - 1].end_time) return 'break_overlap';
  }
  return null;
}
