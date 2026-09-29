/*
 * 一覧の検索語の上限（#625）。
 *
 * 2000文字級の検索語をそのまま送ると、URL が異常に長くなるだけでなく、
 * サーバー側の LIKE パターン上限（D1 は 50 バイト）を踏んで一覧ごと
 * 500 になっていた。サーバー側は instr() 部分一致へ直し、
 * /api/chats 系は従来どおり 200 文字で切り詰める。
 * 画面側も同じ長さで切り詰めて、「入力した語」と「実際に効く語」をそろえる。
 */
export const SEARCH_QUERY_MAX_LENGTH = 200

/**
 * 検索欄の入力を上限へ切り詰める。
 * 貼り付け・保存した検索条件の復元など、入力欄以外から値が来る経路でも
 * 同じ関数を通す。上限内の文字列はそのまま返す。
 */
export function clampSearchQuery(value: string): string {
  return value.length > SEARCH_QUERY_MAX_LENGTH
    ? value.slice(0, SEARCH_QUERY_MAX_LENGTH)
    : value
}
