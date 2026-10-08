import { FRIEND_FIELD_TYPES, validateFieldKey, validateFriendFieldValue } from '@line-crm/db';
import type { HqFriendFieldDefinition, HqMarkDefinition } from '@line-crm/shared';
import { boundedText, HqTemplateError } from './tag.js';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HqTemplateError('INVALID_DEFINITION');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new HqTemplateError('INVALID_DEFINITION');
}
function bool(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new HqTemplateError('INVALID_DEFINITION');
  return value;
}
function order(value: unknown, fallback = 0): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100000) throw new HqTemplateError('INVALID_DEFINITION');
  return Number(value);
}
function color(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new HqTemplateError('INVALID_DEFINITION');
  return value;
}
export function parseFriendFieldDefinition(value: unknown): HqFriendFieldDefinition {
  const root = object(value), field = object(root.field);
  keys(root, ['schemaVersion', 'field', 'folders']);
  keys(field, ['name','fieldKey','type','options','defaultValue','source','ecFieldPath','ecIsMaster','isPersonal','isStarred','displayOrder','folderId']);
  if (root.schemaVersion !== 1 || !Array.isArray(root.folders) || root.folders.length > 8 || !validateFieldKey(field.fieldKey).ok || !FRIEND_FIELD_TYPES.includes(field.type as never)) throw new HqTemplateError('INVALID_DEFINITION');
  const type = field.type as HqFriendFieldDefinition['field']['type'];
  if (field.options != null && (!Array.isArray(field.options) || field.options.length > 200)) throw new HqTemplateError('INVALID_DEFINITION');
  const options = ((field.options ?? []) as unknown[]).map((v, i) => {
    const option = typeof v === 'string' ? {label: v} : object(v);
    keys(option, ['id','label','color','status','displayOrder']);
    if (option.status !== undefined && !['active','archived'].includes(String(option.status))) throw new HqTemplateError('INVALID_DEFINITION');
    return {id: option.id === undefined ? `option_${i + 1}` : boundedText(option.id,80), label: boundedText(option.label,100), color: color(option.color), status: (option.status ?? 'active') as 'active'|'archived', displayOrder: order(option.displayOrder,i)};
  });
  if (new Set(options.map(o=>o.id)).size !== options.length || new Set(options.map(o=>o.label)).size !== options.length || (options.length && type !== 'select' && type !== 'multi_select')) throw new HqTemplateError('INVALID_DEFINITION');
  let defaultValue: string | null = null;
  if (field.defaultValue != null && field.defaultValue !== '') {
    if (type === 'image' || type === 'pdf') throw new HqTemplateError('INVALID_DEFINITION');
    const checked = validateFriendFieldValue({type,options_json:JSON.stringify(options)},field.defaultValue);
    if (!checked.ok) throw new HqTemplateError('INVALID_DEFINITION');
    defaultValue = checked.value;
  }
  const source = field.source ?? 'manual';
  if (!['manual','form','ec','automation'].includes(String(source))) throw new HqTemplateError('INVALID_DEFINITION');
  const folders = root.folders.map(v => {
    const f = object(v); keys(f, ['id','name','parentId','color']);
    return {id: boundedText(f.id,80),name: boundedText(f.name),parentId: f.parentId == null ? null : boundedText(f.parentId,80),color:color(f.color)};
  });
  const folderId = field.folderId == null ? null : boundedText(field.folderId,80);
  const ordered: typeof folders = [];
  if (new Set(folders.map(f=>f.id)).size !== folders.length) throw new HqTemplateError('INVALID_DEFINITION');
  for (let id = folderId; id !== null;) {
    const f = folders.find(f=>f.id===id);
    if (!f || ordered.some(o=>o.id===id)) throw new HqTemplateError('INVALID_DEFINITION');
    ordered.unshift(f); id=f.parentId;
  }
  if (ordered.length !== folders.length) throw new HqTemplateError('INVALID_DEFINITION');
  return {schemaVersion:1,field:{name:boundedText(field.name),fieldKey:field.fieldKey as string,type,options,defaultValue,
    source:source as HqFriendFieldDefinition['field']['source'],ecFieldPath:field.ecFieldPath == null ? null : boundedText(field.ecFieldPath,200),ecIsMaster:bool(field.ecIsMaster),isPersonal:bool(field.isPersonal),isStarred:bool(field.isStarred),displayOrder:order(field.displayOrder),folderId},folders:ordered};
}
export function parseMarkDefinition(value: unknown): HqMarkDefinition {
  const root=object(value),mark=object(root.mark);
  keys(root,['schemaVersion','mark']);keys(mark,['name','color','isDefault','autoOnInbound','displayOrder']);
  if(root.schemaVersion!==1) throw new HqTemplateError('INVALID_DEFINITION');
  return {schemaVersion:1,mark:{name:boundedText(mark.name),color:color(mark.color)??'#3B82F6',isDefault:bool(mark.isDefault),autoOnInbound:bool(mark.autoOnInbound),displayOrder:order(mark.displayOrder)}};
}
