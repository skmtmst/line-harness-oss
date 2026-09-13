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
