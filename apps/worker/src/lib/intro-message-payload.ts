import type { Message } from '@line-crm/line-sdk';
import type { IntroMessage } from '../services/intro-message.js';

/** SDK のメッセージ型と決め付けず、送信境界で解析済みテンプレート JSON を絞り込む。 */
export function introMessagePayload(message: IntroMessage): Message {
  if (message.type === 'text') return message;
  const contents = message.contents;
  if (contents === null || typeof contents !== 'object' || Array.isArray(contents)) {
    throw new Error('Invalid intro message contents');
  }
  return { ...message, contents };
}
