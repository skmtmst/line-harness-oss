import { parseBroadcastMessageParts } from '../../features/broadcasts/broadcast-message-set/index.js';
import { listInterpolations, type HqTemplateListDisplay } from '@line-crm/shared';

import { parseMessageTemplateDefinition } from './template.js';

type MessageFacts = Pick<HqTemplateListDisplay, 'message_count' | 'has_interpolations'>;

/** A carousel/card is one LINE message. Media dependencies are not extra messages. */
export function messageListFacts(definitionJson: string | null): MessageFacts {
  if (!definitionJson) return { message_count: null, has_interpolations: null };
  try {
    const raw = JSON.parse(definitionJson);
    // Do not silently label an unsupported future bundle as a single message.
    if ('messages' in raw || 'bubbles' in raw) throw new Error('UNSUPPORTED_BUNDLE');
    const definition = parseMessageTemplateDefinition(raw);
    const content = [
      definition.messageBubbles ? parseBroadcastMessageParts({messageType:'text',messageContent:'',messageBubbles:definition.messageBubbles}).map(p=>p.messageContent).join('\n') : null,
      definition.template.messageContent, definition.template.carouselActionsJson,
      definition.template.carouselTapLimitText, definition.template.questionJson,
      definition.card ? JSON.stringify(definition.card) : null,
      definition.asset ? JSON.stringify(definition.asset.payload) : null,
    ].filter((part): part is string => typeof part === 'string').join('\n');
    return { message_count: definition.messageBubbles ? parseBroadcastMessageParts({messageType:'text',messageContent:'',messageBubbles:definition.messageBubbles}).length : 1, has_interpolations: listInterpolations(content).length > 0 };
  } catch {
    return { message_count: null, has_interpolations: null };
  }
}
