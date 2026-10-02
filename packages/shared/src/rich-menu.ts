export type RichMenuSize = "large" | "compact";
// LINE のリッチメニューが持てる動き。datetimepicker（日時を選ぶ）と
// clipboard（文字をコピーする）は後から増えた2つで、DB の action_type
//（uri/message/postback/richmenuswitch の4つのまま）とは別に intent で持つ。
export type RichMenuActionType =
  | "uri"
  | "message"
  | "postback"
  | "richmenuswitch"
  | "datetimepicker"
  | "clipboard";
export type RichMenuAreaIntent =
  | "url"
  | "tel"
  | "text"
  | "template"
  | "form"
  | "switch"
  | "postback"
  | "datetime"
  | "clipboard";

/** 1つのメニューが持てるページの上限（要件 v6-12 §5-2）。 */
export const RICH_MENU_MAX_PAGES = 10;

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
  datetime: "datetimepicker",
  clipboard: "clipboard",
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

/**
 * intent を DB の action_type（4つのまま）へ落とす正本。
 * datetimepicker・clipboard は DB の CHECK に無いため、データを運ぶ
 * postback に載せて保存し、公開のときに intent から本来の動きへ戻す。
 */
export const RICH_MENU_DB_ACTION_TYPE_BY_INTENT = {
  url: "uri",
  tel: "uri",
  form: "uri",
  text: "message",
  template: "postback",
  switch: "richmenuswitch",
  postback: "postback",
  datetime: "postback",
  clipboard: "postback",
} as const satisfies Record<RichMenuAreaIntent, "uri" | "message" | "postback" | "richmenuswitch">;
