export type RichMenuSize = "large" | "compact";
export type RichMenuActionType = "uri" | "message" | "postback" | "richmenuswitch";
export type RichMenuAreaIntent =
  | "url"
  | "tel"
  | "text"
  | "template"
  | "form"
  | "switch"
  | "postback";

/** LINEへ登録できるリッチメニュー画像の寸法。 */
export const RICH_MENU_DIMENSIONS = {
  large: { width: 2500, height: 1686 },
  compact: { width: 2500, height: 843 },
} as const satisfies Record<RichMenuSize, { width: number; height: number }>;

/** 運用者向けintentをLINE actionへ変換する正本。 */
export const RICH_MENU_ACTION_TYPE_BY_INTENT = {
  url: "uri",
  tel: "uri",
  form: "uri",
  text: "message",
  template: "postback",
  switch: "richmenuswitch",
  postback: "postback",
} as const satisfies Record<RichMenuAreaIntent, RichMenuActionType>;

/**
 * 「URLを開く」ボタンの飛び先として LINE の uri アクションが受け付ける
 * scheme。`javascript:` や `data:` などは送っても動かない（危険でもある）
 * ため、保存・公開前の検査でこの一覧だけを通す。
 */
export const RICH_MENU_URI_ALLOWED_SCHEMES = ["https:", "http:", "tel:", "mailto:"] as const;

/**
 * 飛び先 URI を検査し、だめなら理由の文を返す。空なら「未入力」。
 * 画面の「設定済み」判定と、公開直前のサーバ側検査で同じ判定を使う。
 */
export function richMenuUriError(uri: string): string | null {
  const trimmed = uri.trim();
  if (!trimmed) return "URLを入力してください";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "URLの形が正しくありません。https:// から始まるアドレスを入力してください";
  }
  if (!RICH_MENU_URI_ALLOWED_SCHEMES.includes(parsed.protocol as (typeof RICH_MENU_URI_ALLOWED_SCHEMES)[number])) {
    return "URLは https://・http://・tel:・mailto: のいずれかで始めてください";
  }
  return null;
}
