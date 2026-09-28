/**
 * カード（リッチメッセージ）の中身の検証。
 *
 * R201: JSONとして読めるだけでは足りず、`{}` のような構造のない内容が
 * そのまま保存できていた。送るときはテキストに落ちるかLINEに断られる
 * だけで、設定した人には「正常なカード設定」に見える。保存する側
 * （管理画面の編集窓・自動応答の保存口）が同じ判定を使うためここに置く。
 */

/** カードの中身として受け付ける種別。LINEのFlexコンテナはこの2つ。 */
const FLEX_CONTAINER_TYPES = new Set(["bubble", "carousel"]);

/**
 * カードの内容が有効な設定か。返すのは画面に出す文言で、問題なければ null。
 *
 * カード以外（responseType が flex でない）・空はここでは見ない。
 * 空の必須チェック・文字数上限は呼び出し側の決めごとが持つ。
 */
export function validateFlexContent(
  responseType: string | null | undefined,
  responseContent: string | null | undefined,
): string | null {
  if (responseType !== "flex") return null;
  const raw = (responseContent ?? "").trim();
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "カードの内容をJSON形式で入力してください";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "カードの内容はバブルかカルーセルの形で入力してください";
  }
  const type = (parsed as { type?: unknown }).type;
  if (!FLEX_CONTAINER_TYPES.has(String(type))) {
    return "カードの内容はバブルかカルーセルの形で入力してください";
  }
  return null;
}
