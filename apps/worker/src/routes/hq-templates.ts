import { isFriendAttributeType, preflightFriendAttribute, distributeFriendAttribute, friendAttributeResult } from '../services/hq-templates/friend-attribute-distribution.js';
import { TEMPLATE_KINDS, type TemplateKindCounts, type TemplateKind } from '@line-crm/shared';
import { listTemplateFolders, saveTemplateFolder, deleteTemplateFolder, duplicateTemplate } from '../services/hq-templates/folders.js';
import { listMessageReferences } from '../services/hq-templates/message-card-references.js';
import { deleteHqImage, uploadHqImage, uploadHqImagemap } from '../services/hq-templates/authoring-media.js';
import { TemplateHqTemplateError } from '../services/hq-templates/template.js';
import { Hono, type Context } from 'hono';
import { HQ_TEMPLATE_TYPES, getStaffById, getHqTemplate, type HqTemplateType } from '@line-crm/db';
import { dbFor } from '../services/db-router.js';
import type { Env } from '../index.js';
import { requireHqTemplateAuthority, type HqTemplateAuthority } from '../services/hq-templates/contract.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  templateVersions, compareTemplateVersions, restoreTemplateVersion, templateReceivedVersions,
  HqTemplateError, templateCreationRequestId, listTemplates, listTemplateAccounts, templateDetail, saveTemplate, deleteTemplate,
  preflightDistribution, distributeTemplate, distributionResult, type DistributionSelection,
} from '../services/hq-templates/distribution.js';

export const hqTemplates = new Hono<Env>();
async function authority(c: Context<Env>): Promise<HqTemplateAuthority> {
  const staff = c.get('staff');
  if (!staff || !staff.tenantId) throw new HqTemplateError('FORBIDDEN', 403);
  const member = await getStaffById(dbFor(c.env), staff.id);
  // A missing database identity does not turn into a tenant-wide administrator.
  if (!member || member.is_active !== 1 || member.tenant_id !== staff.tenantId) throw new HqTemplateError('FORBIDDEN', 403);
  const auth = requireHqTemplateAuthority({ tenantId: staff.tenantId, actorId: staff.id,
    role: member.role, readOnly: !['GET','HEAD'].includes(c.req.method) && (staff.readOnly || member.access_level === 'read_only'), accountScoped: member.account_scope === 'accounts' });
  if (auth.kind !== 'AUTHORIZED') throw new HqTemplateError('FORBIDDEN', 403);
  return auth.authority;
}
const reasons: Record<string, string> = {
  CARD_REFERENCE_UNAVAILABLE: '配り先に同じ名前のフォーム・シナリオが1件だけあるか、フォーム用のLIFFが設定されているか確認してください',
  INVALID_REQUEST_ID: '作成依頼の識別情報を確認してください',
  IDEMPOTENCY_CONFLICT: '同じ作成依頼の内容が変わっています。元の内容で再確認してください',
  CREATE_RECEIPT_UNAVAILABLE: '作成済みの記録を確認できません。一覧から状態を確認してください',
  FOLDER_NAME_CONFLICT: '同じ名前の分類があります',
  FORBIDDEN: '統括の編集権限が必要です', NOT_FOUND: '対象が見つかりません', INVALID_IMAGE: '画像の指定を確認してください',
  UNSUPPORTED: 'この種類のひな形はまだ利用できません',
  VERSION_CONFLICT: '編集がありました。もう一度確認してください',
  SELECTION_REQUIRED: '重複した項目ごとに上書きか別名を選んでください',
  SELECTION_CHANGED: '実行済みの選択は変更できません。結果を確認してください',
  FOLDER_SELECTION_CONFLICT: '親フォルダを別名にする場合は、子フォルダも別名にしてください',
};
async function body(c: { req: { text(): Promise<string> } }): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (text.length > 2_000_000) throw new HqTemplateError('REQUEST_TOO_LARGE');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new HqTemplateError('INVALID_REQUEST'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HqTemplateError('INVALID_REQUEST');
  return value as Record<string, unknown>;
}
hqTemplates.onError((error, c) => {
  const typed = error instanceof HqTemplateError, code = typed ? error.code : 'UNAVAILABLE';
  return c.json({ success: false, code, error: reasons[code] ?? (typed && error.status < 500 ? '入力内容を確認してください' : '処理結果を確認できません。再確認してください') }, typed ? error.status : 500);
});
// The route-local boundary also protects direct route mounting in tests/other apps.
hqTemplates.use('/api/hq/templates/*', requireRole('owner', 'admin'), async (c, next) => {
  try { await authority(c); await next(); }
  catch (error) {
    const typed = error instanceof HqTemplateError;
    const code = typed ? error.code : 'UNAVAILABLE';
    return c.json({ success: false, error: reasons[code] ?? (typed && error.status < 500 ? '入力内容を確認してください' : '処理結果を確認できません。しばらくしてから再確認してください'), code }, typed ? error.status : 500);
  }
});
hqTemplates.post('/api/hq/templates/media', async c => {
  const auth = await authority(c);
  try {
    const data = c.req.query('purpose')==='rich_message'
      ? await uploadHqImagemap(c.env, auth, c.req.raw, c.env.WORKER_URL || new URL(c.req.url).origin)
      : await uploadHqImage(c.env.IMAGES, auth, c.req.raw, c.env.WORKER_URL || new URL(c.req.url).origin);
    return c.json({ success: true, data }, 201);
  } catch (error) {
    if (error instanceof TemplateHqTemplateError) throw new HqTemplateError(error.code, 422);
    throw error;
  }
});
// R568: reclaim an upload that was never adopted. Ownership is verified
// inside deleteHqImage; anything outside the caller tenant is NOT_FOUND.
hqTemplates.delete('/api/hq/templates/media', async c => {
  const auth = await authority(c);
  try {
    const data = await deleteHqImage(c.env.IMAGES, auth, c.req.query('r2Key'));
    return c.json({ success: true, data });
  } catch (error) {
    if (error instanceof TemplateHqTemplateError) throw new HqTemplateError(error.code, error.code === 'NOT_FOUND' ? 404 : 422);
    throw error;
  }
});
hqTemplates.get('/api/hq/templates/accounts', async c => c.json({ success: true, data: await listTemplateAccounts(dbFor(c.env), await authority(c)) }));
hqTemplates.get('/api/hq/templates/message-references', async c => c.json({ success: true, data: await listMessageReferences(dbFor(c.env), await authority(c)) }));
hqTemplates.get('/api/hq/templates/kind-counts', async c => {
  const rows=await listTemplates(dbFor(c.env),await authority(c),'template');
  const counts=Object.fromEntries(TEMPLATE_KINDS.map(kind=>[kind,rows.filter(row=>row.kind===kind).length])) as TemplateKindCounts;
  return c.json({success:true,data:counts});
});
hqTemplates.get('/api/hq/templates', async c => {
  const type = c.req.query('type');
  if (type && !HQ_TEMPLATE_TYPES.includes(type as HqTemplateType)) throw new HqTemplateError('INVALID_TYPE');
  const kind=c.req.query('kind');
  const attributeType=kind==='friend_field'?'friend_field':kind==='support_mark'?'mark':null;
  if(attributeType&&type&&type!==attributeType) throw new HqTemplateError('INVALID_KIND');
  if(kind&&!attributeType && (kind==='tag' ? (type && type!=='tag') : (!TEMPLATE_KINDS.includes(kind as TemplateKind) || (type && type!=='template')))) throw new HqTemplateError('INVALID_KIND');
  const rows=await listTemplates(dbFor(c.env),await authority(c),attributeType??(kind==='tag'?'tag':kind?'template':type as HqTemplateType | undefined));
  const counts=Object.fromEntries(TEMPLATE_KINDS.map(k=>[k,rows.filter(row=>row.kind===k).length])) as TemplateKindCounts;
  const selectedType=attributeType??type;
  const attributeStats=isFriendAttributeType(selectedType??'')?{
    totalTemplates:rows.length,undistributedTemplateCount:rows.filter(r=>r.distributed_account_count===0).length,
    distributedAccountCount:Number((await dbFor(c.env).prepare(`SELECT COUNT(DISTINCT r.target_account_id) count FROM hq_template_distribution_results r
      JOIN hq_templates t ON t.id=r.template_id AND t.tenant_id=r.tenant_id
      JOIN line_accounts a ON a.id=r.target_account_id AND a.tenant_id=r.tenant_id
      WHERE r.tenant_id=? AND t.archived_at IS NULL AND t.friend_attribute_type=? AND r.status='succeeded'
        AND NOT EXISTS(SELECT 1 FROM hq_template_preflight_resolutions p WHERE p.preflight_id=r.preflight_id AND p.tenant_id=r.tenant_id AND p.friend_attribute_mode='skip')`).bind((await authority(c)).tenantId,selectedType).first<{count:number}>())?.count??0),
  }:{};
  return c.json({success:true,data:kind&&kind!=='tag'&&!attributeType?rows.filter(row=>row.kind===kind):rows,kind_counts:counts,stats:{...attributeStats,thisMonthSentCount:rows.some(r=>r.this_month_sent_count===null)?null:rows.reduce((n,r)=>n+(r.this_month_sent_count??0),0),
    outdatedTemplateCount:rows.filter(r=>(r.outdated_account_count??0)>0).length}});
});
hqTemplates.get('/api/hq/templates/attribute-kind-counts',async c=>{
 const rows=await listTemplates(dbFor(c.env),await authority(c));
 return c.json({success:true,data:{tag:rows.filter(r=>r.template_type==='tag').length,friend_field:rows.filter(r=>r.template_type==='friend_field').length,support_mark:rows.filter(r=>r.template_type==='mark').length}});
});
hqTemplates.get('/api/hq/templates/folders', async c => c.json({ success:true, data:await listTemplateFolders(dbFor(c.env),await authority(c)) }));
hqTemplates.post('/api/hq/templates/folders', async c => c.json({ success:true, data:await saveTemplateFolder(dbFor(c.env),await authority(c),await body(c)) },201));
hqTemplates.patch('/api/hq/templates/folders/:id', async c => c.json({ success:true, data:await saveTemplateFolder(dbFor(c.env),await authority(c),await body(c),c.req.param('id')) }));
hqTemplates.delete('/api/hq/templates/folders/:id', async c => c.json({ success:true, data:await deleteTemplateFolder(dbFor(c.env),await authority(c),c.req.param('id'),(await body(c)).expectedRevision) }));
hqTemplates.post('/api/hq/templates/:id/duplicate', async c => c.json({ success:true, data:await duplicateTemplate(dbFor(c.env),await authority(c),c.req.param('id'),await body(c)) },201));
hqTemplates.get('/api/hq/templates/:id/versions',async c=>c.json({success:true,data:await templateVersions(dbFor(c.env),await authority(c),c.req.param('id'))}));
hqTemplates.get('/api/hq/templates/:id/versions/compare',async c=>c.json({success:true,data:await compareTemplateVersions(dbFor(c.env),await authority(c),c.req.param('id'),Number(c.req.query('from')),Number(c.req.query('to')))}));
hqTemplates.post('/api/hq/templates/:id/versions/:version/restore',async c=>{
  const input=await body(c),data=await restoreTemplateVersion(dbFor(c.env),await authority(c),c.req.param('id'),Number(c.req.param('version')),input.expectedRevision);
  c.set('auditRecorded',true);return c.json({success:true,data});
});
hqTemplates.get('/api/hq/templates/:id/received-versions',async c=>c.json({success:true,data:await templateReceivedVersions(dbFor(c.env),await authority(c),c.req.param('id'))}));
hqTemplates.get('/api/hq/templates/:id', async c => c.json({ success: true, data: await templateDetail(dbFor(c.env), await authority(c), c.req.param('id')) }));
hqTemplates.post('/api/hq/templates', async c => {
  const auth = await authority(c), input = await body(c), headerKey = c.req.header('Idempotency-Key');
  if (headerKey !== undefined && input.requestId !== undefined && headerKey !== input.requestId) throw new HqTemplateError('INVALID_REQUEST_ID');
  input.requestId = templateCreationRequestId(headerKey ?? input.requestId);
  const data = await saveTemplate(dbFor(c.env), auth, input);
  c.set('auditRecorded', true);
  return c.json({ success: true, data }, 201);
});
hqTemplates.patch('/api/hq/templates/:id', async c => {
  const data = await saveTemplate(dbFor(c.env), await authority(c), await body(c), c.req.param('id'));
  c.set('auditRecorded', true); return c.json({ success: true, data });
});
hqTemplates.delete('/api/hq/templates/:id', async c => {
  const input = await body(c);
  const data = await deleteTemplate(dbFor(c.env), await authority(c), c.req.param('id'), input.expectedRevision);
  c.set('auditRecorded', true); return c.json({ success: true, data });
});
hqTemplates.post('/api/hq/templates/:id/preflight', async c => {
  const input = await body(c);
  if (!Array.isArray(input.accountIds) || input.accountIds.some(v => typeof v !== 'string')) throw new HqTemplateError('INVALID_ACCOUNTS');
  const auth=await authority(c),db=dbFor(c.env),{template}=await templateDetail(db,auth,c.req.param('id'));
  if(isFriendAttributeType(template.template_type)) {
    if(input.textOverrides!==undefined) throw new HqTemplateError('INVALID_DEFINITION');
    return c.json({success:true,data:await preflightFriendAttribute(db,auth,c.req.param('id'),input.accountIds as string[])});
  }
  return c.json({ success: true, data: await preflightDistribution(dbFor(c.env), await authority(c), c.req.param('id'), input.accountIds as string[], c.env.IMAGES, input.textOverrides) });
});
hqTemplates.post('/api/hq/templates/:id/distribute', async c => {
  const input = await body(c);
  const auth=await authority(c),db=dbFor(c.env),{template}=await templateDetail(db,auth,c.req.param('id'));
  const modes=isFriendAttributeType(template.template_type)?['create','overwrite','alias','skip']:['create','overwrite','alias'];
  if (typeof input.preflightId !== 'string' || !Array.isArray(input.resolutions) || input.resolutions.length > 270 || input.resolutions.some(v => !v || typeof v !== 'object' || typeof v.accountId !== 'string' || typeof v.sourceId !== 'string' || !modes.includes(v.mode))) throw new HqTemplateError('INVALID_SELECTION');
  const data = isFriendAttributeType(template.template_type)
    ? await distributeFriendAttribute(db,auth,c.req.param('id'),input.preflightId,input.resolutions as Parameters<typeof distributeFriendAttribute>[4])
    : await distributeTemplate(dbFor(c.env), await authority(c), c.req.param('id'), input.preflightId, input.resolutions as DistributionSelection[], c.env.IMAGES, c.env.WORKER_URL || new URL(c.req.url).origin);
  c.set('auditRecorded', true); return c.json({ success: true, data });
});
hqTemplates.get('/api/hq/templates/:id/distributions/:runId', async c => {
  const auth=await authority(c),db=dbFor(c.env),template=await getHqTemplate(db,auth.tenantId,c.req.param('id'));
  if(!template) throw new HqTemplateError('NOT_FOUND',404);
  const data=isFriendAttributeType(template.template_type)?await friendAttributeResult(db,auth,c.req.param('id'),c.req.param('runId')):await distributionResult(db,auth,c.req.param('id'),c.req.param('runId'),c.env.IMAGES);
  return c.json({success:true,data});
});
