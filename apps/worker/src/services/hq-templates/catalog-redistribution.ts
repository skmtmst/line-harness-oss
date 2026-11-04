import type { HqCatalogTemplateType } from '@line-crm/shared';
import type { HqTemplateStatement } from '@line-crm/db';
import type { HqTemplateAuthority } from './contract.js';
import { requireTargetAccounts } from './accounts.js';
import { catalogRewardNeedsApproval, catalogSnapshot, inspectCatalog, isCatalogType, parseCatalogDefinition, planCatalog } from './catalog.js';
import { digest, templateDetail } from './distribution.js';
import { HqTemplateError } from './tag.js';

type CatalogSource = { type: HqCatalogTemplateType; versionId: string; definition: ReturnType<typeof parseCatalogDefinition> };
type StorePreview = { accountId: string; accountName: string; targetId: string; snapshot: string; state: 'current' | 'update' | 'approval_required' | 'kept' };

async function source(db: D1Database, authority: HqTemplateAuthority, id: string): Promise<CatalogSource> {
  const { template, definition } = await templateDetail(db, authority, id);
  if (!isCatalogType(template.template_type) || !template.current_version_id) throw new HqTemplateError('INVALID_TYPE');
  return { type: template.template_type, versionId: template.current_version_id, definition: parseCatalogDefinition(template.template_type, definition) };
}

async function inspectStore(db: D1Database, id: string, data: CatalogSource, account: { id: string; name: string }): Promise<StorePreview> {
  const snapshot = await catalogSnapshot(db, account.id, data.type);
  const items = inspectCatalog(data.definition, snapshot, data.type, id), root = items[0];
  const parsed = JSON.parse(snapshot) as { targets: Array<{ id: string; hq_template_id: string | null; hq_template_version_id: string | null; hq_customized: number; status?: string; reward_kind?: string; current_published_version_id?: string }>; versions: Array<{ id:string; required_miles?:number }> };
  const target = parsed.targets.find(row => row.id === root.targetId && row.hq_template_id === id);
  if (!target) throw new HqTemplateError('NOT_FOUND', 404);
  const decision = await db.prepare(`SELECT decision FROM hq_catalog_update_decisions WHERE line_account_id=? AND template_id=? AND template_version_id=? AND ${data.type==='booking_menu'?'menu_id':'reward_id'}=?`).bind(account.id, id, data.versionId, target.id).first<{decision:string}>();
  const published = parsed.versions.find(version => version.id === target.current_published_version_id);
  const settings = data.definition.settings as {requiredMiles?:number;rewardKind?:string};
  if(data.type==='mileage_reward'&&target.status==='published'&&!published)throw new HqTemplateError('VERSION_CONFLICT',409);
  const disadvantage = data.type==='mileage_reward'&&target.status==='published'&&!!published&&catalogRewardNeedsApproval(target,published,settings,items.slice(1));
  const state = target.hq_template_version_id === data.versionId ? 'current' : decision?.decision === 'kept' ? 'kept'
    : target.hq_customized === 1 || disadvantage ? 'approval_required' : 'update';
  return { accountId: account.id, accountName: account.name, targetId: target.id, snapshot: await digest(snapshot), state };
}

export async function previewCatalogRedistribution(db: D1Database, authority: HqTemplateAuthority, id: string, accountIds: string[]) {
  const accounts = await requireTargetAccounts(db, authority, accountIds);
  const data = await source(db, authority, id);
  const stores: StorePreview[] = [];
  for (const account of accounts) stores.push(await inspectStore(db, id, data, account));
  const fingerprint=`catalog-redist:${crypto.randomUUID()}`,expiresAt=new Date(Date.now()+30*60_000).toISOString();
  const prepared=stores.map(store=>({...store,preflightId:crypto.randomUUID()}));
  const statements=prepared.map(store=>db.prepare(`INSERT INTO hq_template_preflights(id,tenant_id,template_id,template_version_id,target_account_id,distribution_mode,idempotency_fingerprint,snapshot_token,status,created_by,expires_at) SELECT ?,?,?,?,?, 'overwrite',?,?, 'ready',?,? WHERE EXISTS(SELECT 1 FROM hq_templates WHERE id=? AND tenant_id=? AND current_version_id=? AND archived_at IS NULL)`).bind(store.preflightId,authority.tenantId,id,data.versionId,store.accountId,fingerprint,store.snapshot,authority.actorId,expiresAt,id,authority.tenantId,data.versionId));
  const guard=db.prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM hq_templates WHERE id=? AND tenant_id=? AND current_version_id=? AND archived_at IS NULL) THEN '{}' ELSE 'VERSION_CONFLICT' END)").bind(id,authority.tenantId,data.versionId);
  try { const inserted=await db.batch([guard,...statements]);if(inserted.slice(1).some(result=>result.meta.changes!==1))throw new HqTemplateError('VERSION_CONFLICT',409); }
  catch {throw new HqTemplateError('VERSION_CONFLICT',409);}
  return { templateVersionId: data.versionId, type: data.type, expiresAt, stores:prepared };
}

export async function redistributeCatalog(db: D1Database, authority: HqTemplateAuthority, id: string, versionId: string, stores: Array<{ accountId: string; snapshot: string; preflightId:string }>) {
  const accounts = await requireTargetAccounts(db, authority, stores.map(store => store.accountId));
  const data = await source(db, authority, id);
  const results: Array<{ accountId: string; status: 'updated' | 'approval_required' | 'current' | 'kept' | 'version_conflict' }> = [];
  for (const account of accounts) {
    const requested = stores.find(store => store.accountId === account.id)!;
    const preflight=await db.prepare(`SELECT status,expires_at FROM hq_template_preflights WHERE id=? AND tenant_id=? AND template_id=? AND template_version_id=? AND target_account_id=? AND created_by=? AND snapshot_token=? AND idempotency_fingerprint LIKE 'catalog-redist:%'`).bind(requested.preflightId,authority.tenantId,id,versionId,account.id,authority.actorId,requested.snapshot).first<{status:string;expires_at:string|null}>();
    if(!preflight)throw new HqTemplateError('VERSION_CONFLICT',409);
    if(preflight.status==='consumed'){
      const replay=await db.prepare("SELECT after_json FROM audit_events WHERE source_kind='hq_catalog_redistribute' AND source_id=? AND tenant_id=? AND actor_principal_id=?").bind(requested.preflightId,authority.tenantId,authority.actorId).first<{after_json:string}>();
      const status=replay?JSON.parse(replay.after_json).status:null;
      if(!['updated','approval_required','current','kept'].includes(status))throw new HqTemplateError('VERSION_CONFLICT',409);
      results.push({accountId:account.id,status});continue;
    }
    if(data.versionId!==versionId)throw new HqTemplateError('VERSION_CONFLICT',409);
    if(preflight.status!=='ready'||!preflight.expires_at||preflight.expires_at<=new Date().toISOString()){results.push({accountId:account.id,status:'version_conflict'});continue;}
    const preview = await inspectStore(db, id, data, account);
    if (preview.snapshot !== requested.snapshot) { results.push({ accountId: account.id, status: 'version_conflict' }); continue; }
    const snapshot = await catalogSnapshot(db, account.id, data.type);
    if (await digest(snapshot) !== requested.snapshot) { results.push({ accountId: account.id, status: 'version_conflict' }); continue; }
    const refs = inspectCatalog(data.definition, snapshot, data.type, id);
    const selections = refs.map(ref => ({ sourceId: ref.sourceId, itemKind: ref.itemKind, mode: 'overwrite' as const }));
    const plan = planCatalog(account.id, data.definition, snapshot, data.type, selections, { templateId: id, versionId }, true);
    const guard: HqTemplateStatement = { sql: "SELECT json(CASE WHEN EXISTS(SELECT 1 FROM hq_templates t JOIN hq_template_preflights p ON p.template_id=t.id AND p.tenant_id=t.tenant_id WHERE t.id=? AND t.tenant_id=? AND t.current_version_id=? AND t.archived_at IS NULL AND p.id=? AND p.target_account_id=? AND p.created_by=? AND p.snapshot_token=? AND p.status='ready' AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND p.idempotency_fingerprint LIKE 'catalog-redist:%') THEN '{}' ELSE 'VERSION_CONFLICT' END)", bindings: [id,authority.tenantId,versionId,requested.preflightId,account.id,authority.actorId,requested.snapshot] };
    const status=preview.state==='update'?'updated':preview.state;
    const consume:HqTemplateStatement={sql:"UPDATE hq_template_preflights SET status='consumed' WHERE id=? AND tenant_id=? AND status='ready'",bindings:[requested.preflightId,authority.tenantId]};
    const audit: HqTemplateStatement = { sql: "INSERT INTO audit_events(id,source_kind,source_id,tenant_id,line_account_id,category,actor_principal_id,actor_role,action,target_kind,target_id,result,after_json) VALUES (?,'hq_catalog_redistribute',?,?,?,'business',?,?,'hq_template.redistributed','hq_template',?,'success',?)", bindings: [crypto.randomUUID(),requested.preflightId,authority.tenantId,account.id,authority.actorId,authority.role,id,JSON.stringify({status})] };
    try {
      await db.batch([guard, ...plan.statements,consume,audit].map(statement => db.prepare(statement.sql).bind(...statement.bindings)));
      results.push({ accountId: account.id, status });
    } catch {
      results.push({ accountId: account.id, status: 'version_conflict' });
    }
  }
  return { templateVersionId: versionId, stores: results };
}
