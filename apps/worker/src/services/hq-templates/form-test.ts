import { fieldsToLayout, validateAnswers } from '@line-crm/shared';
import { templateDetail, HqTemplateError } from './distribution.js';
import { parseFormTemplateDefinition } from './form.js';
import type { HqTemplateAuthority } from './contract.js';

/** Exercise the saved HQ definition with the same validator as the store, without sending or writing answers. */
export async function testHqForm(db: D1Database, authority: HqTemplateAuthority, id: string, input: Record<string,unknown>) {
  const {template,definition}=await templateDetail(db,authority,id);
  if(template.template_type!=='form')throw new HqTemplateError('INVALID_TYPE');
  if(input.expectedRevision!==undefined&&input.expectedRevision!==template.revision)throw new HqTemplateError('VERSION_CONFLICT',409);
  const parsed=parseFormTemplateDefinition({templateVersionId:template.current_version_id!,definitionJson:JSON.stringify(definition)});
  const layout=parsed.form.layout??fieldsToLayout(parsed.form.fields);
  if(input.answers!==undefined&&(!input.answers||typeof input.answers!=='object'||Array.isArray(input.answers)))throw new HqTemplateError('INVALID_ANSWERS');
  const validationError=input.answers===undefined?null:validateAnswers(layout,input.answers as Record<string,unknown>);
  return {dryRun:true,sent:0,persistsAnswers:false,templateId:id,templateVersionId:template.current_version_id,revision:template.revision,
    form:{name:parsed.form.name,description:parsed.form.description,fields:parsed.form.fields,layout},
    answerValidation:input.answers===undefined?null:{valid:validationError===null,error:validationError},
    testUrl:null,testUrlUnavailableReason:'USE_TEST_TOKEN_ENDPOINT'};
}

async function tokenHash(token:string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}

/** Issue a capability for one immutable version. The conditional insert enforces the cap atomically. */
export async function issueHqFormTestToken(db:D1Database,authority:HqTemplateAuthority,id:string,input:Record<string,unknown>,origin:string) {
  if(!Number.isSafeInteger(input.expectedRevision))throw new HqTemplateError('INVALID_REVISION');
  const checked=await testHqForm(db,authority,id,input),token=`${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const tokenId=crypto.randomUUID(),now=new Date().toISOString(),expiresAt=new Date(Date.now()+24*3600_000).toISOString();
  const result=await db.prepare(`INSERT INTO hq_form_test_tokens(id,tenant_id,template_id,template_version_id,token_hash,created_by_staff_id,expires_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM hq_templates WHERE id=? AND tenant_id=? AND revision=? AND current_version_id=? AND archived_at IS NULL)
    AND (SELECT COUNT(*) FROM hq_form_test_tokens WHERE tenant_id=? AND template_id=? AND expires_at>? AND revoked_at IS NULL)<5`)
    .bind(tokenId,authority.tenantId,id,checked.templateVersionId,await tokenHash(token),authority.actorId,expiresAt,id,authority.tenantId,checked.revision,checked.templateVersionId,authority.tenantId,id,now).run();
  if(!result.meta.changes)throw new HqTemplateError('TEST_TOKEN_LIMIT_OR_VERSION_CONFLICT',409);
  const url=new URL(`/api/liff/hq-form-tests/${encodeURIComponent(id)}`,origin);url.searchParams.set('test_token',token);
  return {id:tokenId,token,expiresAt,templateId:id,templateVersionId:checked.templateVersionId,revision:checked.revision,testUrl:url.href,dryRun:true,sent:0,persistsAnswers:false};
}

export async function revokeHqFormTestToken(db:D1Database,authority:HqTemplateAuthority,id:string,tokenId:string) {
  await templateDetail(db,authority,id);
  const r=await db.prepare(`UPDATE hq_form_test_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND template_id=? AND tenant_id=?`)
    .bind(new Date().toISOString(),tokenId,id,authority.tenantId).run();
  if(!r.meta.changes)throw new HqTemplateError('NOT_FOUND',404);
  return {id:tokenId,revoked:true};
}

/** Bearer capability only; no staff session or LINE identity and no answer/event writes. */
export async function readHqFormTest(db:D1Database,id:string,token:string|null,answers?:unknown) {
  if(!token||token.length>200)throw new HqTemplateError('NOT_FOUND',404);
  const row=await db.prepare(`SELECT v.definition_json,v.id version_id FROM hq_form_test_tokens x
    JOIN hq_templates t ON t.id=x.template_id AND t.tenant_id=x.tenant_id
    JOIN hq_template_versions v ON v.id=x.template_version_id AND v.template_id=t.id AND v.tenant_id=t.tenant_id
    JOIN tenants o ON o.id=x.tenant_id
    JOIN staff_members s ON s.id=x.created_by_staff_id AND s.tenant_id=x.tenant_id
    WHERE x.template_id=? AND x.token_hash=? AND julianday(x.expires_at)>julianday(?) AND x.revoked_at IS NULL
      AND t.template_type='form' AND t.archived_at IS NULL AND o.status='active'
      AND s.is_active=1 AND s.role IN ('owner','admin') AND s.account_scope='all' AND s.access_level!='read_only'`)
    .bind(id,await tokenHash(token),new Date().toISOString()).first<{definition_json:string;version_id:string}>();
  if(!row)throw new HqTemplateError('NOT_FOUND',404);
  const {form}=parseFormTemplateDefinition({templateVersionId:row.version_id,definitionJson:row.definition_json});
  const layout=form.layout??fieldsToLayout(form.fields);
  if(answers!==undefined&&(!answers||typeof answers!=='object'||Array.isArray(answers)))throw new HqTemplateError('INVALID_ANSWERS');
  const error=answers===undefined?null:validateAnswers(layout,answers as Record<string,unknown>);
  return {templateId:id,templateVersionId:row.version_id,dryRun:true,sent:0,persistsAnswers:false,
    form:{name:form.name,description:form.description,fields:form.fields,layout},answerValidation:answers===undefined?null:{valid:error===null,error}};
}
