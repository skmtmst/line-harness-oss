import type { HqTemplateAuthority } from './contract.js';
import { boundedText, HqTemplateError } from './tag.js';
import { TEMPLATE_KINDS, type HqTemplateArchiveStatus } from '@line-crm/shared';


export interface TemplateViewFilters {
  kind?: typeof TEMPLATE_KINDS[number];
  messageCount?: 'single' | 'multiple';
  hasInterpolations?: boolean;
  undistributed?: boolean;
  search?: string;
  folderId?: string | null;
}
export function parseTemplateViewFilters(value: unknown): TemplateViewFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HqTemplateError('INVALID_FILTERS',422);
  const input=value as Record<string,unknown>;
  if(Object.keys(input).some(k=>!['kind','messageCount','hasInterpolations','undistributed','search','folderId'].includes(k))) throw new HqTemplateError('INVALID_FILTERS',422);
  if(input.kind!==undefined && !TEMPLATE_KINDS.includes(input.kind as never)
    || input.messageCount!==undefined && (typeof input.messageCount!=='string'||!['single','multiple'].includes(input.messageCount))
    || ['hasInterpolations','undistributed'].some(k=>input[k]!==undefined && typeof input[k]!=='boolean')
    || input.folderId!==undefined && input.folderId!==null && (typeof input.folderId!=='string'||!input.folderId||input.folderId.length>100)
    || input.search!==undefined && (typeof input.search!=='string'||input.search.length>200)) throw new HqTemplateError('INVALID_FILTERS',422);
  return { ...input } as TemplateViewFilters;
}
interface Row {id:string;name:string;owner_staff_id:string;scope:'personal'|'tenant';revision:number;filters_json:string;created_at:string;updated_at:string}
function view({filters_json,...row}:Row){return {...row,filters:JSON.parse(filters_json) as TemplateViewFilters};}
const visible="tenant_id=? AND archived_at IS NULL AND (scope='tenant' OR owner_staff_id=?)";
export async function listTemplateViews(db:D1Database,auth:HqTemplateAuthority){
  const rows=await db.prepare(`SELECT * FROM hq_template_saved_views WHERE ${visible} ORDER BY name,id`).bind(auth.tenantId,auth.actorId).all<Row>();
  return rows.results.map(view);
}
export async function saveTemplateView(db:D1Database,auth:HqTemplateAuthority,input:Record<string,unknown>,id?:string){
  const name=boundedText(input.name,100,'name'),filters=parseTemplateViewFilters(input.filters);
  // Shared searches are editable by HQ administrators; private searches only by their owner.
  const current=id?await db.prepare(`SELECT * FROM hq_template_saved_views WHERE id=? AND ${visible}`).bind(id,auth.tenantId,auth.actorId).first<Row>():null;
  if(id&&!current)throw new HqTemplateError('NOT_FOUND',404);
  const scope=input.scope??current?.scope??'personal';
  if(scope!=='personal'&&scope!=='tenant')throw new HqTemplateError('INVALID_SCOPE',422);
  if(id&&(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==current!.revision))throw new HqTemplateError('VERSION_CONFLICT',409);
  if(filters.folderId && !await db.prepare('SELECT id FROM hq_template_folders WHERE id=? AND tenant_id=? AND archived_at IS NULL').bind(filters.folderId,auth.tenantId).first())throw new HqTemplateError('INVALID_FOLDER',422);
  if(current&&current.owner_staff_id!==auth.actorId&&scope==='personal')throw new HqTemplateError('FORBIDDEN',403);
  const key=id??crypto.randomUUID(),now=new Date().toISOString();
  const statements:D1PreparedStatement[]=[];
  if(id)statements.push(db.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM hq_template_saved_views WHERE id=? AND revision=? AND ${visible}) THEN '{}' ELSE 'VERSION_CONFLICT' END)`).bind(id,input.expectedRevision,auth.tenantId,auth.actorId));
  statements.push(id?db.prepare('UPDATE hq_template_saved_views SET name=?,filters_json=?,scope=?,revision=revision+1,updated_at=? WHERE id=? AND tenant_id=?').bind(name,JSON.stringify(filters),scope,now,key,auth.tenantId)
    :db.prepare('INSERT INTO hq_template_saved_views(id,tenant_id,owner_staff_id,name,filters_json,scope,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(key,auth.tenantId,auth.actorId,name,JSON.stringify(filters),scope,now,now));
  statements.push(audit(db,auth,key,id?'updated':'created'));
  try{await db.batch(statements);}catch(error){if(String(error).includes('malformed JSON'))throw new HqTemplateError('VERSION_CONFLICT',409);throw error;}
  return (await listTemplateViews(db,auth)).find(row=>row.id===key)!;
}
function audit(db:D1Database,auth:HqTemplateAuthority,id:string,action:string){
  return db.prepare("INSERT INTO audit_events(id,tenant_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result) VALUES(?,?,'business',?,?,?,'hq_template_saved_view',?,'success')").bind(crypto.randomUUID(),auth.tenantId,auth.actorId,auth.role,`hq_template_view.${action}`,id);
}
export async function archiveTemplateView(db:D1Database,auth:HqTemplateAuthority,id:string,revision:unknown){
  if(!(await listTemplateViews(db,auth)).some(row=>row.id===id))throw new HqTemplateError('NOT_FOUND',404);
  if(!Number.isSafeInteger(revision)||Number(revision)<1)throw new HqTemplateError('INVALID_REVISION',422);
  try{await db.batch([
    db.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM hq_template_saved_views WHERE id=? AND revision=? AND ${visible}) THEN '{}' ELSE 'VERSION_CONFLICT' END)`).bind(id,revision,auth.tenantId,auth.actorId),
    db.prepare('UPDATE hq_template_saved_views SET archived_at=?,updated_at=?,revision=revision+1 WHERE id=? AND tenant_id=?').bind(new Date().toISOString(),new Date().toISOString(),id,auth.tenantId),audit(db,auth,id,'archived'),
  ]);}catch(error){if(String(error).includes('malformed JSON'))throw new HqTemplateError('VERSION_CONFLICT',409);throw error;}
  return {id,archived:true};
}

/** Search only message content fields, never filenames/media URLs. Values remain server-side. */
export async function messageTemplateSearchIds(db:D1Database,auth:HqTemplateAuthority,search:string,status:HqTemplateArchiveStatus='active'){
 if(search.length>200)throw new HqTemplateError('INVALID_LIST_FILTER',422);
 const result=await db.prepare(`SELECT t.id FROM hq_templates t JOIN hq_template_versions v
   ON v.id=t.current_version_id AND v.tenant_id=t.tenant_id AND v.template_id=t.id
   WHERE t.tenant_id=? AND (?='all' OR (?='active' AND t.archived_at IS NULL) OR (?='archived' AND t.archived_at IS NOT NULL)) AND t.template_type='template'
   AND (instr(lower(t.name),lower(?))>0 OR EXISTS(
     SELECT 1 FROM json_tree(v.definition_json) j WHERE j.type='text'
     AND (j.fullkey LIKE '$.template.%' OR j.fullkey LIKE '$.card.%' OR j.fullkey LIKE '$.asset.payload.%')
     AND j.key NOT IN ('id','name','category') AND instr(lower(CAST(j.value AS TEXT)),lower(?))>0))`)
   .bind(auth.tenantId,status,status,status,search,search).all<{id:string}>();
 return new Set(result.results.map(row=>row.id));
}
