import { HQ_AUTHORED_MESSAGE_ID, isRegisteredHqMedia } from './authoring-media.js';
import { beginHqTemplateDistributionRun, beginHqTemplateStoreResult, recordHqTemplateOwnedR2Key, setHqTemplateOwnedR2KeyState, normalizeScopedTagName, type HqTemplateDistributionResult, type HqTemplatePreflight, type HqTemplatePreflightResolution, type HqTemplateStatement } from '@line-crm/db';
import { requireHqTemplateAuthority, type HqTemplateAdapter, type HqTemplateAdapterContext, type HqTemplateAdapterInput, type HqTemplateAdapterResult, type HqTemplateAuthority, type HqTemplateSnapshotToken, type HqTemplateStoreAtomicCommitPlan } from './contract.js';
import { createTemplateHqTemplateAdapter, parseMessageTemplateDefinition, inspectMessageTemplateDefinition, readMessageTemplateSourceBytes, type MessageTemplateTargetSnapshot, type MessageTemplateSourceMediaBinding, type MessageTemplateAdapterDependencies } from './template.js';
import { createRichMenuHqTemplateAdapter, parseRichMenuTemplateDefinition, richMenuReferences, type RichMenuHqDefinition } from './rich-menu.js';
import { loadScenarioReferenceGraph, remapScenarioJson, scenarioGraphSourceGuardStatements, ScenarioGraphError, type ScenarioGraphReference, type ScenarioReferenceGraph } from './scenario-graph.js';

export class HqR2RuntimeError extends Error { constructor(public readonly code: string) { super(code); } }
const fail = (code: string): never => { throw new HqR2RuntimeError(code); };
const digest = async (value: string | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value))), n => n.toString(16).padStart(2, '0')).join('');
const guard = (sql: string, bindings: HqTemplateStatement['bindings']): HqTemplateStatement => ({ sql: `SELECT json(CASE WHEN (${sql}) THEN '{}' ELSE 'HQ_R2_CONFLICT' END)`, bindings });
const ok = <T>(r: HqTemplateAdapterResult<T>): T => r.kind === 'OK' ? r.value : fail('UNSUPPORTED');
const normalizeSha256 = (value:string) => { const v=value.trim().replace(/^sha256[:=]/i,'').toLowerCase();return /^[a-f0-9]{64}$/.test(v)?v:null; };
const safeId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : fail('INVALID_ID');
function sourceKey(key: string, tenant: string): string {
  if (!key.startsWith(`hq-templates/${safeId(tenant)}/`) || key.split('/').some(p => !p || p === '.' || p === '..') || /[%\\\u0000-\u001f]/.test(key)) fail('SOURCE_SCOPE_MISMATCH');
  return key;
}
type Bucket = Pick<R2Bucket, 'head' | 'get' | 'put' | 'delete'>;
export interface R2RuntimeBinding { db: D1Database; bucket: Bucket; authority: HqTemplateAuthority; templateId: string; templateVersionId: string; /** Trusted server public origin, never request-body input. */ publicBaseUrl?: string }
async function sourceVersion(b: R2RuntimeBinding) {
  if (requireHqTemplateAuthority(b.authority).kind !== 'AUTHORIZED') fail('FORBIDDEN');
  const v = await b.db.prepare(`SELECT v.definition_json,v.content_hash,t.template_type FROM hq_template_versions v JOIN hq_templates t ON t.id=v.template_id AND t.tenant_id=v.tenant_id WHERE v.id=? AND v.template_id=? AND v.tenant_id=? AND t.archived_at IS NULL AND t.template_type IN ('template','rich_menu')`).bind(b.templateVersionId,b.templateId,b.authority.tenantId).first<{definition_json:string;content_hash:string;template_type:'template'|'rich_menu'}>();
  if (!v || normalizeSha256(v.content_hash) !== await digest(v.definition_json)) fail('SOURCE_VERSION_UNAVAILABLE');
  return v!;
}
async function targetAccount(b:R2RuntimeBinding, account:string) {
  if (!await b.db.prepare(`SELECT id FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL`).bind(account,b.authority.tenantId).first()) fail('FORBIDDEN');
}
async function messageSnapshot(b:R2RuntimeBinding,account:string):Promise<MessageTemplateTargetSnapshot> {
  await targetAccount(b,account);
  const templates=(await b.db.prepare(`SELECT id,name,updated_at AS updatedAt FROM templates WHERE line_account_id=? ORDER BY id`).bind(account).all<MessageTemplateTargetSnapshot['templates'][number]>()).results;
  const media=(await b.db.prepare(`SELECT m.id,m.filename,m.mime_type AS mimeType,m.size_bytes AS sizeBytes,m.r2_key AS r2Key,m.public_url AS publicUrl,COALESCE(v.content_hash,'') AS contentHash,COALESCE(v.created_at || ':' || COALESCE(v.content_hash,'') || ':' || v.r2_key,'') AS revision,COALESCE(v.version_no,0) AS versionNo FROM media m LEFT JOIN media_versions v ON v.media_id=m.id AND v.version_no=(SELECT MAX(v2.version_no) FROM media_versions v2 WHERE v2.media_id=m.id) WHERE m.line_account_id=? ORDER BY m.id`).bind(account).all<MessageTemplateTargetSnapshot['media'][number]>()).results;
  return {tenantId:b.authority.tenantId,targetAccountId:account,templates,media,snapshotToken:`hqts1.${await digest(JSON.stringify([templates,media]))}` as HqTemplateSnapshotToken};
}
type RichReference = ReturnType<typeof richMenuReferences>[number];
type DbRow = Record<string,string|number|null>;
type RichReferenceMatch = RichReference & { name:string;targetId:string;expectedRevision:string;operation:'reuse'|'create';dbCommit:HqTemplateStatement[] };
const richReferenceKey = (ref:RichReference) => `${ref.kind}:${ref.sourceId}`;
const insertRow = (table:string,row:DbRow):HqTemplateStatement => { const columns=Object.keys(row);return {sql:`INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,bindings:columns.map(column=>row[column])}; };
const exactRowGuard = (table:string,row:DbRow):HqTemplateStatement => { const columns=Object.keys(row);return guard(`EXISTS(SELECT 1 FROM ${table} WHERE ${columns.map(column=>`${column} IS ?`).join(' AND ')})`,columns.map(column=>row[column])); };
const targetListGuard = (sql:string,bindings:HqTemplateStatement['bindings'],snapshot:string):HqTemplateStatement => guard(`(${sql}) IS ?`,[...bindings,snapshot]);
const portableText = (value:unknown) => {
  let current=String(value??'');
  for(let attempt=0;attempt<4;attempt++) {
    if(/(?:liff\.line\.me|[?&#](?:form|template|scenario|tag|account|line[_-]?account)(?:s|[_-]?ids?)?=|\/(?:forms?|scenarios?|templates?|tags?|accounts?)\/)/i.test(current))return false;
    if(!/%[0-9a-f]{2}/i.test(current))return true;
    try { const decoded=decodeURIComponent(current);if(decoded===current)return true;current=decoded; }
    catch { return false; }
  }
  return !/%[0-9a-f]{2}/i.test(current);
};
function formValueHasDependency(value:unknown):boolean {
  if(Array.isArray(value))return value.some(formValueHasDependency);
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,item])=>
    (['tagId','tagIds','scenarioId','templateId','friendFieldId','friendFieldIds','choiceFriendFieldId','fieldId','reminderId','mediaUrl','backgroundImageUrl'].includes(key)&&item!=null&&item!==''&&!(Array.isArray(item)&&!item.length))
    ||(['url','linkUrl','thanksUrl'].includes(key)&&!portableText(item))
    ||formValueHasDependency(item));
}

function parsePortableLayout(value:unknown):unknown {
  if(value==null||value==='')return null;
  try { return JSON.parse(String(value)); }
  catch { fail('UNSUPPORTED_REFERENCE'); }
}

const activeAccountGuard = (account:string,tenant:string) => guard(`EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL)`,[account,tenant]);

async function plannedTargetId(b:R2RuntimeBinding,account:string,ref:RichReference) {
  return (await digest(JSON.stringify([b.authority.tenantId,b.templateVersionId,account,ref.kind,ref.sourceId]))).slice(0,32);
}

/** Reuse an exact destination match or plan one private/local clone in the parent atomic batch. */
async function matchRichReference(b:R2RuntimeBinding,ref:RichReference,account:string,execution=false):Promise<RichReferenceMatch> {
  if (!['tag','form','scenario','template'].includes(ref.kind)) fail('UNSUPPORTED_REFERENCE');
  await targetAccount(b,account);
  const unavailable=()=>fail(execution?'VERSION_CONFLICT':'REFERENCE_UNAVAILABLE');
  if(ref.kind==='tag') {
    const source=await b.db.prepare(`SELECT t.id,t.name,t.normalized_name,t.color,t.description,t.status,t.version,t.line_account_id,t.created_by,t.updated_by,t.created_at,t.updated_at FROM tags t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND t.status='active' AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(ref.sourceId,b.authority.tenantId).first<DbRow>();if(!source)unavailable();
    const listSql=`SELECT json_group_array(json_array(id,name,status,version,updated_at)) FROM (SELECT id,name,status,version,updated_at FROM tags WHERE line_account_id=? ORDER BY id)`,list=(await b.db.prepare(`SELECT (${listSql}) AS snapshot`).bind(account).first<{snapshot:string}>())!.snapshot;
    const rows=(JSON.parse(list) as [string,string,string,number,string|null][]).map(([id,name,status,version,updated_at])=>({id,name,status,version,updated_at}));
    const matches=rows.filter(row=>normalizeScopedTagName(row.name)===normalizeScopedTagName(String(source!.name)));if(matches.length>1||matches.some(row=>row.status!=='active'))unavailable();
    const match=matches[0],sourceHash=await digest(JSON.stringify(source)),dbCommit=[exactRowGuard('tags',source!),activeAccountGuard(String(source!.line_account_id),b.authority.tenantId),targetListGuard(listSql,[account],list)];
    if(match)return {...ref,name:String(source!.name),targetId:match.id,expectedRevision:JSON.stringify([sourceHash,match.version,match.updated_at]),operation:'reuse',dbCommit};
    const targetId=await plannedTargetId(b,account,ref),row:DbRow={...source!,id:targetId,normalized_name:normalizeScopedTagName(String(source!.name)),line_account_id:account,created_by:b.authority.actorId,updated_by:b.authority.actorId};delete row.created_at;delete row.updated_at;row.version=1;
    return {...ref,name:String(source!.name),targetId,expectedRevision:JSON.stringify([sourceHash,null]),operation:'create',dbCommit:[...dbCommit,guard(`NOT EXISTS(SELECT 1 FROM tags WHERE id=?)`,[targetId]),insertRow('tags',row)]};
  }
  if(ref.kind==='scenario') {
    fail('SCENARIO_GRAPH_REQUIRED');
  }
  if(ref.kind==='form') {
    const source=await b.db.prepare(`SELECT f.* FROM forms f WHERE f.id=? AND f.status<>'archived' AND EXISTS(SELECT 1 FROM form_accounts fa JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=f.id AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL) AND NOT EXISTS(SELECT 1 FROM form_accounts fa LEFT JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=f.id AND (a.tenant_id IS NULL OR a.tenant_id<>?))`).bind(ref.sourceId,b.authority.tenantId,b.authority.tenantId).first<DbRow>();if(!source)unavailable();
    if(source!.on_submit_tag_id||source!.on_submit_scenario_id||source!.on_submit_webhook_url||source!.on_submit_webhook_headers||source!.og_image_url||!portableText(source!.on_submit_message_content)||formValueHasDependency(parsePortableLayout(source!.fields))||formValueHasDependency(parsePortableLayout(source!.layout)))fail('UNSUPPORTED_REFERENCE');
    const listSql=`SELECT json_group_array(json_array(f.id,f.name,f.status,f.content_revision,f.updated_at,(SELECT json_group_array(line_account_id) FROM (SELECT line_account_id FROM form_accounts WHERE form_id=f.id ORDER BY line_account_id)))) FROM (SELECT f.* FROM forms f WHERE EXISTS(SELECT 1 FROM form_accounts WHERE form_id=f.id AND line_account_id=?) ORDER BY f.id) f`,list=(await b.db.prepare(`SELECT (${listSql}) AS snapshot`).bind(account).first<{snapshot:string}>())!.snapshot;
    const rows=(JSON.parse(list) as [string,string,string,number,string|null,string][]).map(([id,name,status,content_revision,updated_at,owners])=>({id,name,status,content_revision,updated_at,owners:typeof owners==='string'?JSON.parse(owners) as string[]:owners as unknown as string[]})),matches=rows.filter(row=>normalizeScopedTagName(row.name)===normalizeScopedTagName(String(source!.name)));if(matches.length>1||matches.some(row=>row.status==='archived'||row.owners.length!==1||row.owners[0]!==account))unavailable();
    const ownerSql=`SELECT json_group_array(line_account_id) FROM (SELECT line_account_id FROM form_accounts WHERE form_id=? ORDER BY line_account_id)`,sourceOwners=(await b.db.prepare(`SELECT (${ownerSql}) AS snapshot`).bind(ref.sourceId).first<{snapshot:string}>())!.snapshot;
    const sourceHash=await digest(JSON.stringify([source,sourceOwners])),dbCommit=[exactRowGuard('forms',source!),targetListGuard(ownerSql,[ref.sourceId],sourceOwners),guard(`EXISTS(SELECT 1 FROM form_accounts fa JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL) AND NOT EXISTS(SELECT 1 FROM form_accounts fa LEFT JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=? AND (a.tenant_id IS NULL OR a.tenant_id<>? OR a.is_active<>1 OR a.archived_at IS NOT NULL))`,[ref.sourceId,b.authority.tenantId,ref.sourceId,b.authority.tenantId]),targetListGuard(listSql,[account],list)],match=matches[0];
    if(match)return {...ref,name:String(source!.name),targetId:match.id,expectedRevision:JSON.stringify([sourceHash,match.content_revision,match.updated_at]),operation:'reuse',dbCommit};
    const targetId=await plannedTargetId(b,account,ref),form:DbRow={...source!,id:targetId,is_active:0,status:'active',archived_at:null,revision:1,content_revision:1,submit_count:0};delete form.created_at;delete form.updated_at;
    return {...ref,name:String(source!.name),targetId,expectedRevision:JSON.stringify([sourceHash,null]),operation:'create',dbCommit:[...dbCommit,guard(`NOT EXISTS(SELECT 1 FROM forms WHERE id=?)`,[targetId]),insertRow('forms',form),{sql:`INSERT INTO form_accounts(form_id,line_account_id,created_at) VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[targetId,account]}]};
  }
  const source=await b.db.prepare(`SELECT t.* FROM templates t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(ref.sourceId,b.authority.tenantId).first<DbRow>();if(!source)unavailable();
  if(source!.message_type!=='text'||source!.carousel_actions_json||source!.question_json||source!.folder_id||source!.created_from_recipe_id||source!.recipe_clone_run_id||!portableText(source!.message_content)||source!.draft_message_type&&source!.draft_message_type!=='text'||source!.draft_carousel_actions_json||source!.draft_question_json||source!.draft_message_content&&!portableText(source!.draft_message_content))fail('UNSUPPORTED_REFERENCE');
  const listSql=`SELECT json_group_array(json_array(id,name,draft_revision,updated_at)) FROM (SELECT id,name,draft_revision,updated_at FROM templates WHERE line_account_id=? ORDER BY id)`,list=(await b.db.prepare(`SELECT (${listSql}) AS snapshot`).bind(account).first<{snapshot:string}>())!.snapshot;
  const rows=(JSON.parse(list) as [string,string,number,string|null][]).map(([id,name,draft_revision,updated_at])=>({id,name,draft_revision,updated_at})),matches=rows.filter(row=>normalizeScopedTagName(row.name)===normalizeScopedTagName(String(source!.name)));if(matches.length>1)unavailable();
  const sourceHash=await digest(JSON.stringify(source)),dbCommit=[exactRowGuard('templates',source!),activeAccountGuard(String(source!.line_account_id),b.authority.tenantId),targetListGuard(listSql,[account],list)],match=matches[0];
  if(match)return {...ref,name:String(source!.name),targetId:match.id,expectedRevision:JSON.stringify([sourceHash,match.draft_revision,match.updated_at]),operation:'reuse',dbCommit};
  const targetId=await plannedTargetId(b,account,ref),template:DbRow={...source!,id:targetId,line_account_id:account,folder_id:null,created_from_recipe_id:null,recipe_clone_run_id:null,published_at:null,publish_idempotency_key:null};delete template.created_at;delete template.updated_at;
  return {...ref,name:String(source!.name),targetId,expectedRevision:JSON.stringify([sourceHash,null]),operation:'create',dbCommit:[...dbCommit,guard(`NOT EXISTS(SELECT 1 FROM templates WHERE id=?)`,[targetId]),insertRow('templates',template)]};
}
type RichReferencePlan = { matches:RichReferenceMatch[];dbCommit:HqTemplateStatement[] };

async function scenarioGraphPlan(b:R2RuntimeBinding,graph:ScenarioReferenceGraph,account:string,execution:boolean):Promise<RichReferencePlan> {
  const unavailable=()=>fail(execution?'VERSION_CONFLICT':'REFERENCE_UNAVAILABLE');
  const graphHash=await digest(graph.snapshot),matches:RichReferenceMatch[]=[],dbCommit:HqTemplateStatement[]=[activeAccountGuard(graph.sourceAccountId,b.authority.tenantId),...scenarioGraphSourceGuardStatements(graph)];
  const ids=new Map<string,string>(),modes=new Map<string,'reuse'|'create'>();
  for(const reference of graph.references) {
    const ref=reference as RichReference;
    const source=reference.kind==='tag'?graph.tags.get(reference.sourceId):reference.kind==='template'?graph.templates.get(reference.sourceId):graph.scenarios.get(reference.sourceId)?.row;
    if(!source)unavailable();
    if(reference.kind==='template'&&(source!.message_type!=='text'||source!.draft_message_type&&source!.draft_message_type!=='text'))unavailable();
    const generatedTargetId=await plannedTargetId(b,account,ref);
    const config=reference.kind==='tag'
      ? {table:'tags',columns:'id,name,status,version,updated_at',revision:(row:DbRow)=>[row.version,row.updated_at],valid:(row:DbRow)=>row.status==='active'}
      : reference.kind==='template'
        ? {table:'templates',columns:'id,name,draft_revision,published_version,updated_at',revision:(row:DbRow)=>[row.draft_revision,row.published_version,row.updated_at],valid:(_row:DbRow)=>true}
        : {table:'scenarios',columns:'id,name,is_active,updated_at,current_published_version_id',revision:(row:DbRow)=>[row.updated_at,row.current_published_version_id],valid:(row:DbRow)=>row.is_active===1||(row.id===generatedTargetId&&row.is_active===0&&row.current_published_version_id==null)};
    const listSql=`SELECT json_group_array(json_array(${config.columns})) FROM (SELECT ${config.columns} FROM ${config.table} WHERE line_account_id=? ORDER BY id)`,list=(await b.db.prepare(`SELECT (${listSql}) AS snapshot`).bind(account).first<{snapshot:string}>())!.snapshot;
    const columns=config.columns.split(','),rows=(JSON.parse(list) as unknown[][]).map(values=>Object.fromEntries(columns.map((column,index)=>[column,values[index]])) as DbRow);
    const same=rows.filter(row=>normalizeScopedTagName(String(row.name))===normalizeScopedTagName(String(source!.name)));
    if(same.length>1||same.some(row=>!config.valid(row)))unavailable();
    const match=same[0],targetId=match?String(match.id):generatedTargetId,operation=match?'reuse' as const:'create' as const;
    ids.set(reference.sourceId,targetId);modes.set(richReferenceKey(ref),operation);
    dbCommit.push(targetListGuard(listSql,[account],list));
    matches.push({...ref,name:String(source!.name),targetId,operation,expectedRevision:JSON.stringify([graphHash,match?config.revision(match):null]),dbCommit:[]});
  }
  for(const match of matches)if(match.operation==='create')dbCommit.push(guard(`NOT EXISTS(SELECT 1 FROM ${{tag:'tags',template:'templates',scenario:'scenarios'}[match.kind as 'tag'|'template'|'scenario']} WHERE id=?)`,[match.targetId]));
  for(const row of graph.tags.values()) {
    const key=richReferenceKey({kind:'tag',sourceId:String(row.id)}),targetId=ids.get(String(row.id))!;
    if(modes.get(key)==='reuse')continue;
    const clone:DbRow={...row,id:targetId,normalized_name:normalizeScopedTagName(String(row.name)),line_account_id:account,created_by:b.authority.actorId,updated_by:b.authority.actorId,version:1};delete clone.created_at;delete clone.updated_at;
    dbCommit.push(insertRow('tags',clone));
  }
  for(const row of graph.templates.values()) {
    const key=richReferenceKey({kind:'template',sourceId:String(row.id)}),targetId=ids.get(String(row.id))!;
    if(modes.get(key)==='reuse')continue;
    const clone:DbRow={...row,id:targetId,line_account_id:account,folder_id:null,created_from_recipe_id:null,recipe_clone_run_id:null,published_version:0,published_at:null,publish_idempotency_key:null};
    for(const field of ['message_content','carousel_actions_json','question_json','draft_message_content','draft_carousel_actions_json','draft_question_json'])if(clone[field]!=null)clone[field]=remapScenarioJson(clone[field],ids);
    delete clone.created_at;delete clone.updated_at;dbCommit.push(insertRow('templates',clone));
  }
  const ordered:string[]=[],seen=new Set<string>();
  const order=(id:string)=>{if(seen.has(id))return;seen.add(id);const node=graph.scenarios.get(id)??unavailable();for(const ref of node.references)if(ref.kind==='scenario')order(ref.sourceId);ordered.push(id)};
  for(const id of graph.scenarios.keys())order(id);
  for(const sourceId of ordered) {
    const node=graph.scenarios.get(sourceId)!,key=richReferenceKey({kind:'scenario',sourceId}),targetId=ids.get(sourceId)!;
    if(modes.get(key)==='reuse')continue;
    const clone:DbRow={...node.row,id:targetId,line_account_id:account,is_active:0,trigger_tag_id:node.row.trigger_tag_id?ids.get(String(node.row.trigger_tag_id))??unavailable():null,on_complete_scenario_id:node.row.on_complete_scenario_id?ids.get(String(node.row.on_complete_scenario_id))??unavailable():null,folder_id:null,created_from_recipe_id:null,recipe_clone_run_id:null,current_published_version_id:null};
    delete clone.created_at;delete clone.updated_at;dbCommit.push(insertRow('scenarios',clone));
    const stepIds=new Map<string,string>();
    for(const step of node.steps)stepIds.set(String(step.id),(await digest(JSON.stringify([b.authority.tenantId,b.templateVersionId,account,'scenario_step',step.id]))).slice(0,32));
    const remapIds=new Map([...ids,...stepIds]);
    for(const step of node.steps) {
      const copy:DbRow={...step,id:stepIds.get(String(step.id))!,scenario_id:targetId,template_id:step.template_id?ids.get(String(step.template_id))??unavailable():null,on_reach_tag_id:step.on_reach_tag_id?ids.get(String(step.on_reach_tag_id))??unavailable():null,is_draft:1};
      if(/^\s*[\[{]/.test(String(copy.message_content)))copy.message_content=remapScenarioJson(copy.message_content,remapIds);
      for(const field of ['message_bubbles_json','target_condition_json','question_json'])if(copy[field]!=null)copy[field]=remapScenarioJson(copy[field],remapIds);
      delete copy.created_at;dbCommit.push(insertRow('scenario_steps',copy));
    }
    for(const action of node.actions) {
      const copy:DbRow={...action,id:(await digest(JSON.stringify([b.authority.tenantId,b.templateVersionId,account,'scenario_action',action.id]))).slice(0,32),scenario_id:targetId,step_id:action.step_id?stepIds.get(String(action.step_id))??unavailable():null,config_json:remapScenarioJson(action.config_json,remapIds),condition_json:remapScenarioJson(action.condition_json,remapIds)};
      delete copy.created_at;dbCommit.push(insertRow('scenario_actions',copy));
    }
    for(const trigger of node.triggers) {
      const copy:DbRow={...trigger,id:(await digest(JSON.stringify([b.authority.tenantId,b.templateVersionId,account,'scenario_trigger',trigger.id]))).slice(0,32),scenario_id:targetId,tag_id:trigger.tag_id?ids.get(String(trigger.tag_id))??unavailable():null};
      delete copy.created_at;dbCommit.push(insertRow('scenario_triggers',copy));
    }
  }
  return {matches,dbCommit};
}

async function planRichReferences(b:R2RuntimeBinding,definition:RichMenuHqDefinition,account:string,execution=false):Promise<RichReferencePlan> {
  const direct=richMenuReferences(definition),scenarioIds=direct.filter(ref=>ref.kind==='scenario').map(ref=>ref.sourceId),matches=new Map<string,RichReferenceMatch>(),dbCommit:HqTemplateStatement[]=[];
  if(scenarioIds.length) {
    try {
      const graph=await loadScenarioReferenceGraph(b.db,b.authority.tenantId,scenarioIds),plan=await scenarioGraphPlan(b,graph,account,execution);
      for(const match of plan.matches)matches.set(richReferenceKey(match),match);dbCommit.push(...plan.dbCommit);
    } catch(error) {
      if(error instanceof ScenarioGraphError)fail(execution?'VERSION_CONFLICT':error.code);
      throw error;
    }
  }
  for(const ref of direct)if(!matches.has(richReferenceKey(ref))) {
    const match=await matchRichReference(b,ref,account,execution);matches.set(richReferenceKey(ref),match);dbCommit.push(...match.dbCommit);
  }
  return {matches:[...matches.values()].sort((a,b)=>richReferenceKey(a).localeCompare(richReferenceKey(b))),dbCommit};
}

/** The execution resolver accepts only the exact preflight-selected graph and revision. */
function richResolver(plan:RichReferencePlan,sourceGuards:HqTemplateStatement[],context?:HqTemplateAdapterContext) {
  const byKey=new Map(plan.matches.map(match=>[richReferenceKey(match),match]));let bound=false;
  return async (ref:RichReference,account:string) => {
    const match=byKey.get(richReferenceKey(ref))??fail('REFERENCE_UNAVAILABLE');
    if(context&&!bound) {
      if(context.targetAccountId!==account)fail('SELECTION_REQUIRED');
      const selected=context.resolutions.filter(r=>r.itemKind!=='rich_menu');
      if(selected.length!==plan.matches.length)fail('SELECTION_REQUIRED');
      for(const planned of plan.matches) {
        const rows=selected.filter(r=>r.sourceId===richReferenceKey(planned)&&r.itemKind===planned.kind),mode=planned.operation==='reuse'?'overwrite':'create';
        if(rows.length!==1)fail('SELECTION_REQUIRED');
        if(rows[0].mode!==mode||rows[0].targetId!==planned.targetId||rows[0].expectedRevision!==planned.expectedRevision)fail('VERSION_CONFLICT');
      }
      sourceGuards.push(...plan.dbCommit);bound=true;
    }
    return {targetId:match.targetId,operation:match.operation,expectedRevision:match.expectedRevision};
  };
}
/** Prevent the rich-menu adapter's arrayBuffer call from consuming an unbounded stream. */
function boundedRichBucket(b:R2RuntimeBinding):Bucket {
  return {
    head:(key)=>b.bucket.head(sourceKey(key,b.authority.tenantId)),
    get:async(key,options)=>{
      const object=await b.bucket.get(sourceKey(key,b.authority.tenantId),options);
      if(!object||!('body' in object))return object;
      if(object.size<1||object.size>1024*1024)fail('IMAGE_SIZE_LIMIT');
      return { ...object,body:object.body,etag:object.etag,size:object.size,httpMetadata:object.httpMetadata,arrayBuffer:async()=>{const bytes=await readMessageTemplateSourceBytes(object.body,object.size);if(bytes.byteLength!==object.size)fail('IMAGE_CHANGED');return bytes.buffer;} } as R2ObjectBody;
    },
    put:async()=>fail('UNSUPPORTED_DIRECT_WRITE'),delete:async()=>fail('UNSUPPORTED_DIRECT_WRITE'),
  } as Bucket;
}
async function messageAdapter(b:R2RuntimeBinding,context:HqTemplateAdapterContext,input:HqTemplateAdapterInput,sourceGuards:HqTemplateStatement[]) {
  const definition=parseMessageTemplateDefinition(JSON.parse(input.definitionJson));
  const hqAuthored=definition.template.id===HQ_AUTHORED_MESSAGE_ID;
  const source=hqAuthored?null:await b.db.prepare(`SELECT t.line_account_id FROM templates t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(definition.template.id,b.authority.tenantId).first<{line_account_id:string}>();
  if(!hqAuthored&&!source)fail('SOURCE_ACCOUNT_UNAVAILABLE');
  // HQ provenance is the tenant/version DB record checked by sourceVersion, not a client account id.
  const sourceAccountId=hqAuthored?`hq:${b.authority.tenantId}`:source!.line_account_id;
  if(!hqAuthored)sourceGuards.push(guard(`EXISTS(SELECT 1 FROM templates t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND t.line_account_id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL)`,[definition.template.id,sourceAccountId,b.authority.tenantId]));
  const bindings:MessageTemplateSourceMediaBinding[]=[];
  for(const media of definition.media) {
    const row=hqAuthored?null:await b.db.prepare(`SELECT v.content_hash,v.etag FROM media_versions v JOIN media m ON m.id=v.media_id JOIN line_accounts a ON a.id=m.line_account_id WHERE v.id=? AND v.media_id=? AND v.version_no=? AND v.size_bytes=? AND m.line_account_id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(media.versionId,media.id,media.versionNo,media.sizeBytes,sourceAccountId,b.authority.tenantId).first<{content_hash:string;etag:string|null}>();
    if(!normalizeSha256(media.contentHash)||(!hqAuthored&&(!row||normalizeSha256(row.content_hash)!==normalizeSha256(media.contentHash))))fail('SOURCE_MEDIA_UNAVAILABLE');
    const key=sourceKey(media.r2Key,b.authority.tenantId),object=await b.bucket.head(key);
    if(!object||object.size!==media.sizeBytes||(hqAuthored&&!isRegisteredHqMedia(object,media,b.authority.tenantId)))fail('SOURCE_MEDIA_UNAVAILABLE');
    bindings.push({tenantId:b.authority.tenantId,templateVersionId:b.templateVersionId,sourceAccountId,mediaId:media.id,mediaVersionId:media.versionId,versionNo:media.versionNo,r2Key:key,r2KeyPrefix:`hq-templates/${b.authority.tenantId}`,sizeBytes:media.sizeBytes,contentHash:media.contentHash,etag:object!.etag});
    if(!hqAuthored)sourceGuards.push(guard(`EXISTS(SELECT 1 FROM media_versions v JOIN media m ON m.id=v.media_id JOIN line_accounts a ON a.id=m.line_account_id WHERE v.id=? AND v.media_id=? AND v.version_no=? AND v.size_bytes=? AND v.content_hash=? AND m.line_account_id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL)`,[media.versionId,media.id,media.versionNo,media.sizeBytes,row!.content_hash,sourceAccountId,b.authority.tenantId]));
  }
  const owner=await digest(JSON.stringify([context.tenantId,context.targetAccountId,context.preflightId,context.idempotencyFingerprint,context.executionAttempt??0]));
  const ids=new Map<string,string>();
  for(const [kind,id] of [['template',`template:${definition.template.id}`],...definition.media.flatMap(m=>[['media',`media:${m.id}`],['media_version',m.versionId]])])ids.set(`${kind}:${id}`,(await digest(JSON.stringify([owner,b.templateVersionId,kind,id]))).slice(0,32));
  const dependencies:MessageTemplateAdapterDependencies={
    resolveSourceVersion:async({authority,templateVersionId})=>{
      const v=await sourceVersion(b);if(authority.tenantId!==b.authority.tenantId||authority.sourceAccountId!==sourceAccountId||templateVersionId!==b.templateVersionId||v.definition_json!==input.definitionJson)fail('SOURCE_VERSION_UNAVAILABLE');
      return {tenantId:b.authority.tenantId,templateVersionId:b.templateVersionId,sourceAccountId,definitionJson:input.definitionJson,media:bindings};
    },
    loadTargetSnapshot:c=>messageSnapshot(b,c.targetAccountId),
    readSourceObjectIfUnchanged:async({media,binding,maxBytes})=>{
      const object=await b.bucket.get(sourceKey(media.r2Key,b.authority.tenantId),{onlyIf:{etagMatches:binding.etag!}});
      if(!object||!('body' in object))return null;
      if(object.size!==media.sizeBytes||object.size>maxBytes)fail('MEDIA_SIZE_LIMIT');
      return {bytes:await readMessageTemplateSourceBytes(object.body,maxBytes),etag:object.etag};
    },
    createId:(kind,id)=>ids.get(`${kind}:${id}`)??fail('INVALID_SOURCE_ID'),
    createTargetR2Key:(_media,id)=>`media/${safeId(context.targetAccountId)}/hq/${owner}/${safeId(id)}`,
    createTargetPublicUrl:key=>{
      if(!b.publicBaseUrl)return null;const url=new URL(b.publicBaseUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail('INVALID_PUBLIC_ORIGIN');return `${url.origin}/images/${key}`;
    },
    createOwnerToken:()=>owner,now:()=>new Date().toISOString(),
  };
  return createTemplateHqTemplateAdapter({tenantId:b.authority.tenantId,sourceAccountId},dependencies);
}
export async function inspectR2RuntimeStore(b:R2RuntimeBinding,targetAccountId:string) {
  const v=await sourceVersion(b),input={templateVersionId:b.templateVersionId,definitionJson:v.definition_json};await targetAccount(b,targetAccountId);
  if(v.template_type==='template') {
    const snapshot=await messageSnapshot(b,targetAccountId);
    // Validate real DB media provenance and source objects even during preflight.
    await messageAdapter(b,{tenantId:b.authority.tenantId,targetAccountId,preflightId:'inspect',idempotencyFingerprint:'inspect',mode:'create',snapshotToken:snapshot.snapshotToken,resolutions:[]},input,[]);
    return {type:v.template_type,snapshotToken:snapshot.snapshotToken,items:inspectMessageTemplateDefinition(parseMessageTemplateDefinition(JSON.parse(v.definition_json)),snapshot)};
  }
  const definition=parseRichMenuTemplateDefinition(input,b.authority.tenantId);
  const referencePlan=await planRichReferences(b,definition,targetAccountId);
  const adapter=createRichMenuHqTemplateAdapter({db:b.db,bucket:boundedRichBucket(b),authority:b.authority,input,resolveReference:richResolver(referencePlan,[])});
  const rows=(await b.db.prepare(`SELECT id,name,status,updated_at FROM rich_menu_groups WHERE account_id=? ORDER BY id`).bind(targetAccountId).all<{id:string;name:string;status:string;updated_at:string}>()).results.filter(r=>r.name===definition.richMenu.name);
  if(rows.length>1)fail('AMBIGUOUS_TARGET');const target=rows[0];
  const references=referencePlan.matches;
  return {type:v.template_type,snapshotToken:await adapter.snapshot(targetAccountId),items:[
    {sourceId:definition.richMenu.id,itemKind:'rich_menu',name:definition.richMenu.name,targetId:target?.id??null,expectedRevision:target?.updated_at??null,duplicate:!!target,allowedModes:!target?['create']:target.status==='draft'?['overwrite','alias']:['alias']},
    ...references.map(ref=>({sourceId:richReferenceKey(ref),itemKind:ref.kind,name:ref.name,targetId:ref.targetId,expectedRevision:ref.expectedRevision,duplicate:ref.operation==='reuse',operation:ref.operation,allowedModes:ref.operation==='reuse'?['overwrite'] as const:['create'] as const})),
  ]};
}
async function buildR2Plan(b:R2RuntimeBinding,context:HqTemplateAdapterContext,input:HqTemplateAdapterInput,type:'template'|'rich_menu') {
  const sourceGuards:HqTemplateStatement[]=[];
  let adapter:HqTemplateAdapter,richContext:HqTemplateAdapterContext|undefined;
  if(type==='template')adapter=await messageAdapter(b,context,input,sourceGuards);
  else {
    const definition=parseRichMenuTemplateDefinition(input,b.authority.tenantId);
    if(context.mode==='alias') {
      const names=(await b.db.prepare(`SELECT name FROM rich_menu_groups WHERE account_id=?`).bind(context.targetAccountId).all<{name:string}>()).results.map(r=>r.name);
      let name='';for(let n=2;n<10000;n++){const candidate=`${definition.richMenu.name} (${n})`;if(!names.includes(candidate)){name=candidate;break;}}if(!name)fail('ALIAS_EXHAUSTED');
      context={...context,resolutions:context.resolutions.map(r=>({...r,aliasName:name}))};
    }
    const referencePlan=await planRichReferences(b,definition,context.targetAccountId,true);
    const directKeys=new Set(richMenuReferences(definition).map(richReferenceKey));
    const adapterContext={...context,resolutions:context.resolutions.filter(r=>r.itemKind==='rich_menu'||directKeys.has(r.sourceId))};
    adapter=createRichMenuHqTemplateAdapter({db:b.db,bucket:boundedRichBucket(b),authority:b.authority,input,resolveReference:richResolver(referencePlan,sourceGuards,context)});
    richContext=context;context=adapterContext;
  }
  const refs=ok(await adapter.extractReferences(input)),verified=ok(await adapter.verifyReferences(context,refs));
  const duplicates=ok(await adapter.detectDuplicates(context,verified)),ids=ok(await adapter.buildIdMap(context,verified,duplicates));
  const plan=ok(await adapter.buildCommitPlan(context,input,ids));
  // The adapter's first statement verifies the exact preflight snapshot. Run it
  // before reference clones, then create dependencies before rich-menu rows.
  return type==='rich_menu'
    ? {...plan,resolutions:richContext!.resolutions,dbCommit:[plan.dbCommit[0],...sourceGuards,...plan.dbCommit.slice(1)]}
    : {...plan,dbCommit:[...sourceGuards,...plan.dbCommit]};
}

export interface R2StoreOptions {
  db: D1Database;
  authority: HqTemplateAuthority;
  templateId: string;
  runId: string;
  context: HqTemplateAdapterContext;
  bucket: Bucket;
  publicBaseUrl?: string;
}
export type R2StoreOutcome = { status: HqTemplateDistributionResult['status']; reused: boolean; cleanupPending?: boolean };

const MAX_IO_ATTEMPTS = 3;
const CLAIM_LEASE_MS = 5 * 60_000;

/** R2-backed store with bounded I/O retry. Active R2 claims are never stolen by time alone. */
export async function executeR2RuntimeStore(options: R2StoreOptions): Promise<R2StoreOutcome> {
  const { db, authority, templateId, runId } = options;
  if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED' || options.context.tenantId !== authority.tenantId) fail('FORBIDDEN');
  const p = await db.prepare(`SELECT p.* FROM hq_template_preflights p JOIN hq_templates t ON t.id=p.template_id AND t.tenant_id=p.tenant_id JOIN line_accounts a ON a.id=p.target_account_id AND a.tenant_id=p.tenant_id WHERE p.id=? AND p.tenant_id=? AND p.template_id=? AND p.created_by=? AND t.template_type IN ('template','rich_menu') AND t.archived_at IS NULL AND a.is_active=1 AND a.archived_at IS NULL`).bind(options.context.preflightId, authority.tenantId, templateId, authority.actorId).first<HqTemplatePreflight>();
  if (!p || p.target_account_id !== options.context.targetAccountId || p.idempotency_fingerprint !== runId || options.context.idempotencyFingerprint !== runId || p.snapshot_token !== options.context.snapshotToken) fail('INVALID_PREFLIGHT');
  const rows = (await db.prepare(`SELECT * FROM hq_template_preflight_resolutions WHERE preflight_id=? AND tenant_id=? ORDER BY source_id`).bind(p!.id, authority.tenantId).all<HqTemplatePreflightResolution>()).results;
  if (!rows.length || rows.length !== options.context.resolutions.length || new Set(options.context.resolutions.map(r => r.sourceId)).size !== rows.length) fail('SELECTION_REQUIRED');
  const resolutions = rows.map(row => {
    const selected = options.context.resolutions.find(r => r.sourceId === row.source_id);
    if (!selected || selected.itemKind !== row.item_kind || !['create', 'overwrite', 'alias'].includes(selected.mode) || (selected.targetId !== undefined && selected.targetId !== row.target_id) || (selected.expectedRevision !== undefined && selected.expectedRevision !== row.expected_revision)) fail('SELECTION_REQUIRED');
    return { sourceId: row.source_id, itemKind: row.item_kind, mode: selected!.mode, targetId: row.target_id ?? undefined, expectedRevision: row.expected_revision ?? undefined };
  });
  if (!['create', 'overwrite', 'alias'].includes(options.context.mode)) fail('SELECTION_REQUIRED');
  const context = { ...options.context, resolutions };
  const version = await db.prepare(`SELECT definition_json FROM hq_template_versions WHERE id=? AND template_id=? AND tenant_id=?`).bind(p!.template_version_id, templateId, authority.tenantId).first<{ definition_json: string }>();
  if (!version) fail('VERSION_CONFLICT');
  const input = { templateVersionId: p!.template_version_id, definitionJson: version!.definition_json };
  const read = async () => db.prepare(`SELECT * FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?`).bind(runId, authority.tenantId, context.targetAccountId).first<HqTemplateDistributionResult>();
  const sourceId = JSON.stringify([authority.tenantId, runId, context.targetAccountId]);
  const requestHash = await digest(JSON.stringify([templateId, p!.template_version_id, p!.snapshot_token, context.mode, resolutions.map(r => [r.sourceId, r.itemKind, r.mode])]));
  const checkReceipt = async () => {
    const receipt = await db.prepare(`SELECT after_json,actor_principal_id FROM audit_events WHERE source_kind='hq_template_r2_store_request' AND source_id=? AND tenant_id=?`).bind(sourceId, authority.tenantId).first<{ after_json: string; actor_principal_id: string }>();
    if (!receipt || receipt.actor_principal_id !== authority.actorId || receipt.after_json !== JSON.stringify({ requestHash })) fail('SELECTION_CHANGED');
  };
  const previous = await read();
  if (previous && (previous.template_id !== templateId || previous.template_version_id !== p!.template_version_id || previous.preflight_id !== p!.id || previous.snapshot_token !== p!.snapshot_token || previous.idempotency_fingerprint !== runId)) fail('INVALID_PREFLIGHT');
  if (previous) {
    await checkReceipt();
    if (previous.status === 'staged') {
      const startedAt = Date.parse(previous.started_at);
      if (!Number.isFinite(startedAt) || startedAt > Date.now() - CLAIM_LEASE_MS) return { status: 'staged', reused: true };
      const released = await db.prepare(`UPDATE hq_template_distribution_results SET status='pending',error_code='INTERRUPTED',finished_at=NULL WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=? AND started_at=?`).bind(runId, authority.tenantId, context.targetAccountId, previous.attempt_count, previous.started_at).run();
      if (released.meta.changes !== 1) { const current = await read(); if (!current) fail('RESULT_UNAVAILABLE'); return { status: current!.status, reused: true }; }
    } else if (previous.status !== 'pending') {
      const cleanupPending = !(await reconcileFailedOwnedImages({ ...options, templateVersionId: p!.template_version_id }, runId, context.targetAccountId));
      return { status: previous.status, reused: true, ...(cleanupPending ? { cleanupPending: true } : {}) };
    }
  }
  if (!p!.expires_at || !Number.isFinite(Date.parse(p!.expires_at)) || Date.parse(p!.expires_at) <= Date.now()) {
    const pending = await read();
    if (pending?.status === 'pending') {
      await db.prepare(`UPDATE hq_template_distribution_results SET status='version_conflict',error_code='PREFLIGHT_EXPIRED',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='pending'`).bind(runId, authority.tenantId, context.targetAccountId).run();
      const terminal = await read();
      if (terminal?.status === 'version_conflict') {
        const clean = await reconcileFailedOwnedImages({ ...options, templateVersionId: p!.template_version_id }, runId, context.targetAccountId);
        return { status: 'version_conflict', reused: true, ...(!clean ? {cleanupPending:true} : {}) };
      }
      if (terminal) return { status: terminal.status, reused: true };
    }
    fail('VERSION_CONFLICT');
  }
  const run = await beginHqTemplateDistributionRun(db, { id: runId, tenantId: authority.tenantId, templateId, templateVersionId: p!.template_version_id, idempotencyFingerprint: runId, createdBy: authority.actorId });
  if (run.run.status !== 'running' || run.run.created_by !== authority.actorId) fail('INVALID_RUN');
  // Write receipt before the first claim, so even a crash in pending binds the decision.
  await db.prepare(`INSERT OR IGNORE INTO audit_events(id,source_kind,source_id,tenant_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES (?,'hq_template_r2_store_request',?,?,'business',?,?,'hq_template.store_requested','hq_template',?,'success',?)`).bind(crypto.randomUUID(), sourceId, authority.tenantId, authority.actorId, authority.role, templateId, JSON.stringify({ requestHash })).run();
  await checkReceipt();
  const begun = await beginHqTemplateStoreResult(db, { runId, tenantId: authority.tenantId, templateId, templateVersionId: p!.template_version_id, targetAccountId: context.targetAccountId, preflightId: p!.id, idempotencyFingerprint: runId, snapshotToken: p!.snapshot_token });
  if (begun.kind === 'conflict_or_missing') fail('INVALID_PREFLIGHT');
  const claimed = await db.prepare(`UPDATE hq_template_distribution_results SET status='staged',attempt_count=attempt_count+1,started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),finished_at=NULL,error_code=NULL WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='pending'`).bind(runId, authority.tenantId, context.targetAccountId).run();
  if (claimed.meta.changes !== 1) { const row = await read(); if (!row) fail('RESULT_UNAVAILABLE'); return { status: row!.status, reused: true }; }
  const claimedRow = await read();
  if (!claimedRow || claimedRow.status !== 'staged') fail('RESULT_UNAVAILABLE');
  const attempt = claimedRow!.attempt_count;
  const attemptContext = { ...context, executionAttempt: attempt };
  const claimCondition = `EXISTS(SELECT 1 FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?)`;
  const claimBindings = [runId, authority.tenantId, context.targetAccountId, attempt];
  const renewClaim = async () => {
    const renewed = await db.prepare(`UPDATE hq_template_distribution_results SET started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?`).bind(...claimBindings).run();
    if (renewed.meta.changes !== 1) fail('CLAIM_LOST');
  };
  let plan: HqTemplateStoreAtomicCommitPlan | null = null;
  const binding: R2RuntimeBinding = {...options,templateVersionId:p!.template_version_id};
  try {
    await renewClaim();
    const v = await sourceVersion(binding);
    plan = await buildR2Plan(binding,attemptContext,input,v.template_type);
    await renewClaim();
    if (plan.tenantId !== authority.tenantId || plan.targetAccountId !== context.targetAccountId || plan.preflightId !== p!.id || plan.idempotencyFingerprint !== runId || plan.snapshotToken !== p!.snapshot_token || plan.mode !== context.mode || JSON.stringify(plan.resolutions.map(r => [r.sourceId, r.itemKind, r.mode]).sort()) !== JSON.stringify(resolutions.map(r => [r.sourceId, r.itemKind, r.mode]).sort())) fail('INVALID_PLAN');
    const expectedOwner = await digest(JSON.stringify([context.tenantId,context.targetAccountId,context.preflightId,context.idempotencyFingerprint,attempt]));
    const prefix = v.template_type === 'template' ? 'media' : 'rich-menus';
    const owned = plan.stage.map(o => JSON.stringify([o.key,o.ownerToken])).sort();
    if (new Set(owned).size !== owned.length || JSON.stringify(owned) !== JSON.stringify(plan.compensateOnDbFailure.map(o=>JSON.stringify([o.key,o.ownerToken])).sort()) || JSON.stringify(owned) !== JSON.stringify(plan.reconcile.map(o=>JSON.stringify([o.key,o.ownerToken])).sort())) fail('INVALID_OWNERSHIP_PLAN');
    for (const object of plan.stage) {
      await renewClaim();
      if(object.ownerToken !== expectedOwner || !new RegExp(`^${prefix}/${safeId(context.targetAccountId)}/hq/${expectedOwner}/[a-f0-9]{32}$`).test(object.key)) fail('INVALID_OWNERSHIP_PLAN');
      const key = {runId,tenantId:authority.tenantId,targetAccountId:context.targetAccountId,objectKey:object.key,ownerToken:object.ownerToken};
      if(await recordHqTemplateOwnedR2Key(db,key)==='conflict_or_missing')fail('IMAGE_OWNER_CONFLICT');
      const contentHash=await digest(object.bytes),existing=await options.bucket.head(object.key);
      if(existing) { if(existing.customMetadata?.ownerToken!==object.ownerToken||existing.customMetadata?.contentHash!==contentHash)fail('IMAGE_OWNER_CONFLICT');continue; }
      let written = false;
      for (let putAttempt = 1; putAttempt <= MAX_IO_ATTEMPTS; putAttempt++) {
        await renewClaim();
        try {
          const result=await options.bucket.put(object.key,object.bytes,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{ownerToken:object.ownerToken,contentHash},httpMetadata:{contentType:object.contentType}});
          if(result){written=true;break;}
        } catch {
          // A timed-out PUT may still have committed. Verify the deterministic object.
        }
        const recovered=await options.bucket.head(object.key).catch(()=>null);
        if(recovered?.customMetadata?.ownerToken===object.ownerToken&&recovered.customMetadata.contentHash===contentHash){written=true;break;}
        if(recovered)fail('IMAGE_OWNER_CONFLICT');
        if(putAttempt===MAX_IO_ATTEMPTS)fail('IMAGE_WRITE_FAILED');
      }
      if(!written)fail('IMAGE_WRITE_FAILED');
      await renewClaim();
    }
    await renewClaim();
    const statements: HqTemplateStatement[] = [guard(claimCondition, claimBindings), guard(`EXISTS(SELECT 1 FROM hq_template_preflights WHERE id=? AND tenant_id=? AND status='consumed' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, [p!.id, authority.tenantId]), guard(`EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL)`, [context.targetAccountId, authority.tenantId]), guard(`EXISTS(SELECT 1 FROM hq_template_versions v JOIN hq_templates t ON t.id=v.template_id AND t.tenant_id=v.tenant_id WHERE v.id=? AND v.tenant_id=? AND v.template_id=? AND v.definition_json=? AND t.archived_at IS NULL)`, [input.templateVersionId, authority.tenantId, templateId, input.definitionJson]), guard(`EXISTS(SELECT 1 FROM hq_template_distribution_runs WHERE id=? AND tenant_id=? AND status='running' AND created_by=?)`, [runId, authority.tenantId, authority.actorId]), ...plan.stage.map(o=>guard(`EXISTS(SELECT 1 FROM hq_template_owned_r2_keys WHERE run_id=? AND tenant_id=? AND target_account_id=? AND object_key=? AND owner_token=? AND state='staged')`,[runId,authority.tenantId,context.targetAccountId,o.key,o.ownerToken])), ...plan.dbCommit];
    for (const r of plan.resolutions) statements.push({ sql: `UPDATE hq_template_preflight_resolutions SET resolution_mode=?,target_id=?,expected_revision=?,alias_name=? WHERE preflight_id=? AND tenant_id=? AND source_id=?`, bindings: [r.mode, r.targetId ?? null, r.expectedRevision ?? null, r.aliasName ?? null, p!.id, authority.tenantId, r.sourceId] });
    statements.push({ sql: `UPDATE hq_template_distribution_results SET status='succeeded',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),error_code=NULL WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?`, bindings: claimBindings }, { sql: `INSERT INTO audit_events(id,tenant_id,line_account_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES (?,?,?,'business',?,?,'hq_template.distributed','hq_template',?,'success',?)`, bindings: [crypto.randomUUID(), authority.tenantId, context.targetAccountId, authority.actorId, authority.role, templateId, JSON.stringify({ runId })] });
    for(const o of plan.stage)statements.push({sql:`UPDATE hq_template_owned_r2_keys SET state='committed' WHERE run_id=? AND tenant_id=? AND target_account_id=? AND object_key=? AND owner_token=? AND state='staged'`,bindings:[runId,authority.tenantId,context.targetAccountId,o.key,o.ownerToken]});
    for (let commitAttempt = 1; commitAttempt <= MAX_IO_ATTEMPTS; commitAttempt++) {
      try {
        await db.batch(statements.map(s => db.prepare(s.sql).bind(...s.bindings)));
        const cleanupPending = !(await reconcileFailedOwnedImages(binding,runId,context.targetAccountId));
        return { status: 'succeeded', reused: false, ...(cleanupPending ? {cleanupPending:true} : {}) };
      } catch (error) {
        const row = await read().catch(() => null);
        if (!row) return {status:'staged',reused:false,cleanupPending:!!plan?.stage.length};
        if (row.status !== 'staged' || row.attempt_count !== attempt) {
          const clean = plan ? await cleanupOwnedPlan(binding,runId,context.targetAccountId,plan) : true;
          return { status: row.status, reused: true, ...(!clean ? {cleanupPending:true} : {}) };
        }
        if (commitAttempt === MAX_IO_ATTEMPTS) throw error;
      }
    }
    return fail('STORE_COMMIT_FAILED');
  } catch (error) {
    // A successful batch may lose its response. Never replay the business writes.
    const row = await read().catch(() => null);
    if (!row) return {status:'staged',reused:false,cleanupPending:!!plan?.stage.length};
    if (row!.status !== 'staged' || row!.attempt_count !== attempt) {
      const clean = plan ? await cleanupOwnedPlan(binding,runId,context.targetAccountId,plan) : true;
      return { status: row!.status, reused: true, ...(!clean ? {cleanupPending:true} : {}) };
    }
    const code = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : '';
    const status = code.includes('UNSUPPORTED') ? 'unsupported' : code === 'VERSION_CONFLICT' ? 'version_conflict' : 'failed';
    await db.prepare(`UPDATE hq_template_distribution_results SET status=?,error_code=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?`).bind(status, status === 'unsupported' ? 'UNSUPPORTED_REFERENCE' : status === 'version_conflict' ? 'VERSION_CONFLICT' : code ? 'STORE_PLAN_FAILED' : 'STORE_COMMIT_FAILED', ...claimBindings).run();
    const cleanupPending = plan ? !(await cleanupOwnedPlan(binding,runId,context.targetAccountId,plan)) : false;
    return { status, reused: false, ...(cleanupPending ? {cleanupPending:true} : {}) };
  }
}

/** Retry cleanup from the durable ownership ledger without trusting request input. */
export async function reconcileFailedOwnedImages(b:R2RuntimeBinding,runId:string,account:string):Promise<boolean> {
  const result=await b.db.prepare(`SELECT status FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?`).bind(runId,b.authority.tenantId,account).first<{status:string}>().catch(()=>null);
  if(!result||result.status==='pending'||result.status==='staged')return false;
  const rows=(await b.db.prepare(`SELECT object_key,owner_token,state FROM hq_template_owned_r2_keys WHERE run_id=? AND tenant_id=? AND target_account_id=? AND state IN ('staged','cleanup_pending','cleaned') ORDER BY object_key`).bind(runId,b.authority.tenantId,account).all<{object_key:string;owner_token:string;state:'staged'|'cleanup_pending'|'cleaned'}>()).results;
  let clean=true;
  for(const row of rows)try {
    const key={runId,tenantId:b.authority.tenantId,targetAccountId:account,objectKey:row.object_key,ownerToken:row.owner_token};
    if(row.state==='staged'&&!await setHqTemplateOwnedR2KeyState(b.db,{...key,expectedState:'staged',state:'cleanup_pending'})){clean=false;continue;}
    const used=await b.db.prepare(`SELECT 1 AS used WHERE EXISTS(SELECT 1 FROM media WHERE r2_key=?) OR EXISTS(SELECT 1 FROM media_versions WHERE r2_key=?) OR EXISTS(SELECT 1 FROM rich_menu_pages WHERE image_r2_key=?)`).bind(row.object_key,row.object_key,row.object_key).first();
    if(used){clean=false;continue;}
    const current=await b.bucket.head(row.object_key);
    if(current&&current.customMetadata?.ownerToken!==row.owner_token){clean=false;continue;}
    if(current)await b.bucket.delete(row.object_key);
    if(row.state!=='cleaned'&&!await setHqTemplateOwnedR2KeyState(b.db,{...key,expectedState:'cleanup_pending',state:'cleaned'}))clean=false;
  } catch {clean=false;}
  return clean;
}


/** Clean only the unreferenced keys owned by one fenced attempt. */
async function cleanupOwnedPlan(b:R2RuntimeBinding,runId:string,account:string,plan:HqTemplateStoreAtomicCommitPlan):Promise<boolean> {
  let clean=true;
  for(const object of plan.stage)try {
    const key={runId,tenantId:b.authority.tenantId,targetAccountId:account,objectKey:object.key,ownerToken:object.ownerToken};
    const ledger=await b.db.prepare(`SELECT state FROM hq_template_owned_r2_keys WHERE run_id=? AND tenant_id=? AND target_account_id=? AND object_key=? AND owner_token=?`).bind(runId,b.authority.tenantId,account,object.key,object.ownerToken).first<{state:'staged'|'committed'|'cleanup_pending'|'cleaned'|'reconciled'}>();
    if(!ledger)continue;
    if(ledger.state==='committed'||ledger.state==='reconciled')continue;
    if(ledger.state==='staged'&&!await setHqTemplateOwnedR2KeyState(b.db,{...key,expectedState:'staged',state:'cleanup_pending'})){clean=false;continue;}
    const used=await b.db.prepare(`SELECT 1 AS used WHERE EXISTS(SELECT 1 FROM media WHERE r2_key=?) OR EXISTS(SELECT 1 FROM media_versions WHERE r2_key=?) OR EXISTS(SELECT 1 FROM rich_menu_pages WHERE image_r2_key=?)`).bind(object.key,object.key,object.key).first();
    if(used){clean=false;continue;}
    const current=await b.bucket.head(object.key);
    if(current && (current.customMetadata?.ownerToken!==object.ownerToken || current.customMetadata?.contentHash!==await digest(object.bytes))){clean=false;continue;}
    if(current)await b.bucket.delete(object.key);
    if(ledger.state!=='cleaned'&&!await setHqTemplateOwnedR2KeyState(b.db,{...key,expectedState:'cleanup_pending',state:'cleaned'}))clean=false;
  } catch {clean=false;}
  return clean;
}
