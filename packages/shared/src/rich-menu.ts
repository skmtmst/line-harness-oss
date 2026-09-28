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
