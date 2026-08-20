import { parseHhMm, toJstParts } from './response-window';

/**
 * リマインダを「いつ送るか」を決める。
 *
 * ゴール日（予約日・開催日）を起点に、そこから何日前の何時、という形で決める。
 * **計算は日本時間で行う。** Workers は UTC で動くので、ローカルの日付を使うと
 * 深夜0時前後で1日ずれる。「前日の20時」が当日の20時になると、リマインダが
 * 意味を失う（当日に「明日です」と送ることになる）。
 */

/**
 * リマインダの配信方式。**リマインダごとに1つだけ持ち、作成後は変えられない。**
 *
 * 途中で変えると、すでに登録済みの友だちの配信予定がすべて変わる。「3日前」で
 * 予約が入っている人が、突然「4320分前」の解釈に切り替わってしまう。
 * Lステップも同じ理由で、作成後の変更を禁じている。
 *
 *   'time'      … ゴールの○日前の●時
 *   'countdown' … ゴールから何分ずらすか
 */
export type ReminderDeliveryMode = 'time' | 'countdown';

export interface ReminderStepTiming {
  /**
   * ゴールから何日ずらすか。負が前、正が後。
   * これと sendAtTime の両方があるときだけ、日付での指定として扱う。
   */
  offsetDays?: number | null;
  /** その日の何時に送るか。日本時間の "HH:MM"。 */
  sendAtTime?: string | null;
  /** 昔からある指定。ゴールから何分ずらすか。上の2つが無いときに使う。 */
  offsetMinutes: number;
}

/**
 * 日付での指定（○日前の●時）として扱えるか。
 *
 * 方式が 'time' でも、日数か時刻が埋まっていなければ扱えない。書きかけの通を
 * 「0日前の0時」として送ってしまうより、従来のオフセットに落とすほうが害が小さい。
 */
export function usesDayTiming(step: ReminderStepTiming): boolean {
  return (
    step.offsetDays !== null &&
    step.offsetDays !== undefined &&
    typeof step.sendAtTime === 'string' &&
    parseHhMm(step.sendAtTime) !== null
  );
}

/**
 * 実際に送る時刻を返す。
 *
 * どちらの値を見るかは、リマインダの配信方式で決まる。**1つのリマインダの中で
 * 混ざることはない。** 混ざると、画面を見てもどちらで動いているのか読めなくなる。
 *
 * 方式が 'time' でも、日数と時刻が埋まっていなければオフセット（分）に落とす。
 */
export function resolveReminderSendAt(
  targetDate: Date,
  step: ReminderStepTiming,
  mode: ReminderDeliveryMode = 'countdown',
): Date {
  if (mode !== 'time' || !usesDayTiming(step)) {
    return new Date(targetDate.getTime() + step.offsetMinutes * 60_000);
  }

  const minutes = parseHhMm(step.sendAtTime as string) as number;
  // ゴール日の「日本時間での暦日」を出し、そこから日数をずらす。
  // UTC のまま日を足すと、ゴールが日本時間の朝9時（UTC 前日0時）のときに
  // 1日ずれる。
  const jst = toJstParts(targetDate);
  const [year, month, day] = jst.date.split('-').map(Number);

  // 日本時間の 0:00 を UTC の絶対時刻として作り、そこに日数と時刻を足す。
  // Date.UTC を使うのは、実行環境の時計に依らせないため。
  const jstMidnightUtc = Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000;
  return new Date(
    jstMidnightUtc + (step.offsetDays as number) * 24 * 60 * 60 * 1000 + minutes * 60_000,
  );
}

/** 画面に出す言葉。「3日前の10:00」「当日の9:00」「2日後の18:00」。 */
export function describeReminderTiming(
  step: ReminderStepTiming,
  mode: ReminderDeliveryMode = 'countdown',
): string {
  if (mode !== 'time' || !usesDayTiming(step)) {
    const minutes = step.offsetMinutes;
    if (minutes === 0) return 'ゴールちょうど';
    const abs = Math.abs(minutes);
    const unit =
      abs % (24 * 60) === 0
        ? `${abs / (24 * 60)}日`
        : abs % 60 === 0
          ? `${abs / 60}時間`
          : `${abs}分`;
    return minutes < 0 ? `${unit}前` : `${unit}後`;
  }
  const days = step.offsetDays as number;
  const time = step.sendAtTime as string;
  if (days === 0) return `当日の${time}`;
  return days < 0 ? `${Math.abs(days)}日前の${time}` : `${days}日後の${time}`;
}
