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

export function jstStartsAtIso(date: string, hhmm: string): string {
  // `+09:00` suffix tells JS to treat the wall-clock time as JST.
  return new Date(`${date}T${hhmm}:00+09:00`).toISOString();
}

export function utcToJstDisplay(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}
