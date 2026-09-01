import type { Message } from '@line-crm/line-sdk';
import { autoTrackContent } from './auto-track.js';
import { buildMessage } from './line-message.js';
import {
  assertNoUnresolvedBroadcastVariables,
  getUnsupportedBroadcastVariables,
  hasRecipientVariables,
  renderBroadcastMessageContent,
  type BroadcastRenderContext,
} from './render-message.js';
import { addMessageVariation } from './stealth.js';

// LINE Messaging API が1回の送信リクエストで受け付ける上限。
// UIだけ上限を変えると、保存できても実送信で落ちるのでWorkerを正本にする。
export const MAX_BROADCAST_MESSAGES = 5;

const SUPPORTED_TYPES = new Set([
  'text', 'image', 'flex', 'location', 'video', 'audio', 'sticker', 'carousel',
]);

export interface BroadcastMessagePart {
  id: string;
  messageType: string;
  messageContent: string;
  altText?: string;
}

type StoredBubble = {
  id?: unknown;
  type?: unknown;
  content?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('messageBubbles content must be an object');
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`messageBubbles ${field} is required`);
  }
  return value;
}

function jsonObject(value: string, field: string): Record<string, unknown> {
  try {
    return record(JSON.parse(value));
  } catch {
    throw new Error(`messageBubbles ${field} must be valid JSON`);
  }
}

function contentForBubble(type: string, value: unknown): string {
  const content = record(value);
  if (type === 'text') return nonEmptyString(content.text, 'text');
  if (type === 'image' || type === 'video') {
    nonEmptyString(content.originalContentUrl, 'originalContentUrl');
    nonEmptyString(content.previewImageUrl, 'previewImageUrl');
    return JSON.stringify(content);
  }
  if (type === 'flex') {
    const flexJson = nonEmptyString(content.flexJson, 'flexJson');
    jsonObject(flexJson, 'flexJson');
    return flexJson;
  }
  if (type === 'carousel') {
    const columnsJson = nonEmptyString(content.columnsJson, 'columnsJson');
    let columns: unknown;
    try { columns = JSON.parse(columnsJson); } catch { /* handled below */ }
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new Error('messageBubbles columnsJson must be a non-empty JSON array');
    }
    return columnsJson;
  }

  const state = record(content.state);
  if (type === 'location') {
    const location = record(state.location);
    if ((typeof location.latitude !== 'string' && typeof location.latitude !== 'number')
      || (typeof location.longitude !== 'string' && typeof location.longitude !== 'number')
      || String(location.latitude).trim() === '' || String(location.longitude).trim() === '') {
      throw new Error('messageBubbles location coordinates are required');
    }
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('messageBubbles location coordinates are required');
    }
    return JSON.stringify({
      title: typeof location.title === 'string' && location.title.trim() ? location.title.trim() : '場所',
      address: typeof location.address === 'string' ? location.address.trim() : '',
      latitude,
      longitude,
    });
  }
  if (type === 'audio') {
    const audio = record(state.audio);
    const durationSeconds = Number(audio.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('messageBubbles audio duration is required');
    }
    return JSON.stringify({
      originalContentUrl: nonEmptyString(audio.originalContentUrl, 'audio originalContentUrl'),
      duration: Math.round(durationSeconds * 1000),
    });
  }
  if (type === 'sticker') {
    const sticker = record(state.sticker);
    return JSON.stringify({
      packageId: nonEmptyString(sticker.packageId, 'sticker packageId'),
      stickerId: nonEmptyString(sticker.stickerId, 'sticker stickerId'),
    });
  }
  throw new Error(`Unsupported broadcast bubble type: ${type}`);
}

export function parseBroadcastMessageParts(input: {
  messageType: string;
  messageContent: string;
  messageBubblesJson?: string | null;
  messageBubbles?: unknown;
  altText?: string | null;
}): BroadcastMessagePart[] {
  let bubbles: unknown = input.messageBubbles;
  if (bubbles === undefined && input.messageBubblesJson) {
    try { bubbles = JSON.parse(input.messageBubblesJson); } catch {
      throw new Error('message_bubbles_json must be valid JSON');
    }
  }
  if (bubbles === undefined || bubbles === null) {
    return [{
      id: 'legacy-1',
      messageType: input.messageType,
      messageContent: input.messageContent,
      altText: input.altText ?? undefined,
    }];
  }
  if (!Array.isArray(bubbles) || bubbles.length < 1 || bubbles.length > MAX_BROADCAST_MESSAGES) {
    throw new Error(`messageBubbles must contain 1 to ${MAX_BROADCAST_MESSAGES} items`);
  }
  return bubbles.map((item, index) => {
    const bubble = item as StoredBubble;
    const type = typeof bubble?.type === 'string' ? bubble.type : '';
    if (!SUPPORTED_TYPES.has(type)) throw new Error(`Unsupported broadcast bubble type: ${type || '(missing)'}`);
    return {
      id: typeof bubble.id === 'string' && bubble.id ? bubble.id : `bubble-${index + 1}`,
      messageType: type,
      messageContent: contentForBubble(type, bubble.content),
      altText: input.altText ?? undefined,
    };
  });
}

export function combinedMessageContent(parts: BroadcastMessagePart[]): string {
  return parts.map((part) => part.messageContent).join('\n');
}

export function unsupportedMessageVariables(parts: BroadcastMessagePart[]): string[] {
  return [...new Set(parts.flatMap((part) => getUnsupportedBroadcastVariables(part.messageContent)))];
}

export function hasRecipientVariablesInParts(parts: BroadcastMessagePart[]): boolean {
  return parts.some((part) => hasRecipientVariables(part.messageContent));
}

export async function autoTrackMessageParts(
  db: D1Database,
  parts: BroadcastMessagePart[],
  workerUrl: string | undefined,
  lineAccountId: string | null,
  trackLinks: boolean,
): Promise<BroadcastMessagePart[]> {
  if (!workerUrl || !trackLinks) return parts;
  return Promise.all(parts.map(async (part) => {
    const tracked = await autoTrackContent(db, part.messageType, part.messageContent, workerUrl, { lineAccountId });
    return { ...part, messageType: tracked.messageType, messageContent: tracked.content };
  }));
}

export function renderMessageParts(
  parts: BroadcastMessagePart[],
  context: BroadcastRenderContext,
): BroadcastMessagePart[] {
  return parts.map((part) => ({
    ...part,
    messageContent: renderBroadcastMessageContent(part.messageType, part.messageContent, context),
  }));
}

export function assertMessagePartsResolved(parts: BroadcastMessagePart[]): void {
  for (const part of parts) assertNoUnresolvedBroadcastVariables(part.messageContent);
}

export function buildMessages(parts: BroadcastMessagePart[]): Message[] {
  return parts.map((part) => buildMessage(part.messageType, part.messageContent, part.altText));
}

export function addTestLabel(parts: BroadcastMessagePart[]): BroadcastMessagePart[] {
  const firstText = parts.findIndex((part) => part.messageType === 'text');
  if (firstText < 0) return parts;
  return parts.map((part, index) => index === firstText
    ? { ...part, messageContent: `【テスト配信】\n${part.messageContent}` }
    : part);
}

export function varyTextMessages(messages: Message[], batchIndex: number, totalBatches: number): Message[] {
  if (totalBatches <= 1) return messages;
  const firstText = messages.findIndex((message) => message.type === 'text');
  if (firstText < 0) return messages;
  return messages.map((message, index) => index === firstText && message.type === 'text'
    ? { ...message, text: addMessageVariation(message.text, batchIndex) }
    : message);
}
