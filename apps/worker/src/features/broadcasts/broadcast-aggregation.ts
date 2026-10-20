/*
 * 開封数を数えるための「集計ユニット」。
 *
 * LINE は push / multicast で送ったメッセージの開封数を、
 * `customAggregationUnit` を付けたときだけ返す。付けないと数えられない。
 *
 * ただし**アカウントあたり月1,000ユニット**の上限がある。1配信＝1ユニット
 * なので、全部の配信で付けると月1,000配信で頭打ちになる。しかも上限に
 * 当たったことは送信のエラーにならず、**あとから数字が出ないだけ**なので
 * 気づきにくい。
 *
 * そのため配信ごとに「取る / 取らない」を選べるようにしてある。
 * 既定は取る（これまでの挙動）。
 */

/** ユニット名に使えるのは英数字と `_` のみ、1〜30文字。 */
function unitName(broadcastId: string): string {
  return `bcast_${broadcastId.slice(0, 8).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

/**
 * この配信で使う集計ユニット。「取らない」なら null。
 *
 * `measure_opens` が無い行（この列が入る前に作られた配信）は、
 * これまでどおり取る扱いにする。
 */
export function aggregationUnitFor(
  broadcast: { id: string; measure_opens?: number | null },
): string | null {
  const measure = broadcast.measure_opens;
  if (measure !== undefined && measure !== null && Number(measure) === 0) return null;
  return unitName(broadcast.id);
}

/** LINE へ渡す形。取らないなら undefined（引数ごと省く）。 */
export function aggregationUnits(unit: string | null): string[] | undefined {
  return unit ? [unit] : undefined;
}
