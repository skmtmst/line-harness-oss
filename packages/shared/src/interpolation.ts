/*
 * 本文に書ける差し込みの一覧と、その種別。
 *
 * 画面（何を入れられるか・保存前の確認）と worker（何を置き換えるか・
 * 1人ずつ送るか）の**両方**が同じ判断をしないといけない。別々に持つと、
 * 画面では入れられるのに送信時に弾かれる差し込みができる。一斉配信は
 * 予約で動くので、弾かれるのは配信予定の時刻——直せる人が見ていない時刻
 * になる。
 */

/**
 * 相手ごとに変わる差し込み。
 *
 * これが1つでもあると、配信は**1人ずつ**送ることになる（multicast は
 * 全員に同じ本文を送る仕組みなので使えない）。送信数は変わらないが、
 * 呼び出し回数が増えるので、無いなら無いで済ませたい。
 */
const PER_RECIPIENT = [
  /^name$/,
  /^field\.[a-z][a-z0-9_]*$/,
];

/**
 * 配信全体で1つに決まる差し込み。
 *
 * 送る前にまとめて置き換えられる。共通情報（営業時間など）と配信日は
 * 誰に送っても同じ値になる。
 */
const BROADCAST_WIDE = [
  /^liff_id$/,
  /^var\.[a-z][a-z0-9_]*$/,
  /^date([+-]\d+)?(:[a-z_]+)?$/,
  /^days_until:\d{4}-\d{2}-\d{2}$/,
];

/** `{{ … }}` を拾う。中に `{` `}` は入らない。 */
export const INTERPOLATION_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** 本文に書かれている差し込みの名前を、重複なく集める。 */
export function listInterpolations(content: string): string[] {
  return [...new Set([...content.matchAll(INTERPOLATION_RE)].map((m) => m[1].trim()))];
}

/** 相手ごとに変わるか。 */
export function isPerRecipientInterpolation(name: string): boolean {
  return PER_RECIPIENT.some((re) => re.test(name));
}

/** 配信全体で1つに決まるか。 */
export function isBroadcastWideInterpolation(name: string): boolean {
  return BROADCAST_WIDE.some((re) => re.test(name));
}

/** 一斉配信で置き換えられるか。 */
export function isSupportedInterpolation(name: string): boolean {
  return isPerRecipientInterpolation(name) || isBroadcastWideInterpolation(name);
}

/**
 * 置き換えられない差し込み。
 *
 * 見つかったら保存させない。そのまま送ると `{{pet_name}}` のような
 * 書きかけの文字が相手に届く。
 */
export function findUnsupportedInterpolations(content: string): string[] {
  return listInterpolations(content).filter((name) => !isSupportedInterpolation(name));
}

/** 1人ずつ送る必要があるか。 */
export function needsPerRecipientDelivery(content: string): boolean {
  return listInterpolations(content).some(isPerRecipientInterpolation);
}
