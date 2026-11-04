import type { HqCatalogTemplateType } from '@line-crm/shared';
import type { HqTemplateStatement } from '@line-crm/db';
import { catalogSnapshot, catalogSnapshotGuard, inspectCatalog, parseCatalogDefinition, planCatalog } from './catalog.js';
import { digest } from './distribution.js';
import { HqTemplateError } from './tag.js';

type Decision = { id:string; tenant_id:string; line_account_id:string; template_id:string; template_version_id:string; decision:'pending'|'adopted'|'kept'; menu_id:string|null; reward_id:string|null; definition_json:string; name:string; version:number };
const column = (type:HqCatalogTemplateType) => type==='booking_menu' ? 'menu_id' : 'reward_id';

async function rows(db:D1Database,accountId:string,type:HqCatalogTemplateType,targetId:string):Promise<Decision[]> {
  return (await db.prepare(`SELECT d.*,v.definition_json,v.version,t.name FROM hq_catalog_update_decisions d
    JOIN hq_templates t ON t.id=d.template_id AND t.tenant_id=d.tenant_id AND t.archived_at IS NULL
    JOIN hq_template_versions v ON v.id=d.template_version_id AND v.template_id=d.template_id AND v.tenant_id=d.tenant_id
    JOIN line_accounts a ON a.id=d.line_account_id AND a.tenant_id=d.tenant_id
    WHERE d.line_account_id=? AND d.${column(type)}=? AND EXISTS(SELECT 1 FROM ${type==='booking_menu'?'menus':'mileage_rewards'} item WHERE item.id=d.${column(type)} AND item.line_account_id=d.line_account_id AND item.hq_template_id=d.template_id)
    ORDER BY v.version DESC,d.id DESC`).bind(accountId,targetId).all<Decision>()).results;
}

export async function pendingCatalogDecision(db:D1Database,accountId:string,type:HqCatalogTemplateType,targetId:string) {
  const latest=(await rows(db,accountId,type,targetId))[0];
  if(!latest||latest.decision!=='pending')return null;
  const snapshot=await catalogSnapshot(db,accountId,type);
  return {id:latest.id,templateId:latest.template_id,templateVersionId:latest.template_version_id,version:latest.version,name:latest.name,definition:parseCatalogDefinition(type,JSON.parse(latest.definition_json)),snapshot:await digest(snapshot)};
}

export async function decideCatalogUpdate(db:D1Database,input:{accountId:string;type:HqCatalogTemplateType;targetId:string;decisionId:string;action:'adopt'|'keep';snapshot:string;actorId:string;actorRole:string;allowPublished:boolean}) {
  const latest=(await rows(db,input.accountId,input.type,input.targetId))[0];
  if(!latest||latest.id!==input.decisionId)throw new HqTemplateError('VERSION_CONFLICT',409);
  const wanted=input.action==='adopt'?'adopted':'kept';
  if(latest.decision===wanted)return {decision:wanted};
  if(latest.decision!=='pending')throw new HqTemplateError('VERSION_CONFLICT',409);
  const snapshot=await catalogSnapshot(db,input.accountId,input.type);
  if(await digest(snapshot)!==input.snapshot)throw new HqTemplateError('VERSION_CONFLICT',409);
  const guard:HqTemplateStatement={sql:`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM hq_catalog_update_decisions d JOIN hq_template_versions v ON v.id=d.template_version_id AND v.template_id=d.template_id AND v.tenant_id=d.tenant_id WHERE d.id=? AND d.line_account_id=? AND d.${column(input.type)}=? AND d.decision='pending' AND NOT EXISTS(SELECT 1 FROM hq_catalog_update_decisions newer JOIN hq_template_versions nv ON nv.id=newer.template_version_id AND nv.template_id=newer.template_id AND nv.tenant_id=newer.tenant_id WHERE newer.line_account_id=d.line_account_id AND newer.${column(input.type)}=d.${column(input.type)} AND nv.version>v.version)) THEN '{}' ELSE 'VERSION_CONFLICT' END)`,bindings:[latest.id,input.accountId,input.targetId]};
  let changes:HqTemplateStatement[]=[];
  if(input.action==='adopt'){
    const parsed=JSON.parse(snapshot) as {targets:Array<{id:string;status?:string}>};
    if(!input.allowPublished&&input.type==='mileage_reward'&&parsed.targets.some(row=>row.id===input.targetId&&row.status==='published'))throw new HqTemplateError('FORBIDDEN',403);
    const definition=parseCatalogDefinition(input.type,JSON.parse(latest.definition_json));
    const refs=inspectCatalog(definition,snapshot,input.type,latest.template_id);
    if(refs[0].targetId!==input.targetId)throw new HqTemplateError('VERSION_CONFLICT',409);
    const selections=refs.map(ref=>({sourceId:ref.sourceId,itemKind:ref.itemKind,mode:'overwrite' as const}));
    changes=planCatalog(input.accountId,definition,snapshot,input.type,selections,{templateId:latest.template_id,versionId:latest.template_version_id},true,true).statements;
  } else {
    // 維持でも、確認した時点から店の品が変わっていれば判断をやり直す。
    changes=[catalogSnapshotGuard(input.accountId,input.type,snapshot)];
  }
  const finish:HqTemplateStatement={sql:"UPDATE hq_catalog_update_decisions SET decision=?,decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND decision='pending'",bindings:[wanted,latest.id]};
  const audit:HqTemplateStatement={sql:"INSERT INTO audit_events(id,tenant_id,line_account_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES (?,?,?,'business',?,?,?,'hq_template',?,'success',?)",bindings:[crypto.randomUUID(),latest.tenant_id,input.accountId,input.actorId,input.actorRole,`hq_template.${wanted}`,latest.template_id,JSON.stringify({decisionId:latest.id,templateVersionId:latest.template_version_id})]};
  try { await db.batch([guard,...changes,finish,audit].map(s=>db.prepare(s.sql).bind(...s.bindings))); }
  catch { throw new HqTemplateError('VERSION_CONFLICT',409); }
  return {decision:wanted};
}
