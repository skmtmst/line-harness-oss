import { isCatalogType, parseCatalogDefinition } from './catalog.js';
import { isDeliveryType, parseDeliveryDefinition } from './delivery.js';
import { parseFriendFieldDefinition, parseMarkDefinition } from './friend-attributes.js';
import { parseScenarioDefinition } from './scenario.js';
import { type HqTemplateType } from '@line-crm/db';
import { type HqTemplateAuthority } from './contract.js';
import { HqTemplateError, parseTagDefinition } from './tag.js';
import { parseMessageTemplateDefinition } from './template.js';
import { parseFormTemplateDefinition } from './form.js';
import { parseRichMenuTemplateDefinition } from './rich-menu.js';

export async function canonicalDefinition(db:D1Database,type: HqTemplateType, value: unknown, authority: HqTemplateAuthority): Promise<unknown> {
  if(isCatalogType(type)) return parseCatalogDefinition(type,value);
  if(isDeliveryType(type)) return parseDeliveryDefinition(db,type,value);
  try {
    if (type === 'scenario') return parseScenarioDefinition(value);
    if (type === 'tag') return parseTagDefinition(value);
    if (type === 'friend_field') return parseFriendFieldDefinition(value);
    if (type === 'mark') return parseMarkDefinition(value);
    if (type === 'template') return parseMessageTemplateDefinition(value);
    const input = { templateVersionId: 'validation', definitionJson: JSON.stringify(value) };
    if (type === 'rich_menu') return parseRichMenuTemplateDefinition(input, authority.tenantId);
    return parseFormTemplateDefinition(input);
  } catch (error) {
    if (error instanceof HqTemplateError) throw error;
    throw new HqTemplateError('INVALID_DEFINITION');
  }
}
