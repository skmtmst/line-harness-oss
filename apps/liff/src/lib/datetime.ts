// All helpers operate in JST. The Worker accepts UTC ISO8601 — we convert
// at the boundary (jstStartsAtIso) before posting.

const JST_OFFSET_MS = 9 * 3600_000;

export function jstToday(): string {
  const now = new Date();
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatJp(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${'日月火水木金土'[d.getUTCDay()]})`;
}

/** '2026-10-01' → '10/1'。下の操作の帯 (「10/1 10:00 で確認へ」) で使う。 */
export function formatMd(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** '2026-10-01' → '水'。日付の札で使う。 */
export function formatWeekday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return '日月火水木金土'[d.getUTCDay()];
}

/** '2026-10-02' → '10月2日（金）」。★V8 の週の空き・確認の行で使う。 */
export function formatJpLong(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日月火水木金土'[d.getUTCDay()]}）`;
}

/** '13:00' + 105 → '14:45'。選んだ時間の終わり (13:00〜14:45) で使う。 */
export function addMinutesHm(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function jstParts(utcIso: string): string {
  return new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
}

/** UTC ISO → '10/1' (JST)。履歴の日付の四角で使う。 */
export function utcToJstMd(utcIso: string): string {
  const d = jstParts(utcIso);
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

/** UTC ISO → '10:00' (JST)。履歴の日付の四角で使う。 */
export function utcToJstHm(utcIso: string): string {
  return jstParts(utcIso).slice(11, 16);
}

const WEEKDAY_JA = '日月火水木金土';

/** UTC ISO → JST の曜日1文字。イベントの日時の見出しで使う。 */
export function utcToJstWeekday(utcIso: string): string {
  return WEEKDAY_JA[new Date(jstParts(utcIso)).getUTCDay()];
}

/** UTC ISO → '10月12日（日）13:00' (JST)。イベント詳細・確定画面で使う。 */
export function formatJstEventAt(utcIso: string): string {
  const d = jstParts(utcIso);
  return `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日（${utcToJstWeekday(utcIso)}）${d.slice(11, 16)}`;
}

/** 開始〜終了が JST の同じ日なら '13:00〜14:00'、日またぎなら両日を出す。 */
export function formatJstEventSpan(startsAt: string, endsAt: string): string {
  const s = jstParts(startsAt);
  const e = jstParts(endsAt);
  const head = formatJstEventAt(startsAt);
  if (s.slice(0, 10) === e.slice(0, 10)) return `${head}〜${e.slice(11, 16)}`;
  return `${head} 〜 ${formatJstEventAt(endsAt)}`;
}

/** 始まりの何時間前かの締め切り → '10月10日 18:00' (JST)。イベントの申し込み確認の注意で使う。 */
export function formatJstDeadline(startsAt: string, hoursBefore: number): string {
  const d = jstParts(new Date(new Date(startsAt).getTime() - hoursBefore * 3600_000).toISOString());
  return `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日 ${d.slice(11, 16)}`;
}

/** 取っておく残り時間 (秒) → '23時間 41分'。1時間未満は '41分'。空きが出た案内で使う。 */
export function formatHoldLeft(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}時間 ${m}分` : `${m}分`;
}

export function jstStartsAtIso(date: string, hhmm: string): string {
  // `+09:00` suffix tells JS to treat the wall-clock time as JST.
  return new Date(`${date}T${hhmm}:00+09:00`).toISOString();
}

export function utcToJstDisplay(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}
