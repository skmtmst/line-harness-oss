/**
 * 受信箱の3列（会話一覧・トーク・顧客情報）が画面内に収まるかの判定。
 *
 * LAY-01(#982): ページ全体の幅ではなく、受信箱が実際に使える幅で列数を
 * 決める。以前は `xl:min-w-xl` がトーク列の `min-w-0` を上書きし、
 * 1280〜1536px で顧客情報が右に切れていた。さらに一覧が 2xl で
 * 288→420px へ急拡大するため、1502〜1535px で一度収まって 1536px で
 * 再び不足する構造だった。
 *
 * 3列分を確保できる幅のときだけ顧客情報を常設し、中間幅はドロワー、
 * 狭い幅は「会話／顧客情報」の重ね合わせに変える。
 */

/** 左メニュー(256px)＋本文の左右余白(40px×2)＋外枠(2px)。 */
export const INBOX_SHELL_CHROME = 256 + 80 + 2

/** 顧客情報を常設する幅での一覧列の幅（`lg:w-72`）。 */
export const INBOX_LIST_WIDTH = 288

/** 顧客情報列の幅（`w-[300px]`）。 */
export const INBOX_INFO_PANEL_WIDTH = 300

/**
 * トーク列が読み・操作できる最低幅の目安。吹き出し320px＋送信元の
 * 担当者欄96px＋余白を下回ると、宛先や操作が潰れる。
 */
export const INBOX_TALK_MIN_WIDTH = 560

/**
 * 顧客情報を3列目として常設し始める画面幅。
 *
 * **Tailwind の `2xl`(1536px) と同じ値にする。** `2xl:` 系のクラスと
 * ここのメディアクエリは同じ境界を指し、片方だけ変わると
 * 「ドロワーのつもりが列になる」ずれが起きる。
 */
export const INBOX_INFO_PANEL_MIN_VIEWPORT = 1536

/**
 * 与えた画面幅で3列が画面内に収まるか。
 * 収まらない幅で常設すると右列が `overflow-hidden` の外へ出て、
 * 氏名・閉じる操作へ到達できなくなる（LAY-01）。
 */
export function inboxThreeColumnsFit(viewportWidth: number): boolean {
  const usable = viewportWidth - INBOX_SHELL_CHROME
  return usable >= INBOX_LIST_WIDTH + INBOX_INFO_PANEL_WIDTH + INBOX_TALK_MIN_WIDTH
}
