import { Hono, type Context } from 'hono';
import { HQ_TEMPLATE_TYPES, getStaffById, type HqTemplateType } from '@line-crm/db';
import { dbFor } from '../services/db-router.js';
import type { Env } from '../index.js';
import { requireHqTemplateAuthority, type HqTemplateAuthority } from '../services/hq-templates/contract.js';
import {
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
    role: member.role, readOnly: staff.readOnly || member.access_level === 'read_only', accountScoped: member.account_scope === 'accounts' });
  if (auth.kind !== 'AUTHORIZED') throw new HqTemplateError('FORBIDDEN', 403);
  return auth.authority;
}
const reasons: Record<string, string> = {
  INVALID_REQUEST_ID: '作成依頼の識別情報を確認してください',
  IDEMPOTENCY_CONFLICT: '同じ作成依頼の内容が変わっています。元の内容で再確認してください',
  CREATE_RECEIPT_UNAVAILABLE: '作成済みの記録を確認できません。一覧から状態を確認してください',
  FORBIDDEN: '統括の編集権限が必要です', NOT_FOUND: '対象が見つかりません',
  UNSUPPORTED: 'この種類のひな形はまだ利用できません',
  VERSION_CONFLICT: '編集がありました。もう一度確認してください',
  SELECTION_REQUIRED: '重複した項目ごとに上書きか別名を選んでください',
  SELECTION_CHANGED: '実行済みの選択は変更できません。結果を確認してください',
  FOLDER_SELECTION_CONFLICT: '親フォルダを別名にする場合は、子フォルダも別名にしてください',
};
async function body(c: { req: { text(): Promise<string> } }): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (text.length > 64_000) throw new HqTemplateError('REQUEST_TOO_LARGE');
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
hqTemplates.use('/api/hq/templates/*', async (c, next) => {
  try { await authority(c); await next(); }
  catch (error) {
    const typed = error instanceof HqTemplateError;
    const code = typed ? error.code : 'UNAVAILABLE';
    return c.json({ success: false, error: reasons[code] ?? (typed && error.status < 500 ? '入力内容を確認してください' : '処理結果を確認できません。しばらくしてから再確認してください'), code }, typed ? error.status : 500);
  }
});
hqTemplates.get('/api/hq/templates/accounts', async c => c.json({ success: true, data: await listTemplateAccounts(dbFor(c.env), await authority(c)) }));
hqTemplates.get('/api/hq/templates', async c => {
  const type = c.req.query('type');
  if (type && !HQ_TEMPLATE_TYPES.includes(type as HqTemplateType)) throw new HqTemplateError('INVALID_TYPE');
  return c.json({ success: true, data: await listTemplates(dbFor(c.env), await authority(c), type as HqTemplateType | undefined) });
});
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
  return c.json({ success: true, data: await preflightDistribution(dbFor(c.env), await authority(c), c.req.param('id'), input.accountIds as string[]) });
});
hqTemplates.post('/api/hq/templates/:id/distribute', async c => {
  const input = await body(c);
  if (typeof input.preflightId !== 'string' || !Array.isArray(input.resolutions) || input.resolutions.length > 270 || input.resolutions.some(v => !v || typeof v !== 'object' || typeof v.accountId !== 'string' || typeof v.sourceId !== 'string' || !['create', 'overwrite', 'alias'].includes(v.mode))) throw new HqTemplateError('INVALID_SELECTION');
  const data = await distributeTemplate(dbFor(c.env), await authority(c), c.req.param('id'), input.preflightId, input.resolutions as DistributionSelection[]);
  c.set('auditRecorded', true); return c.json({ success: true, data });
});
hqTemplates.get('/api/hq/templates/:id/distributions/:runId', async c => c.json({ success: true, data: await distributionResult(dbFor(c.env), await authority(c), c.req.param('id'), c.req.param('runId')) }));
