/**
 * 現地の日付・時刻をUTCへ直す共通関数（R458）。
 *
 * 定期レポートの「日曜09:00」は壁時計の約束。0時のUTC換算に
 * 時分を足すと、夏時間の切替日は1時間ずれる（America/New_Yorkで
 * 日曜09:00指定が3/8は10:00・11/1は08:00になった）。
 * 毎回「その日のその時刻」を壁時計として解き直す。
 *
 * 存在しない時刻（切替日の02:30など）は後の時刻へ寄せ、
 * 2回ある時刻（戻る日の01:30など）はいずれか1回に送る。
 * JSTのように切替の無い地域は従来どおりの値になる。
 *
 * routes と services の両方から使う。cloudflare:sockets のような
 * 実行環境に依存する読み込みはここに置かない（試験で読めるように）。
 */
export function zonedWallTime(date: string, sendTime: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = sendTime.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const wall = wallParts(new Date(guess), timeZone);
    const diff = target - Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

function wallParts(value: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return {
    year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'),
  };
}
