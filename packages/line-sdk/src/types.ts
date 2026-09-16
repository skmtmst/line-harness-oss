// ─── Source types ────────────────────────────────────────────────────────────

export interface UserSource {
  type: 'user';
  userId: string;
}

export interface GroupSource {
  type: 'group';
  groupId: string;
  userId?: string;
}

export interface RoomSource {
  type: 'room';
  roomId: string;
  userId?: string;
}

export type Source = UserSource | GroupSource | RoomSource;

// ─── Message subtypes ────────────────────────────────────────────────────────

export interface TextEventMessage {
  type: 'text';
  id: string;
  /** LINEが付ける引用用トークン。返信メッセージの quoteToken にそのまま使う。 */
  quoteToken?: string;
  text: string;
}

export interface ImageEventMessage {
  type: 'image';
  id: string;
  /** LINEが付ける引用用トークン。返信メッセージの quoteToken にそのまま使う。 */
  quoteToken?: string;
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
    previewImageUrl?: string;
  };
}

export interface VideoEventMessage {
  type: 'video';
  id: string;
  /** LINEが付ける引用用トークン。返信メッセージの quoteToken にそのまま使う。 */
  quoteToken?: string;
  duration: number;
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
    previewImageUrl?: string;
  };
}

export interface AudioEventMessage {
  type: 'audio';
  id: string;
  /** LINEが付ける引用用トークン。返信メッセージの quoteToken にそのまま使う。 */
  quoteToken?: string;
  duration: number;
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
  };
}

export interface FileEventMessage {
  type: 'file';
  id: string;
  /** LINEが付ける引用用トークン。返信メッセージの quoteToken にそのまま使う。 */
  quoteToken?: string;
  fileName: string;
  fileSize: number;
}

export interface LocationEventMessage {
  type: 'location';
  id: string;
  /** LINEが付ける引用用トークン。返信メッセージの quoteToken にそのまま使う。 */
  quoteToken?: string;
  title?: string;
  address?: string;
  latitude: number;
  longitude: number;
}

export interface StickerEventMessage {
  type: 'sticker';
  id: string;
  /** LINEが付ける引用用トークン。返信メッセージの quoteToken にそのまま使う。 */
  quoteToken?: string;
  packageId: string;
  stickerId: string;
  stickerResourceType: string;
}

export type EventMessage =
  | TextEventMessage
  | ImageEventMessage
  | VideoEventMessage
  | AudioEventMessage
  | FileEventMessage
  | LocationEventMessage
  | StickerEventMessage;

// ─── Webhook events ───────────────────────────────────────────────────────────

interface BaseEvent {
  timestamp: number;
  source: Source;
  webhookEventId: string;
  deliveryContext: {
    isRedelivery: boolean;
  };
  mode: 'active' | 'standby' | 'channel';
}

export interface MessageEvent extends BaseEvent {
  type: 'message';
  replyToken: string;
  message: EventMessage;
}

export interface FollowEvent extends BaseEvent {
  type: 'follow';
  replyToken: string;
  source: UserSource | GroupSource | RoomSource;
}

export interface UnfollowEvent extends BaseEvent {
  type: 'unfollow';
  source: UserSource | GroupSource | RoomSource;
}

/** LINEで利用者が送信済みメッセージを取り消したときのイベント。 */
export interface UnsendEvent extends BaseEvent {
  type: 'unsend';
  source: UserSource | GroupSource | RoomSource;
  unsend: {
    messageId: string;
  };
}

export interface PostbackEvent extends BaseEvent {
  type: 'postback';
  replyToken: string;
  postback: {
    data: string;
    params?: Record<string, string>;
  };
}

export type WebhookEvent =
  | MessageEvent
  | FollowEvent
  | UnfollowEvent
  | UnsendEvent
  | PostbackEvent;

export interface WebhookRequestBody {
  destination: string;
  events: WebhookEvent[];
}

// ─── User profile ─────────────────────────────────────────────────────────────

export interface UserProfile {
  displayName: string;
  userId: string;
  pictureUrl?: string;
  statusMessage?: string;
}

// ─── Send message types ───────────────────────────────────────────────────────

export type FlexContainer = object;

export interface TextMessage {
  type: 'text';
  text: string;
  /** 引用返信。受信メッセージの quoteToken をそのまま指定する。 */
  quoteToken?: string;
}

export interface ImageMessage {
  type: 'image';
  originalContentUrl: string;
  previewImageUrl: string;
  /** 引用返信。受信メッセージの quoteToken をそのまま指定する。 */
  quoteToken?: string;
}

export interface FlexMessage {
  type: 'flex';
  altText: string;
  contents: FlexContainer;
  /** 引用返信。受信メッセージの quoteToken をそのまま指定する。 */
  quoteToken?: string;
}

export interface VideoMessage {
  type: 'video';
  originalContentUrl: string;
  previewImageUrl: string;
  /** 引用返信。受信メッセージの quoteToken をそのまま指定する。 */
  quoteToken?: string;
}

export interface TemplateMessage {
  type: 'template';
  altText: string;
  template: Record<string, unknown>;
  /** 引用返信。受信メッセージの quoteToken をそのまま指定する。 */
  quoteToken?: string;
}

export interface ImageMapMessageType {
  type: 'imagemap';
  baseUrl: string;
  altText: string;
  baseSize: { width: number; height: number };
  actions: Record<string, unknown>[];
  /** 引用返信。受信メッセージの quoteToken をそのまま指定する。 */
  quoteToken?: string;
}

/** 位置情報。LINE上では地図の吹き出しになる。 */
export interface LocationMessage {
  type: 'location';
  /** 吹き出しの見出し。店名など。 */
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  /** 引用返信。受信メッセージの quoteToken をそのまま指定する。 */
  quoteToken?: string;
}

/**
 * スタンプ。
 *
 * packageId と stickerId の組でしか送れない（画像URLでは送れない）。
 * 送れるのは LINE が公開している基本スタンプだけで、購入したスタンプや
 * クリエイターズスタンプは Messaging API から送れない。
 */
export interface StickerMessage {
  type: 'sticker';
  packageId: string;
  stickerId: string;
  /** 引用返信。受信メッセージの quoteToken をそのまま指定する。 */
  quoteToken?: string;
}

/** 音声。m4a のみ。duration はミリ秒。 */
export interface AudioMessage {
  type: 'audio';
  originalContentUrl: string;
  duration: number;
  /** 引用返信。受信メッセージの quoteToken をそのまま指定する。 */
  quoteToken?: string;
}

export type Message =
  | TextMessage
  | ImageMessage
  | FlexMessage
  | VideoMessage
  | TemplateMessage
  | ImageMapMessageType
  | LocationMessage
  | StickerMessage
  | AudioMessage;

// ─── Rich Menu types ──────────────────────────────────────────────────────────

export interface RichMenuSize {
  width: number;
  height: number;
}

export interface RichMenuBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RichMenuActionPostback {
  type: 'postback';
  data: string;
  displayText?: string;
  label?: string;
}

export interface RichMenuActionMessage {
  type: 'message';
  text: string;
  label?: string;
}

export interface RichMenuActionUri {
  type: 'uri';
  uri: string;
  label?: string;
}

export interface RichMenuActionDatetimePicker {
  type: 'datetimepicker';
  data: string;
  mode: 'date' | 'time' | 'datetime';
  label?: string;
}

export interface RichMenuActionRichMenuSwitch {
  type: 'richmenuswitch';
  richMenuAliasId: string;
  data: string;
  label?: string;
}

export type RichMenuAction =
  | RichMenuActionPostback
  | RichMenuActionMessage
  | RichMenuActionUri
  | RichMenuActionDatetimePicker
  | RichMenuActionRichMenuSwitch;

export interface RichMenuArea {
  bounds: RichMenuBounds;
  action: RichMenuAction;
}

export interface RichMenuObject {
  richMenuId?: string;
  size: RichMenuSize;
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: RichMenuArea[];
}

// ─── Request types ────────────────────────────────────────────────────────────

export interface PushMessageRequest {
  to: string;
  messages: Message[];
  customAggregationUnits?: string[];
}

export interface MulticastRequest {
  to: string[];
  messages: Message[];
}

export interface BroadcastRequest {
  messages: Message[];
}

export interface ReplyMessageRequest {
  replyToken: string;
  messages: Message[];
}
