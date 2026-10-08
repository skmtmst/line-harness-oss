import { beginHqTemplateDistributionRun, normalizeScopedTagName, type HqTemplatePreflight, type HqTemplateStatement } from '@line-crm/db';
import type { HqFriendAttributeType, HqFriendAttributeMode, HqFriendFieldDefinition, HqMarkDefinition } from '@line-crm/shared';
import type { HqTemplateAuthority } from './contract.js';
import { digest, requireTargetAccounts, templateDetail } from './distribution.js';
import { parseFriendFieldDefinition, parseMarkDefinition } from './friend-attributes.js';
import { HqTemplateError, nextAlias } from './tag.js';
import { targetDistributionVersion } from './distribution-display.js';
const LEGACY_TENANT='00000000-0000-4000-8000-000000000001';
export const isFriendAttributeType=(type:string):type is HqFriendAttributeType=>type==='friend_field'||type==='mark';
type Selection={accountId:string;sourceId:string;mode:HqFriendAttributeMode};
type Item={sourceId:string;itemKind:string;name:string;targetId:string|null;expectedRevision:string|null;duplicate:boolean;allowedModes:HqFriendAttributeMode[];reason?:string|null};
type ScopedRow=Record<string,any> & {id:string;name:string;line_account_id:string|null};
type State={fields:ScopedRow[];marks:ScopedRow[];folders:ScopedRow[];keys:{field_key:string}[]};
// Include complete definitions and global key occupancy, never customer values.
// The identical projection is fenced inside the atomic write batch.
const SNAPSHOT_SQL=`SELECT json_object(
 'fields',json((SELECT json_group_array(json_object('row',json(j))) FROM (
  SELECT json_object('id',f.id,'name',f.name,'field_key',f.field_key,'type',COALESCE(f.type_v8,f.type_v6,f.type),'options_json',f.options_json,'default_value',f.default_value,'source',f.source,'ec_field_path',f.ec_field_path,'ec_is_master',f.ec_is_master,'is_personal',f.is_personal,'is_starred',f.is_starred,'display_order',f.display_order,'folder_id',f.folder_id,'status',f.status,'version',f.version,'updated_at',f.updated_at,'line_account_id',s.line_account_id) j
  FROM friend_fields f LEFT JOIN friend_field_scopes s ON s.field_id=f.id
  WHERE COALESCE(s.tenant_id,'${LEGACY_TENANT}')=?1 AND (s.line_account_id=?2 OR s.line_account_id IS NULL) ORDER BY f.id))),
 'marks',json((SELECT json_group_array(json_object('row',json(j))) FROM (
  SELECT json_object('id',m.id,'name',m.name,'color',m.color,'is_default',m.is_default,'auto_on_inbound',m.auto_on_inbound,'display_order',m.display_order,'archived_at',m.archived_at,'version',m.version,'updated_at',m.updated_at,'line_account_id',s.line_account_id) j
  FROM support_marks m LEFT JOIN support_mark_scopes s ON s.mark_id=m.id
  WHERE COALESCE(s.tenant_id,'${LEGACY_TENANT}')=?1 AND (s.line_account_id=?2 OR s.line_account_id IS NULL) ORDER BY m.id))),
 'folders',json((SELECT json_group_array(json_object('row',json(j))) FROM (
  SELECT json_object('id',id,'name',name,'parent_id',parent_id,'color',color,'updated_at',updated_at,'line_account_id',account_id) j FROM folders WHERE kind='friend_field' AND account_id=?2 ORDER BY id))),
 'keys',json((SELECT json_group_array(json_object('field_key',field_key)) FROM (SELECT field_key FROM friend_fields ORDER BY field_key)))
) snapshot`;
async function snapshot(db:D1Database,auth:HqTemplateAuthority,accountId:string){
 const row=await db.prepare(SNAPSHOT_SQL).bind(auth.tenantId,accountId).first<{snapshot:string}>();
 if(!row)throw new HqTemplateError('SNAPSHOT_UNAVAILABLE',500);return row.snapshot;
}
function state(value:string):State{
 const raw=JSON.parse(value);return {fields:raw.fields.map((v:any)=>v.row),marks:raw.marks.map((v:any)=>v.row),folders:raw.folders.map((v:any)=>v.row),keys:raw.keys};
}
function inspect(type:HqFriendAttributeType,definition:HqFriendFieldDefinition|HqMarkDefinition,value:string):Item[]{
 const s=state(value),items:Item[]=[];
 if(type==='friend_field'){
  const def=definition as HqFriendFieldDefinition,parents=new Map<string,string|null>();
  for(const f of def.folders){
   const parent=f.parentId?parents.get(f.parentId):null;
   const matches=f.parentId&&!parent?[]:s.folders.filter(row=>row.parent_id===parent&&normalizeScopedTagName(row.name)===normalizeScopedTagName(f.name));
   if(matches.length>1)throw new HqTemplateError('AMBIGUOUS_FOLDER',409);const row=matches[0];parents.set(f.id,row?.id??null);
   items.push({sourceId:`folder:${f.id}`,itemKind:'folder',name:f.name,targetId:row?.id??null,expectedRevision:row?.updated_at??null,duplicate:!!row,allowedModes:row?['overwrite','alias']:['create']});
  }
  const matches=s.fields.filter(row=>row.field_key===def.field.fieldKey||normalizeScopedTagName(row.name)===normalizeScopedTagName(def.field.name));
  if(matches.length>1)throw new HqTemplateError('AMBIGUOUS_FIELD',409);const row=matches[0];
  const keyOccupied=s.keys.some(k=>k.field_key===def.field.fieldKey);
  const writable=row&&row.line_account_id!==null&&row.status==='active'&&!row.ec_is_master&&row.type===def.field.type&&row.field_key===def.field.fieldKey;
  items.push({sourceId:'friend_field',itemKind:'friend_field',name:def.field.name,targetId:row?.id??null,expectedRevision:row?`${row.updated_at}:${row.version}`:null,duplicate:!!row||keyOccupied,
   allowedModes:row?[...(writable?['overwrite' as const]:[]),'alias','skip']:keyOccupied?['alias']:['create'],reason:!row&&keyOccupied?'FIELD_KEY_IN_USE':row&&!writable?'FIELD_REQUIRES_ALIAS':null});
 }else{
  const def=definition as HqMarkDefinition,matches=s.marks.filter(row=>normalizeScopedTagName(row.name)===normalizeScopedTagName(def.mark.name));
  if(matches.length>1)throw new HqTemplateError('AMBIGUOUS_MARK',409);const row=matches[0];
  items.push({sourceId:'mark',itemKind:'mark',name:def.mark.name,targetId:row?.id??null,expectedRevision:row?`${row.updated_at}:${row.version}`:null,duplicate:!!row,allowedModes:row?[...(row.line_account_id!==null&&!row.archived_at?['overwrite' as const]:[]),'alias','skip']:['create']});
 }
 return items;
}
function definitionFor(type:HqFriendAttributeType,value:unknown){return type==='friend_field'?parseFriendFieldDefinition(value):parseMarkDefinition(value)}
export async function preflightFriendAttribute(db:D1Database,auth:HqTemplateAuthority,id:string,accountIds:string[]){
 const accounts=await requireTargetAccounts(db,auth,accountIds),{template,definition}=await templateDetail(db,auth,id);
 if(!isFriendAttributeType(template.template_type))throw new HqTemplateError('INVALID_TYPE');
 const type=template.template_type,def=definitionFor(type,definition),version=await db.prepare('SELECT version FROM hq_template_versions WHERE id=? AND tenant_id=? AND template_id=?').bind(template.current_version_id,auth.tenantId,id).first<{version:number}>();
 if(!version)throw new HqTemplateError('VERSION_UNAVAILABLE',409);
 const preflightId=crypto.randomUUID(),expiresAt=new Date(Date.now()+15*60000).toISOString(),statements:D1PreparedStatement[]=[],stores=[];
 for(const a of accounts){
  const value=await snapshot(db,auth,a.id),token=`hqts1.${await digest(value)}`,storeId=crypto.randomUUID(),items=inspect(type,def,value);
  statements.push(db.prepare("INSERT INTO hq_template_preflights(id,tenant_id,template_id,template_version_id,target_account_id,distribution_mode,idempotency_fingerprint,snapshot_token,status,created_by,expires_at) VALUES(?,?,?,?,?,'create',?,?,'ready',?,?)").bind(storeId,auth.tenantId,id,template.current_version_id,a.id,preflightId,token,auth.actorId,expiresAt));
  for(const item of items)statements.push(db.prepare("INSERT INTO hq_template_preflight_resolutions(preflight_id,tenant_id,template_id,template_version_id,target_account_id,idempotency_fingerprint,snapshot_token,source_id,item_kind,resolution_mode,target_id,expected_revision) VALUES(?,?,?,?,?,?,?,?,?,'create',?,?)").bind(storeId,auth.tenantId,id,template.current_version_id,a.id,preflightId,token,item.sourceId,item.itemKind,item.targetId,item.expectedRevision));
  stores.push({accountId:a.id,accountName:a.name,items,targetVersion:await targetDistributionVersion(db,auth.tenantId,id,a.id,version.version)});
 }
 await db.batch(statements);return {preflightId,expiresAt,stores};
}
const stmt=(sql:string,bindings:HqTemplateStatement['bindings']):HqTemplateStatement=>({sql,bindings});
function plan(type:HqFriendAttributeType,definition:HqFriendFieldDefinition|HqMarkDefinition,value:string,auth:HqTemplateAuthority,accountId:string,selections:Selection[]){
 const s=state(value),items=inspect(type,definition,value),root=items.find(i=>i.itemKind===type)!,rootMode=selections.find(r=>r.sourceId===root.sourceId)!.mode;
 const statements:HqTemplateStatement[]=[stmt(`SELECT json(CASE WHEN (${SNAPSHOT_SQL})=?3 THEN '{}' ELSE 'VERSION_CONFLICT' END)`,[auth.tenantId,accountId,value])];
 const resolved:{item:Item;mode:HqFriendAttributeMode;targetId:string|null;aliasName:string|null}[]=[],ids=new Map<string,string>(),now=new Date().toISOString();
 for(const item of items){
  const mode=selections.find(r=>r.sourceId===item.sourceId)!.mode;
  if(!item.allowedModes.includes(mode))throw new HqTemplateError('SELECTION_REQUIRED',409);
  const id=mode==='overwrite'||mode==='skip'?item.targetId!:crypto.randomUUID();ids.set(item.sourceId,id);
  const def=definition as HqFriendFieldDefinition,f=type==='friend_field'?def.folders.find(f=>item.sourceId===`folder:${f.id}`):undefined,parent=f?.parentId?ids.get(`folder:${f.parentId}`)??null:null;
  if(f&&mode==='overwrite'&&s.folders.find(r=>r.id===id)?.parent_id!==parent)throw new HqTemplateError('FOLDER_SELECTION_CONFLICT',409);
  const name=mode==='alias'?nextAlias(item.name,f?s.folders.filter(r=>r.parent_id===parent).map(r=>r.name):type==='mark'?s.marks.map(r=>r.name):s.fields.map(r=>r.name)):item.name;
  resolved.push({item,mode,targetId:id,aliasName:mode==='alias'?name:null});
  if(rootMode==='skip')continue;
  if(f){
   if(mode==='overwrite')statements.push(stmt("UPDATE folders SET name=?,color=?,updated_at=? WHERE id=? AND account_id=? AND kind='friend_field'",[name,f.color??null,now,id,accountId]));
   else statements.push(stmt("INSERT INTO folders(id,kind,name,parent_id,color,account_id,created_at,updated_at) VALUES(?,'friend_field',?,?,?,?,?,?)",[id,name,parent,f.color??null,accountId,now,now]));
  }else if(type==='mark'){
   const m=(definition as HqMarkDefinition).mark;
   if(m.isDefault)statements.push(stmt('UPDATE support_marks SET is_default=0,version=version+1,updated_at=?,updated_by=? WHERE id<>? AND id IN (SELECT mark_id FROM support_mark_scopes WHERE tenant_id=? AND line_account_id=?) AND is_default=1',[now,auth.actorId,id,auth.tenantId,accountId]));
   if(mode==='overwrite')statements.push(stmt('UPDATE support_marks SET name=?,color=?,is_default=?,auto_on_inbound=?,display_order=?,version=version+1,updated_at=?,updated_by=? WHERE id=?',[name,m.color!,m.isDefault?1:0,m.autoOnInbound?1:0,m.displayOrder??0,now,auth.actorId,id]));
   else statements.push(stmt('INSERT INTO support_marks(id,name,color,is_default,auto_on_inbound,display_order,created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,name,m.color!,m.isDefault?1:0,m.autoOnInbound?1:0,m.displayOrder??0,now,now,auth.actorId,auth.actorId]),stmt('INSERT INTO support_mark_scopes(mark_id,tenant_id,line_account_id,created_at) VALUES(?,?,?,?)',[id,auth.tenantId,accountId,now]));
  }else{
   const field=def.field,folderId=field.folderId?ids.get(`folder:${field.folderId}`)??null:null;
   // Stable IDs of existing options survive relabeling and removal (archived).
   const existing=mode==='overwrite'?s.fields.find(r=>r.id===id):undefined;
   const oldOptions=(existing?.options_json?JSON.parse(existing.options_json):[]).map((v:any,i:number)=>typeof v==='string'?{id:`legacy_${i+1}`,label:v,color:null,status:'active',displayOrder:i}:v);
   const options=(field.options??[]).map((v,i)=>typeof v==='string'?{id:`option_${i+1}`,label:v}:v);
   const mapping=new Map<string,string>();
   const merged=options.map(o=>{const old=oldOptions.find((p:any)=>typeof p!=='string'&&(p.id===o.id||p.label===o.label));const optionId=old?.id??o.id;mapping.set(o.id,optionId);return {...o,id:optionId}});
   for(const old of oldOptions)if(typeof old!=='string'&&!merged.some(o=>o.id===old.id))merged.push({...old,status:'archived'});
   let defaultValue=field.defaultValue??null;
   if(defaultValue&&field.type==='select')defaultValue=mapping.get(defaultValue)??defaultValue;
   if(defaultValue&&field.type==='multi_select')defaultValue=JSON.stringify(JSON.parse(defaultValue).map((v:string)=>mapping.get(v)??v));
   let key=field.fieldKey;
   if(mode==='alias'){for(let n=2;n<10000;n++){const suffix=`_${n}`,candidate=`${key.slice(0,32-suffix.length)}${suffix}`;if(!s.keys.some(k=>k.field_key===candidate)){key=candidate;break}}if(key===field.fieldKey)throw new HqTemplateError('ALIAS_EXHAUSTED',409)}
   const bindings=[name,folderId,JSON.stringify(merged),defaultValue,field.ecFieldPath??null,field.ecIsMaster?1:0,field.isPersonal?1:0,field.isStarred?1:0,field.displayOrder??0,now];
   if(mode==='overwrite')statements.push(stmt('UPDATE friend_fields SET name=?,folder_id=?,options_json=?,default_value=?,ec_field_path=?,ec_is_master=?,is_personal=?,is_starred=?,display_order=?,updated_at=?,version=version+1 WHERE id=?',[...bindings,id]));
   else {
    const legacy=['time','datetime','image','pdf'].includes(field.type)?'text':field.type;
    statements.push(stmt('INSERT INTO friend_fields(id,name,folder_id,options_json,default_value,ec_field_path,ec_is_master,is_personal,is_starred,display_order,updated_at,field_key,type,type_v6,type_v8,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,...bindings,key,legacy,field.type==='time'?'text':field.type,field.type==='time'?'time':null,field.source??'manual',now]),stmt('INSERT INTO friend_field_scopes(field_id,tenant_id,line_account_id,created_at) VALUES(?,?,?,?)',[id,auth.tenantId,accountId,now]));
   }
  }
 }
 return {statements,resolved};
}
export async function friendAttributeResult(db:D1Database,auth:HqTemplateAuthority,id:string,runId:string){
 const run=await db.prepare('SELECT status,created_by FROM hq_template_distribution_runs WHERE id=? AND tenant_id=? AND template_id=?').bind(runId,auth.tenantId,id).first<{status:string;created_by:string}>();
 if(!run)throw new HqTemplateError('NOT_FOUND',404);
 const preflights=(await db.prepare('SELECT * FROM hq_template_preflights WHERE tenant_id=? AND template_id=? AND idempotency_fingerprint=? ORDER BY target_account_id').bind(auth.tenantId,id,runId).all<HqTemplatePreflight>()).results;
 await requireTargetAccounts(db,auth,preflights.map(p=>p.target_account_id));
 const stores=[];
 for(const p of preflights){
  const row=await db.prepare('SELECT status,error_code,created_name FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?').bind(runId,auth.tenantId,p.target_account_id).first<{status:string;error_code:string|null;created_name:string|null}>();
  const root=await db.prepare("SELECT COALESCE(friend_attribute_mode,resolution_mode) mode FROM hq_template_preflight_resolutions WHERE preflight_id=? AND tenant_id=? AND item_kind IN ('friend_field','mark')").bind(p.id,auth.tenantId).first<{mode:HqFriendAttributeMode}>();
  const counts={created:0,overwritten:0,aliased:0,skipped:0};
  if(row?.status==='succeeded'&&root){const key={create:'created',overwrite:'overwritten',alias:'aliased',skip:'skipped'} as const;counts[key[root.mode]]=1;}
  stores.push({accountId:p.target_account_id,status:row?.status??'pending',reason:row?.error_code??null,createdName:row?.created_name??null,counts});
 }
 return {runId,status:run.status,stores};
}
export async function distributeFriendAttribute(db:D1Database,auth:HqTemplateAuthority,id:string,runId:string,selections:Selection[]){
 const {template,definition}=await templateDetail(db,auth,id);if(!isFriendAttributeType(template.template_type))throw new HqTemplateError('INVALID_TYPE');const type=template.template_type;
 const preflights=(await db.prepare('SELECT * FROM hq_template_preflights WHERE tenant_id=? AND template_id=? AND idempotency_fingerprint=? ORDER BY target_account_id').bind(auth.tenantId,id,runId).all<HqTemplatePreflight>()).results;
 if(!preflights.length||preflights.some(p=>p.created_by!==auth.actorId))throw new HqTemplateError('NOT_FOUND',404);
 await requireTargetAccounts(db,auth,preflights.map(p=>p.target_account_id));
 if(preflights.some(p=>p.template_version_id!==preflights[0].template_version_id))throw new HqTemplateError('INVALID_PREFLIGHT',409);
 const version=await db.prepare('SELECT definition_json FROM hq_template_versions WHERE tenant_id=? AND template_id=? AND id=?').bind(auth.tenantId,id,preflights[0].template_version_id).first<{definition_json:string}>();
 if(!version)throw new HqTemplateError('NOT_FOUND',404);const def=definitionFor(type,JSON.parse(version.definition_json));
 const stored=(await db.prepare('SELECT *,COALESCE(friend_attribute_mode,resolution_mode) mode FROM hq_template_preflight_resolutions WHERE tenant_id=? AND template_id=? AND idempotency_fingerprint=?').bind(auth.tenantId,id,runId).all<{preflight_id:string;target_account_id:string;source_id:string;item_kind:string;target_id:string|null;expected_revision:string|null;mode:HqFriendAttributeMode}>()).results;
 if(selections.length!==stored.length||new Set(selections.map(s=>JSON.stringify([s.accountId,s.sourceId]))).size!==stored.length)throw new HqTemplateError('SELECTION_REQUIRED',409);
 const snapshots=new Map<string,string>();
 for(const p of preflights)snapshots.set(p.id,await snapshot(db,auth,p.target_account_id));
 for(const s of selections){
  const r=stored.find(r=>r.target_account_id===s.accountId&&r.source_id===s.sourceId),p=preflights.find(p=>p.target_account_id===s.accountId);
  if(!r||!p||!['create','overwrite','alias','skip'].includes(s.mode))throw new HqTemplateError('SELECTION_REQUIRED',409);
  if(p.status==='consumed'){if(r.mode!==s.mode)throw new HqTemplateError('SELECTION_CHANGED',409);continue;}
  // Validate against the original duplicate identity even when snapshot is stale.
  if(s.mode==='skip'&&(!r.target_id||r.item_kind!==type))throw new HqTemplateError('SELECTION_REQUIRED',409);
  if(r.target_id&&s.mode==='create')throw new HqTemplateError('SELECTION_REQUIRED',409);
  if(!r.target_id&&(s.mode==='overwrite'||s.mode==='skip'))throw new HqTemplateError('SELECTION_REQUIRED',409);
  if(`hqts1.${await digest(snapshots.get(p.id)!)}`===p.snapshot_token){
   const item=inspect(type,def,snapshots.get(p.id)!).find(i=>i.sourceId===s.sourceId);
   if(!item||!item.allowedModes.includes(s.mode))throw new HqTemplateError('SELECTION_REQUIRED',409);
  }
 }
 await beginHqTemplateDistributionRun(db,{id:runId,tenantId:auth.tenantId,templateId:id,templateVersionId:preflights[0].template_version_id,idempotencyFingerprint:runId,createdBy:auth.actorId});
 const requestHash=await digest(JSON.stringify([...selections].sort((a,b)=>JSON.stringify([a.accountId,a.sourceId]).localeCompare(JSON.stringify([b.accountId,b.sourceId]))).map(s=>[s.accountId,s.sourceId,s.mode]))),sourceId=JSON.stringify([auth.tenantId,runId]);
 await db.prepare("INSERT OR IGNORE INTO audit_events(id,source_kind,source_id,tenant_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES(?,'hq_template_distribution_request',?,?,'business',?,?,'hq_template.distribution_started','hq_template',?,'success',?)").bind(crypto.randomUUID(),sourceId,auth.tenantId,auth.actorId,auth.role,id,JSON.stringify({runId,requestHash})).run();
 const claim=await db.prepare("SELECT after_json FROM audit_events WHERE source_kind='hq_template_distribution_request' AND source_id=? AND tenant_id=? AND actor_principal_id=?").bind(sourceId,auth.tenantId,auth.actorId).first<{after_json:string}>();
 if(!claim||JSON.parse(claim.after_json).requestHash!==requestHash)throw new HqTemplateError('SELECTION_CHANGED',409);
 for(const p of preflights){
  const existing=()=>db.prepare('SELECT status FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?').bind(runId,auth.tenantId,p.target_account_id).first();
  if(await existing())continue;
  const selected=selections.filter(s=>s.accountId===p.target_account_id),value=await snapshot(db,auth,p.target_account_id);
  let status='succeeded',errorCode:string|null=null,commit:ReturnType<typeof plan>|null=null;
  if(!p.expires_at||p.expires_at<=new Date().toISOString()||`hqts1.${await digest(value)}`!==p.snapshot_token){status='version_conflict';errorCode='VERSION_CONFLICT';}
  else try{commit=plan(type,def,value,auth,p.target_account_id,selected)}catch(e){status=e instanceof HqTemplateError&&e.code==='VERSION_CONFLICT'?'version_conflict':'failed';errorCode=e instanceof HqTemplateError?e.code:'COMMIT_FAILED';}
  const persist=async(finalStatus:string,finalError:string|null,apply:boolean)=>{
   const statements:HqTemplateStatement[]=[stmt("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM hq_template_preflights WHERE id=? AND tenant_id=? AND status='ready') AND NOT EXISTS(SELECT 1 FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?) THEN '{}' ELSE 'CONFLICT' END)",[p.id,auth.tenantId,runId,auth.tenantId,p.target_account_id]),stmt("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL) THEN '{}' ELSE 'FORBIDDEN' END)",[p.target_account_id,auth.tenantId])];
   if(apply)statements.push(stmt("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM hq_template_preflights WHERE id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN '{}' ELSE 'VERSION_CONFLICT' END)",[p.id]));
   for(const s of selected){
    const r=stored.find(r=>r.preflight_id===p.id&&r.source_id===s.sourceId)!,resolved=commit?.resolved.find(r=>r.item.sourceId===s.sourceId);
    // A failed alias still needs a non-null ledger name under the legacy CHECK.
    statements.push(stmt('UPDATE hq_template_preflight_resolutions SET resolution_mode=?,friend_attribute_mode=?,target_id=COALESCE(?,target_id),alias_name=? WHERE preflight_id=? AND tenant_id=? AND source_id=?',[s.mode==='skip'?'overwrite':s.mode,s.mode==='skip'?'skip':null,apply?resolved?.targetId??null:r.target_id,s.mode==='alias'?resolved?.aliasName??'pending':null,p.id,auth.tenantId,s.sourceId]));
   }
   statements.push(stmt("INSERT INTO hq_template_distribution_results(run_id,tenant_id,template_id,template_version_id,target_account_id,preflight_id,idempotency_fingerprint,snapshot_token,status,error_code,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",[runId,auth.tenantId,id,p.template_version_id,p.target_account_id,p.id,runId,p.snapshot_token,finalStatus,finalError]));
   if(apply&&commit)statements.push(...commit.statements);
   if(apply){
    const root=commit!.resolved.find(r=>r.item.itemKind===type)!,table=type==='mark'?'support_marks':'friend_fields';
    if(root.mode!=='skip')statements.push(stmt(`UPDATE hq_template_distribution_results SET created_name=(SELECT name FROM ${table} WHERE id=?) WHERE run_id=? AND tenant_id=? AND target_account_id=?`,[root.targetId,runId,auth.tenantId,p.target_account_id]));
   }
   statements.push(stmt("INSERT INTO audit_events(id,tenant_id,line_account_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES(?,?,?,'business',?,?,'hq_template.distributed','hq_template',?,?,?)",[crypto.randomUUID(),auth.tenantId,p.target_account_id,auth.actorId,auth.role,id,finalStatus==='succeeded'?'success':'failed',JSON.stringify({runId})]));
   await db.batch(statements.map(s=>db.prepare(s.sql).bind(...s.bindings)));
  };
  try{await persist(status,errorCode,status==='succeeded')}
  catch{
   if(await existing())continue;
   // Recheck ownership before writing a failure ledger for this store.
   await requireTargetAccounts(db,auth,[p.target_account_id]);
   const conflict=!p.expires_at||p.expires_at<=new Date().toISOString()||`hqts1.${await digest(await snapshot(db,auth,p.target_account_id))}`!==p.snapshot_token;
   try{await persist(conflict?'version_conflict':'failed',conflict?'VERSION_CONFLICT':'COMMIT_FAILED',false)}catch{if(!(await existing()))throw new HqTemplateError('RESULT_UNAVAILABLE',500)}
  }
 }
 const result=await friendAttributeResult(db,auth,id,runId),success=result.stores.filter(s=>s.status==='succeeded').length;
 if(!result.stores.some(s=>s.status==='pending'||s.status==='staged'))await db.prepare("UPDATE hq_template_distribution_runs SET status=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND tenant_id=? AND status='running'").bind(success===preflights.length?'completed':success?'partial':'failed',runId,auth.tenantId).run();
 return friendAttributeResult(db,auth,id,runId);
}
