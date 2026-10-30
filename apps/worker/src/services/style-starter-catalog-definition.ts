import { STARTER_CATALOG_KINDS, templateKind, type StarterCatalogDefinition, type StarterCatalogSelection } from '@line-crm/shared';
import { StyleError } from './style-setup-core.js';

export function readCatalogDefinition(value: unknown): StarterCatalogDefinition {
  const d = value as StarterCatalogDefinition;
  if (!d || d.mode !== 'catalog' || !Array.isArray(d.items) || d.items.length || !Array.isArray(d.selections) || d.selections.length > 100
    || Object.keys(d).some(key => !['mode', 'items', 'selections'].includes(key))) throw new StyleError('invalid_starter_set');
  if(d.selections.some(item=>!item||typeof item!=='object'||Array.isArray(item)))throw new StyleError('invalid_starter_set');
  const seen = new Set<string>();
  for (const selection of d.selections) {
    const spec = STARTER_CATALOG_KINDS.find(row => row.kind === selection?.kind);
    if (!spec?.catalogType || !selection || Object.keys(selection).some(key => !['kind', 'templateId', 'versionId'].includes(key))
      || typeof selection.templateId !== 'string' || !selection.templateId || selection.templateId.length > 128
      || typeof selection.versionId !== 'string' || !selection.versionId || selection.versionId.length > 128 || seen.has(selection.templateId)
      || (!spec.multiple && d.selections.filter(row => row.kind === spec.kind).length > 1)) throw new StyleError('invalid_starter_set');
    seen.add(selection.templateId);
  }
  return d;
}

/** 不変の版が同じ統括のカタログに属することを、保存時と実行時の両方で確認する。 */
export async function catalogSelection(db: D1Database, tenant: string, selection: StarterCatalogSelection) {
  const row = await db.prepare(`SELECT t.id,t.name,COALESCE(t.catalog_type,t.delivery_type,t.friend_attribute_type,t.extended_type,t.template_type) type,
    v.id versionId,v.version,v.definition_json FROM hq_templates t JOIN hq_template_versions v ON v.template_id=t.id AND v.tenant_id=t.tenant_id
    WHERE t.tenant_id=? AND t.id=? AND v.id=? AND t.archived_at IS NULL`)
    .bind(tenant, selection.templateId, selection.versionId).first<{ id: string; name: string; type: string; versionId: string; version: number; definition_json: string }>();
  const spec = STARTER_CATALOG_KINDS.find(item => item.kind === selection.kind);
  if (!row || row.type !== spec?.catalogType) throw new StyleError('catalog_version_unavailable', 409);
  if (row.type === 'template') {
    const kind = templateKind(JSON.parse(row.definition_json));
    if ((selection.kind === 'coupon') !== (kind === 'coupon')) throw new StyleError('invalid_catalog_kind');
  }
  return row;
}

export async function validateCatalogDefinition(db: D1Database, tenant: string, value: unknown) {
  const definition = readCatalogDefinition(value);
  for (const selection of definition.selections) await catalogSelection(db, tenant, selection);
  return definition;
}
