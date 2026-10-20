import type { Message } from '@line-crm/line-sdk';
import type { IntroMessage } from '../services/intro-message.js';

/** Narrow parsed template JSON at the sending boundary, without asserting it is an SDK message. */
export function introMessagePayload(message: IntroMessage): Message {
  if (message.type === 'text') return message;
  const contents = message.contents;
  if (contents === null || typeof contents !== 'object' || Array.isArray(contents)) {
    throw new Error('Invalid intro message contents');
  }
  return { ...message, contents };
}
