// -----------------------------------------------------------------------------
// メッセージ種別
// -----------------------------------------------------------------------------

/** メッセージ種別 */
/**
 * シナリオの通で送れる種別（132 で拡張）。
 *
 * カルーセルは含めない。LINE のカルーセルは Flex の一種なので flex として
 * 送る。別の種別にすると、配信側で同じものを2通りに扱うことになる。
 */
export type MessageType =
  | "text"
  | "image"
  | "flex"
  | "location"
  | "video"
  | "audio"
  | "sticker"
  | "carousel"
  | "rich_message"
  | "coupon";

/** LINEに渡す種類。編集画面はリッチメッセージとして保持する。 */
export type LineMessageType = MessageType | 'imagemap';

// -----------------------------------------------------------------------------
// メッセージログ (MessageLog)
// -----------------------------------------------------------------------------

/** メッセージの方向 */
export type MessageDirection = "incoming" | "outgoing";

export interface MessageLog {
  /** 主キー (UUIDv4) */
  id: string;
  /** 友だちID */
  friendId: string;
  /** メッセージ方向 (incoming: ユーザー→Bot, outgoing: Bot→ユーザー) */
  direction: MessageDirection;
  /** メッセージ種別 */
  messageType: MessageType;
  /** メッセージ内容 */
  content: string;
  /** 紐付く一斉配信ID (outgoing かつ配信経由の場合) */
  broadcastId: string | null;
  /** 紐付くシナリオステップID (outgoing かつシナリオ経由の場合) */
  scenarioStepId: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}
