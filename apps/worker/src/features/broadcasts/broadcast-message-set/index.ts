// 内部から自分の公開入口を読み戻さず、実装の依存先を直接読む。
export { MAX_BROADCAST_MESSAGES, addTestLabel, assertMessagePartsResolved, autoTrackMessageParts, buildMessages, combinedMessageContent, hasRecipientVariablesInParts, parseBroadcastMessageParts, renderMessageParts, unsupportedMessageVariables, varyTextMessages } from '../broadcast-message-set.js';
export type { BroadcastMessagePart } from '../broadcast-message-set.js';
