/*
 * LINE のメッセージを組み立てる。
 *
 * **シナリオと一斉配信で同じものを使う。** 別々に持っていたときは、
 * シナリオだけスタンプ・カルーセル・位置情報・音声に対応していて、
 * 一斉配信は text / image / flex の3つしか組み立てられなかった。
 * それ以外を渡すと「テキストに JSON を入れたもの」に落ちるので、
 * **中身の JSON がそのまま相手のトークに届く**。
 * 片方だけ直すと必ずまたずれるので、1か所にまとめてある。
 *
 * 読めない中身はテキストに落とす（例外にしない）。1通の中身が壊れている
 * だけで配信全体や、その人の以降の配信まで止まると困る。
 */
import type { Message } from '@line-crm/line-sdk';
import { extractFlexAltText } from '../utils/flex-alt-text.js';

/** Remove empty text nodes and boxes with empty text from Flex JSON */
function cleanEmptyNodes(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const node = obj as Record<string, unknown>;
  for (const key of ['header', 'body', 'footer']) {
    if (node[key]) cleanEmptyNodes(node[key]);
  }
  if (Array.isArray(node.contents)) {
    // First clean children recursively
    for (const c of node.contents as unknown[]) cleanEmptyNodes(c);
    // Then filter out empty nodes
    node.contents = (node.contents as unknown[]).filter((c) => {
      if (!c || typeof c !== 'object') return true;
      const child = c as Record<string, unknown>;
      // Remove empty text nodes
      if (child.type === 'text') {
        const text = child.text;
        return typeof text === 'string' && text.trim().length > 0;
      }
      // Remove box nodes where any text child is empty (metadata rows with no value)
      if (child.type === 'box' && Array.isArray(child.contents)) {
        const texts = (child.contents as Array<Record<string, unknown>>).filter(t => t.type === 'text');
        if (texts.length >= 2) {
          // horizontal box with label + value — remove if value is empty
          const hasEmptyText = texts.some(t => typeof t.text === 'string' && t.text.trim() === '');
          if (hasEmptyText) return false;
        }
      }
      return true;
    });
  }
}

export function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }

  if (messageType === 'image') {
    // messageContent is expected to be JSON: { originalContentUrl, previewImageUrl }
    try {
      const parsed = JSON.parse(messageContent) as {
        originalContentUrl: string;
        previewImageUrl: string;
      };
      return {
        type: 'image',
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    } catch {
      // Fallback: treat as text if parsing fails
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(messageContent);
      // Remove empty text nodes (from {{#if_ref}} conditional blocks)
      cleanEmptyNodes(contents);
      // Extract first text element for altText (shown in notifications)
      return { type: 'flex', altText: altText || extractFlexAltText(contents), contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  /*
   * 位置情報・動画・音声・スタンプ。
   *
   * どれも中身は JSON。読めなければテキストに落とす（既存の image/flex と
   * 同じ扱い）。**送れないものを送ろうとして配信全体を止めない**のが要点。
   * 1通の中身が壊れているだけで、その人の以降の配信まで止まると困る。
   */
  if (messageType === 'location') {
    try {
      const p = JSON.parse(messageContent) as {
        title?: string; address?: string; latitude?: number; longitude?: number;
      };
      if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') {
        return { type: 'text', text: messageContent };
      }
      return {
        type: 'location',
        title: p.title || '場所',
        address: p.address || '',
        latitude: p.latitude,
        longitude: p.longitude,
      };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'video') {
    try {
      const p = JSON.parse(messageContent) as {
        originalContentUrl?: string; previewImageUrl?: string;
      };
      if (!p.originalContentUrl || !p.previewImageUrl) {
        return { type: 'text', text: messageContent };
      }
      return {
        type: 'video',
        originalContentUrl: p.originalContentUrl,
        previewImageUrl: p.previewImageUrl,
      };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'audio') {
    try {
      const p = JSON.parse(messageContent) as { originalContentUrl?: string; duration?: number };
      if (!p.originalContentUrl || typeof p.duration !== 'number' || p.duration <= 0) {
        return { type: 'text', text: messageContent };
      }
      return { type: 'audio', originalContentUrl: p.originalContentUrl, duration: p.duration };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'sticker') {
    try {
      const p = JSON.parse(messageContent) as { packageId?: string; stickerId?: string };
      if (!p.packageId || !p.stickerId) return { type: 'text', text: messageContent };
      return { type: 'sticker', packageId: String(p.packageId), stickerId: String(p.stickerId) };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  /*
   * カルーセル。
   *
   * 中身は columns の配列。LINE では Flex ではなく **template メッセージ**。
   *   { type: 'template', altText, template: { type: 'carousel', columns } }
   * Flex として送ると 400 になり、400 は永続エラー扱いなのでその人の
   * 購読ごと止まる。
   */
  if (messageType === 'carousel') {
    try {
      const columns = JSON.parse(messageContent) as unknown;
      if (!Array.isArray(columns) || columns.length === 0) {
        return { type: 'text', text: messageContent };
      }
      return {
        type: 'template',
        altText: altText || extractCarouselAltText(columns),
        template: { type: 'carousel', columns },
      };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  // Fallback
  return { type: 'text', text: messageContent };
}

/**
 * 通知欄に出る文。1枚目の題か本文を使う。
 *
 * 空のままにすると、通知に何も出ずに「1件のメッセージ」だけになる。
 */
function extractCarouselAltText(columns: unknown[]): string {
  const first = columns[0];
  if (first && typeof first === 'object') {
    const c = first as { title?: unknown; text?: unknown };
    if (typeof c.title === 'string' && c.title.trim()) return c.title.slice(0, 400);
    if (typeof c.text === 'string' && c.text.trim()) return c.text.slice(0, 400);
  }
  return 'カルーセル';
}
