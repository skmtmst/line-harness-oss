import { beginHqTemplateDistributionRun, beginHqTemplateStoreResult, recordHqTemplateOwnedR2Key, setHqTemplateOwnedR2KeyState, normalizeScopedTagName, type HqTemplateDistributionResult, type HqTemplatePreflight, type HqTemplatePreflightResolution, type HqTemplateStatement } from '@line-crm/db';
import { requireHqTemplateAuthority, type HqTemplateAdapter, type HqTemplateAdapterContext, type HqTemplateAdapterInput, type HqTemplateAdapterResult, type HqTemplateAuthority, type HqTemplateSnapshotToken, type HqTemplateStoreAtomicCommitPlan } from './contract.js';
import { createTemplateHqTemplateAdapter, parseMessageTemplateDefinition, inspectMessageTemplateDefinition, readMessageTemplateSourceBytes, type MessageTemplateTargetSnapshot, type MessageTemplateSourceMediaBinding, type MessageTemplateAdapterDependencies } from './template.js';
import { createRichMenuHqTemplateAdapter, parseRichMenuTemplateDefinition } from './rich-menu.js';

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
/** Only already-existing, exclusively scoped references. No hidden reference writes. */
function richResolver(b:R2RuntimeBinding,sourceGuards:HqTemplateStatement[]) {
  return async (ref:{kind:string;sourceId:string},account:string):Promise<string|null> => {
    if (!['tag','form','template'].includes(ref.kind)) fail('UNSUPPORTED_REFERENCE');
    await targetAccount(b,account);
    let source:{name:string}|null;
    let targets:{id:string;name:string}[];
    if(ref.kind==='form') {
      const sql=`SELECT f.name FROM forms f WHERE f.id=? AND EXISTS(SELECT 1 FROM form_accounts fa JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=f.id AND a.tenant_id=?) AND NOT EXISTS(SELECT 1 FROM form_accounts fa LEFT JOIN line_accounts a ON a.id=fa.line_account_id WHERE fa.form_id=f.id AND (a.tenant_id IS NULL OR a.tenant_id<>?))`;
      source=await b.db.prepare(sql).bind(ref.sourceId,b.authority.tenantId,b.authority.tenantId).first();
      targets=(await b.db.prepare(`SELECT f.id,f.name FROM forms f WHERE f.status<>'archived' AND EXISTS(SELECT 1 FROM form_accounts fa WHERE fa.form_id=f.id AND fa.line_account_id=?) AND NOT EXISTS(SELECT 1 FROM form_accounts fa WHERE fa.form_id=f.id AND fa.line_account_id<>?) ORDER BY f.id`).bind(account,account).all<{id:string;name:string}>()).results;
      if(source)sourceGuards.push(guard(`EXISTS(SELECT 1 FROM (${sql}) WHERE name=?)`,[ref.sourceId,b.authority.tenantId,b.authority.tenantId,source.name]));
    } else {
      const table=ref.kind==='tag'?'tags':'templates', active=ref.kind==='tag'?" AND t.status='active'":'';
      const sql=`SELECT t.name FROM ${table} t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL${active}`;
      source=await b.db.prepare(sql).bind(ref.sourceId,b.authority.tenantId).first();
      targets=(await b.db.prepare(`SELECT id,name FROM ${table} WHERE line_account_id=?${ref.kind==='tag'?" AND status='active'":''} ORDER BY id`).bind(account).all<{id:string;name:string}>()).results;
      if(source)sourceGuards.push(guard(`EXISTS(SELECT 1 FROM (${sql}) WHERE name=?)`,[ref.sourceId,b.authority.tenantId,source.name]));
    }
    if(!source)fail('REFERENCE_UNAVAILABLE');
    const matches=targets.filter(t=>normalizeScopedTagName(t.name)===normalizeScopedTagName(source!.name));
    if(matches.length!==1)fail('REFERENCE_UNAVAILABLE');
    return matches[0].id;
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
  const source=await b.db.prepare(`SELECT t.line_account_id FROM templates t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(definition.template.id,b.authority.tenantId).first<{line_account_id:string}>();
  if(!source)fail('SOURCE_ACCOUNT_UNAVAILABLE');
  const sourceAccountId=source!.line_account_id;
  sourceGuards.push(guard(`EXISTS(SELECT 1 FROM templates t JOIN line_accounts a ON a.id=t.line_account_id WHERE t.id=? AND t.line_account_id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL)`,[definition.template.id,sourceAccountId,b.authority.tenantId]));
  const bindings:MessageTemplateSourceMediaBinding[]=[];
  for(const media of definition.media) {
    const row=await b.db.prepare(`SELECT v.content_hash,v.etag FROM media_versions v JOIN media m ON m.id=v.media_id JOIN line_accounts a ON a.id=m.line_account_id WHERE v.id=? AND v.media_id=? AND v.version_no=? AND v.size_bytes=? AND m.line_account_id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL`).bind(media.versionId,media.id,media.versionNo,media.sizeBytes,sourceAccountId,b.authority.tenantId).first<{content_hash:string;etag:string|null}>();
    if(!row||normalizeSha256(row.content_hash)!==normalizeSha256(media.contentHash)||!normalizeSha256(media.contentHash))fail('SOURCE_MEDIA_UNAVAILABLE');
    const key=sourceKey(media.r2Key,b.authority.tenantId),object=await b.bucket.head(key);
    if(!object||object.size!==media.sizeBytes)fail('SOURCE_MEDIA_UNAVAILABLE');
    bindings.push({tenantId:b.authority.tenantId,templateVersionId:b.templateVersionId,sourceAccountId,mediaId:media.id,mediaVersionId:media.versionId,versionNo:media.versionNo,r2Key:key,r2KeyPrefix:`hq-templates/${b.authority.tenantId}`,sizeBytes:media.sizeBytes,contentHash:media.contentHash,etag:object!.etag});
    sourceGuards.push(guard(`EXISTS(SELECT 1 FROM media_versions v JOIN media m ON m.id=v.media_id JOIN line_accounts a ON a.id=m.line_account_id WHERE v.id=? AND v.media_id=? AND v.version_no=? AND v.size_bytes=? AND v.content_hash=? AND m.line_account_id=? AND a.tenant_id=? AND a.is_active=1 AND a.archived_at IS NULL)`,[media.versionId,media.id,media.versionNo,media.sizeBytes,row!.content_hash,sourceAccountId,b.authority.tenantId]));
  }
  const owner=await digest(JSON.stringify([context.tenantId,context.targetAccountId,context.preflightId,context.idempotencyFingerprint]));
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
  const adapter=createRichMenuHqTemplateAdapter({db:b.db,bucket:boundedRichBucket(b),authority:b.authority,input,resolveReference:richResolver(b,[])});
  const rows=(await b.db.prepare(`SELECT id,name,status,updated_at FROM rich_menu_groups WHERE account_id=? ORDER BY id`).bind(targetAccountId).all<{id:string;name:string;status:string;updated_at:string}>()).results.filter(r=>r.name===definition.richMenu.name);
  if(rows.length>1)fail('AMBIGUOUS_TARGET');const target=rows[0];
  return {type:v.template_type,snapshotToken:await adapter.snapshot(targetAccountId),items:[{sourceId:definition.richMenu.id,itemKind:'rich_menu',name:definition.richMenu.name,targetId:target?.id??null,expectedRevision:target?.updated_at??null,duplicate:!!target,allowedModes:!target?['create']:target.status==='draft'?['overwrite','alias']:['alias']}]};
}
async function buildR2Plan(b:R2RuntimeBinding,context:HqTemplateAdapterContext,input:HqTemplateAdapterInput,type:'template'|'rich_menu') {
  const sourceGuards:HqTemplateStatement[]=[];
  let adapter:HqTemplateAdapter;
  if(type==='template')adapter=await messageAdapter(b,context,input,sourceGuards);
  else {
    const definition=parseRichMenuTemplateDefinition(input,b.authority.tenantId);
    if(context.mode==='alias') {
      const names=(await b.db.prepare(`SELECT name FROM rich_menu_groups WHERE account_id=?`).bind(context.targetAccountId).all<{name:string}>()).results.map(r=>r.name);
      let name='';for(let n=2;n<10000;n++){const candidate=`${definition.richMenu.name} (${n})`;if(!names.includes(candidate)){name=candidate;break;}}if(!name)fail('ALIAS_EXHAUSTED');
      context={...context,resolutions:context.resolutions.map(r=>({...r,aliasName:name}))};
    }
    adapter=createRichMenuHqTemplateAdapter({db:b.db,bucket:boundedRichBucket(b),authority:b.authority,input,resolveReference:richResolver(b,sourceGuards)});
  }
  const refs=ok(await adapter.extractReferences(input)),verified=ok(await adapter.verifyReferences(context,refs));
  const duplicates=ok(await adapter.detectDuplicates(context,verified)),ids=ok(await adapter.buildIdMap(context,verified,duplicates));
  const plan=ok(await adapter.buildCommitPlan(context,input,ids));return {...plan,dbCommit:[...sourceGuards,...plan.dbCommit]};
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
    if (previous.status !== 'pending') {
      const cleanupPending = previous.status === 'failed' ? !(await reconcileFailedOwnedImages({ ...options, templateVersionId: p!.template_version_id }, runId, context.targetAccountId)) : false;
      return { status: previous.status, reused: true, ...(cleanupPending ? { cleanupPending: true } : {}) };
    }
  }
  if (!p!.expires_at || !Number.isFinite(Date.parse(p!.expires_at)) || Date.parse(p!.expires_at) <= Date.now()) fail('VERSION_CONFLICT');
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
  const claimCondition = `EXISTS(SELECT 1 FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?)`;
  const claimBindings = [runId, authority.tenantId, context.targetAccountId, attempt];
  let plan: HqTemplateStoreAtomicCommitPlan | null = null;
  const binding: R2RuntimeBinding = {...options,templateVersionId:p!.template_version_id};
  try {
    const v = await sourceVersion(binding);
    plan = await buildR2Plan(binding,context,input,v.template_type);
    if (plan.tenantId !== authority.tenantId || plan.targetAccountId !== context.targetAccountId || plan.preflightId !== p!.id || plan.idempotencyFingerprint !== runId || plan.snapshotToken !== p!.snapshot_token || plan.mode !== context.mode || JSON.stringify(plan.resolutions.map(r => [r.sourceId, r.itemKind, r.mode]).sort()) !== JSON.stringify(resolutions.map(r => [r.sourceId, r.itemKind, r.mode]).sort())) fail('INVALID_PLAN');
    const expectedOwner = await digest(JSON.stringify([context.tenantId,context.targetAccountId,context.preflightId,context.idempotencyFingerprint]));
    const prefix = v.template_type === 'template' ? 'media' : 'rich-menus';
    const owned = plan.stage.map(o => JSON.stringify([o.key,o.ownerToken])).sort();
    if (new Set(owned).size !== owned.length || JSON.stringify(owned) !== JSON.stringify(plan.compensateOnDbFailure.map(o=>JSON.stringify([o.key,o.ownerToken])).sort()) || JSON.stringify(owned) !== JSON.stringify(plan.reconcile.map(o=>JSON.stringify([o.key,o.ownerToken])).sort())) fail('INVALID_OWNERSHIP_PLAN');
    for (const object of plan.stage) {
      if(object.ownerToken !== expectedOwner || !new RegExp(`^${prefix}/${safeId(context.targetAccountId)}/hq/${expectedOwner}/[a-f0-9]{32}$`).test(object.key)) fail('INVALID_OWNERSHIP_PLAN');
      const key = {runId,tenantId:authority.tenantId,targetAccountId:context.targetAccountId,objectKey:object.key,ownerToken:object.ownerToken};
      if(await recordHqTemplateOwnedR2Key(db,key)==='conflict_or_missing')fail('IMAGE_OWNER_CONFLICT');
      const contentHash=await digest(object.bytes),existing=await options.bucket.head(object.key);
      if(existing) { if(existing.customMetadata?.ownerToken!==object.ownerToken||existing.customMetadata?.contentHash!==contentHash)fail('IMAGE_OWNER_CONFLICT');continue; }
      let written = false;
      for (let putAttempt = 1; putAttempt <= MAX_IO_ATTEMPTS; putAttempt++) {
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
    }
    const statements: HqTemplateStatement[] = [guard(claimCondition, claimBindings), guard(`EXISTS(SELECT 1 FROM hq_template_preflights WHERE id=? AND tenant_id=? AND status='consumed' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, [p!.id, authority.tenantId]), guard(`EXISTS(SELECT 1 FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL)`, [context.targetAccountId, authority.tenantId]), guard(`EXISTS(SELECT 1 FROM hq_template_versions v JOIN hq_templates t ON t.id=v.template_id AND t.tenant_id=v.tenant_id WHERE v.id=? AND v.tenant_id=? AND v.template_id=? AND v.definition_json=? AND t.archived_at IS NULL)`, [input.templateVersionId, authority.tenantId, templateId, input.definitionJson]), guard(`EXISTS(SELECT 1 FROM hq_template_distribution_runs WHERE id=? AND tenant_id=? AND status='running' AND created_by=?)`, [runId, authority.tenantId, authority.actorId]), ...plan.stage.map(o=>guard(`EXISTS(SELECT 1 FROM hq_template_owned_r2_keys WHERE run_id=? AND tenant_id=? AND target_account_id=? AND object_key=? AND owner_token=? AND state='staged')`,[runId,authority.tenantId,context.targetAccountId,o.key,o.ownerToken])), ...plan.dbCommit];
    for (const r of plan.resolutions) statements.push({ sql: `UPDATE hq_template_preflight_resolutions SET resolution_mode=?,target_id=?,expected_revision=?,alias_name=? WHERE preflight_id=? AND tenant_id=? AND source_id=?`, bindings: [r.mode, r.targetId ?? null, r.expectedRevision ?? null, r.aliasName ?? null, p!.id, authority.tenantId, r.sourceId] });
    statements.push({ sql: `UPDATE hq_template_distribution_results SET status='succeeded',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),error_code=NULL WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?`, bindings: claimBindings }, { sql: `INSERT INTO audit_events(id,tenant_id,line_account_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES (?,?,?,'business',?,?,'hq_template.distributed','hq_template',?,'success',?)`, bindings: [crypto.randomUUID(), authority.tenantId, context.targetAccountId, authority.actorId, authority.role, templateId, JSON.stringify({ runId })] });
    for(const o of plan.stage)statements.push({sql:`UPDATE hq_template_owned_r2_keys SET state='committed' WHERE run_id=? AND tenant_id=? AND target_account_id=? AND object_key=? AND owner_token=? AND state='staged'`,bindings:[runId,authority.tenantId,context.targetAccountId,o.key,o.ownerToken]});
    for (let commitAttempt = 1; commitAttempt <= MAX_IO_ATTEMPTS; commitAttempt++) {
      try {
        await db.batch(statements.map(s => db.prepare(s.sql).bind(...s.bindings)));
        return { status: 'succeeded', reused: false };
      } catch (error) {
        const row = await read().catch(() => null);
        if (!row) return {status:'staged',reused:false,cleanupPending:!!plan?.stage.length};
        if (row.status !== 'staged' || row.attempt_count !== attempt) return { status: row.status, reused: true };
        if (commitAttempt === MAX_IO_ATTEMPTS) throw error;
      }
    }
    return fail('STORE_COMMIT_FAILED');
  } catch (error) {
    // A successful batch may lose its response. Never replay the business writes.
    const row = await read().catch(() => null);
    if (!row) return {status:'staged',reused:false,cleanupPending:!!plan?.stage.length};
    if (row!.status !== 'staged' || row!.attempt_count !== attempt) return { status: row!.status, reused: true };
    const code = error instanceof Error && 'code' in error ? String(error.code) : error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : '';
    const status = code.includes('UNSUPPORTED') ? 'unsupported' : code === 'VERSION_CONFLICT' ? 'version_conflict' : 'failed';
    await db.prepare(`UPDATE hq_template_distribution_results SET status=?,error_code=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=? AND tenant_id=? AND target_account_id=? AND status='staged' AND attempt_count=?`).bind(status, status === 'unsupported' ? 'UNSUPPORTED_REFERENCE' : status === 'version_conflict' ? 'VERSION_CONFLICT' : code ? 'STORE_PLAN_FAILED' : 'STORE_COMMIT_FAILED', ...claimBindings).run();
    const cleanupPending = status === 'failed' && plan ? !(await cleanupFailedOwnedImages(binding,runId,context.targetAccountId,plan)) : false;
    return { status, reused: false, ...(cleanupPending ? {cleanupPending:true} : {}) };
  }
}

/** Retry cleanup from the durable ownership ledger without trusting request input. */
export async function reconcileFailedOwnedImages(b:R2RuntimeBinding,runId:string,account:string):Promise<boolean> {
  const result=await b.db.prepare(`SELECT status FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?`).bind(runId,b.authority.tenantId,account).first<{status:string}>().catch(()=>null);
  if(result?.status!=='failed')return false;
  const rows=(await b.db.prepare(`SELECT object_key,owner_token,state FROM hq_template_owned_r2_keys WHERE run_id=? AND tenant_id=? AND target_account_id=? AND state IN ('staged','cleanup_pending') ORDER BY object_key`).bind(runId,b.authority.tenantId,account).all<{object_key:string;owner_token:string;state:'staged'|'cleanup_pending'}>()).results;
  let clean=true;
  for(const row of rows)try {
    const key={runId,tenantId:b.authority.tenantId,targetAccountId:account,objectKey:row.object_key,ownerToken:row.owner_token};
    if(row.state==='staged'&&!await setHqTemplateOwnedR2KeyState(b.db,{...key,expectedState:'staged',state:'cleanup_pending'})){clean=false;continue;}
    const used=await b.db.prepare(`SELECT 1 AS used WHERE EXISTS(SELECT 1 FROM media WHERE r2_key=?) OR EXISTS(SELECT 1 FROM media_versions WHERE r2_key=?) OR EXISTS(SELECT 1 FROM rich_menu_pages WHERE image_r2_key=?)`).bind(row.object_key,row.object_key,row.object_key).first();
    if(used){clean=false;continue;}
    const current=await b.bucket.head(row.object_key);
    if(current&&current.customMetadata?.ownerToken!==row.owner_token){clean=false;continue;}
    if(current)await b.bucket.delete(row.object_key);
    if(!await setHqTemplateOwnedR2KeyState(b.db,{...key,expectedState:'cleanup_pending',state:'cleaned'}))clean=false;
  } catch {clean=false;}
  return clean;
}


/** Only a terminal failed attempt can clean its own unreferenced image keys. */
async function cleanupFailedOwnedImages(b:R2RuntimeBinding,runId:string,account:string,plan:HqTemplateStoreAtomicCommitPlan):Promise<boolean> {
  const result=await b.db.prepare(`SELECT status FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?`).bind(runId,b.authority.tenantId,account).first<{status:string}>().catch(()=>null);
  if(result?.status!=='failed')return plan.stage.length===0;
  let clean=true;
  for(const object of plan.stage)try {
    const key={runId,tenantId:b.authority.tenantId,targetAccountId:account,objectKey:object.key,ownerToken:object.ownerToken};
    if(!await setHqTemplateOwnedR2KeyState(b.db,{...key,expectedState:'staged',state:'cleanup_pending'})){clean=false;continue;}
    const used=await b.db.prepare(`SELECT 1 AS used WHERE EXISTS(SELECT 1 FROM media WHERE r2_key=?) OR EXISTS(SELECT 1 FROM media_versions WHERE r2_key=?) OR EXISTS(SELECT 1 FROM rich_menu_pages WHERE image_r2_key=?)`).bind(object.key,object.key,object.key).first();
    if(used){clean=false;continue;}
    const current=await b.bucket.head(object.key);
    if(current && (current.customMetadata?.ownerToken!==object.ownerToken || current.customMetadata?.contentHash!==await digest(object.bytes))){clean=false;continue;}
    if(current)await b.bucket.delete(object.key);
    if(!await setHqTemplateOwnedR2KeyState(b.db,{...key,expectedState:'cleanup_pending',state:'cleaned'}))clean=false;
  } catch {clean=false;}
  return clean;
}
