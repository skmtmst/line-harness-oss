import { boundedText, HqTemplateError } from './tag.js';
import { parseMessageTemplateDefinition } from './template.js';

export function withTextOverride(definitionJson: string, text: string | null | undefined): string {
  if (text==null) return definitionJson;
  const definition=parseMessageTemplateDefinition(JSON.parse(definitionJson));
  if (definition.template.messageType!=='text') throw new HqTemplateError('INVALID_TEXT_OVERRIDE',422);
  return JSON.stringify(parseMessageTemplateDefinition({...definition,template:{...definition.template,messageContent:boundedText(text,5000)}}));
}
export function parseTextOverrides(value: unknown, accountIds: string[], type: string): Map<string,string> {
  if(value===undefined) return new Map();
  if(type!=='template' || !Array.isArray(value) || value.length>accountIds.length) throw new HqTemplateError('INVALID_TEXT_OVERRIDE',422);
  const rows=value.map(item=>{
    if(!item || typeof item!=='object' || Array.isArray(item) || Object.keys(item).some(k=>!['accountId','text'].includes(k)) || !accountIds.includes(item.accountId)) throw new HqTemplateError('INVALID_TEXT_OVERRIDE',422);
    if(typeof item.text!=='string' || !item.text.trim() || item.text.length>5000) throw new HqTemplateError('INVALID_TEXT_OVERRIDE',422);
    return [item.accountId,boundedText(item.text,5000)] as [string,string];
  });
  if(new Set(rows.map(r=>r[0])).size!==rows.length) throw new HqTemplateError('INVALID_TEXT_OVERRIDE',422);
  return new Map(rows);
}
