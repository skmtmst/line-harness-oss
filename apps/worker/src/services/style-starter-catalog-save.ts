import { STARTER_CATALOG_KINDS, templateKind, type AccountStyle, type StarterCatalogOption } from '@line-crm/shared';
import { validateCatalogDefinition } from './style-starter-catalog-definition.js';
import { StyleError } from './style-setup-core.js';

export async function listStarterCatalog(db: D1Database, tenant: string): Promise<StarterCatalogOption[]> {
  const rows = (await db.prepare(`SELECT t.id,t.name,t.current_version_id,COALESCE(t.catalog_type,t.delivery_type,t.friend_attribute_type,t.extended_type,t.template_type) type,
    v.id versionId,v.version,v.definition_json FROM hq_templates t JOIN hq_template_versions v ON v.template_id=t.id AND v.tenant_id=t.tenant_id
    WHERE t.tenant_id=? AND t.archived_at IS NULL AND
      (v.id=t.current_version_id OR v.id IN(SELECT json_extract(j.value,'$.versionId') FROM style_starter_sets s,json_each(s.definition_json,'$.selections') j
        WHERE s.tenant_id=t.tenant_id AND s.archived_at IS NULL))
    ORDER BY t.name,v.version DESC`).bind(tenant).all<{ id: string; name: string; type: string; versionId: string; version: number; definition_json: string }>()).results;
  return rows.flatMap(row => {
    const kind = row.type === 'template' && templateKind(JSON.parse(row.definition_json)) === 'coupon' ? 'coupon' : row.type;
    if (!STARTER_CATALOG_KINDS.some(spec => spec.catalogType !== null && spec.kind === kind)) return [];
    return [{ kind: kind as StarterCatalogOption['kind'], templateId: row.id, versionId: row.versionId, version: row.version, name: row.name }];
  });
}

export async function saveCatalogStarter(db: D1Database, tenant: string, actor: string, style: AccountStyle, body: Record<string, unknown>) {
  if (!await db.prepare("SELECT id FROM staff_members WHERE id=? AND tenant_id=? AND is_active=1 AND role IN ('owner','admin') AND account_scope!='accounts' AND access_level!='read_only'")
    .bind(actor,tenant).first()) throw new StyleError('forbidden',403);
  const definition = await validateCatalogDefinition(db, tenant, body.definition);
  const current = await db.prepare('SELECT id,version,definition_json,auto_insert FROM style_starter_sets WHERE tenant_id=? AND style=? AND archived_at IS NULL')
    .bind(tenant, style).first<{ id: string; version: number; definition_json: string; auto_insert: number }>();
  if (body.expectedVersion !== (current?.version ?? 0)) throw new StyleError('version_conflict', 409);
  if ((!current || JSON.parse(current.definition_json).mode !== 'catalog') && body.confirmed !== true) throw new StyleError('catalog_switch_confirmation_required', 422);
  if (body.autoInsert !== undefined && typeof body.autoInsert !== 'boolean') throw new StyleError('invalid_auto_insert');
  const autoInsert = body.autoInsert ?? !!(current?.auto_insert ?? 1);
  const id = current?.id ?? crypto.randomUUID(), now = new Date().toISOString(), version = (current?.version ?? 0) + 1;
  const statements = [db.prepare(`SELECT json(CASE WHEN COALESCE((SELECT version FROM style_starter_sets WHERE tenant_id=? AND style=? AND archived_at IS NULL),0)=?
    AND EXISTS(SELECT 1 FROM staff_members WHERE id=? AND tenant_id=? AND is_active=1 AND role IN ('owner','admin') AND account_scope!='accounts' AND access_level!='read_only')
    THEN '{}' ELSE 'STARTER_VERSION_CONFLICT' END)`).bind(tenant, style, body.expectedVersion, actor, tenant)];
  for (const selection of definition.selections) statements.push(db.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM hq_template_versions v JOIN hq_templates t
    ON t.id=v.template_id AND t.tenant_id=v.tenant_id WHERE v.id=? AND t.id=? AND t.tenant_id=? AND t.archived_at IS NULL)
    THEN '{}' ELSE 'STARTER_VERSION_CONFLICT' END)`).bind(selection.versionId, selection.templateId, tenant));
  if (current) statements.push(
    db.prepare(`INSERT INTO style_starter_sets(id,tenant_id,style,name,definition_json,version,archived_at,updated_at,updated_by,auto_insert)
      SELECT ?,tenant_id,style,name,definition_json,version,?,updated_at,updated_by,auto_insert FROM style_starter_sets WHERE id=? AND tenant_id=? AND version=?`)
      .bind(crypto.randomUUID(), now, current.id, tenant, current.version),
    db.prepare('UPDATE style_starter_sets SET name=?,definition_json=?,version=?,updated_at=?,updated_by=?,auto_insert=? WHERE id=? AND tenant_id=? AND version=?')
      .bind(style, JSON.stringify(definition), version, now, actor, Number(autoInsert), id, tenant, current.version),
  );
  else statements.push(db.prepare('INSERT INTO style_starter_sets(id,tenant_id,style,name,definition_json,version,updated_at,updated_by,auto_insert) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id, tenant, style, style, JSON.stringify(definition), version, now, actor, Number(autoInsert)));
  try { await db.batch(statements); }
  catch (error) { if (String(error).includes('malformed JSON')) throw new StyleError('version_conflict', 409); throw error; }
  return { id, version, autoInsert };
}
