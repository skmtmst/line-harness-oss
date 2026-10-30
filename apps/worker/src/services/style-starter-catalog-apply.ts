import type { AccountStyle, StarterCatalogApplyResult, StarterCatalogSelection } from '@line-crm/shared';
import type { HqTemplateAuthority } from './hq-templates/contract.js';
import { preflightDistribution, distributeTemplate, distributionResult, type DistributionSelection } from './hq-templates/distribution.js';
import { catalogSelection } from './style-starter-catalog-definition.js';
import { catalogResourceSnapshot } from './style-starter-catalog-resources.js';
import { starter } from './style-starter-set.js';
import { StyleError } from './style-setup-core.js';

export type StarterCatalogRuntime = { bucket?: R2Bucket; publicBaseUrl?: string; manual?: boolean };
type Item = { template_id: string; template_version_id: string; state: 'pending' | 'running' | 'succeeded' | 'blocked' | 'failed'; distribution_run_id: string | null; error_code: string | null; lease_token: string | null };

/** 公開HTTPから任意のカタログIDや権限を渡せない、承認済みの組専用の実行入口。 */
export async function applyCatalogStarter(db: D1Database, tenant: string, account: string, actor: string, style: AccountStyle, runtime: StarterCatalogRuntime = {}): Promise<StarterCatalogApplyResult> {
  const set = await starter(db, tenant, style);
  const result: StarterCatalogApplyResult = { mode: 'catalog', items: [] };
  if (set.definition.mode !== 'catalog' || (!set.autoInsert && !runtime.manual)) return result;
  const selected = await db.prepare('SELECT selection_mode,style,answers_json FROM account_styles WHERE line_account_id=?').bind(account).first<{ selection_mode: string; style: string; answers_json:string }>();
  if (!selected || (!runtime.manual && (selected.selection_mode !== 'configured' || selected.style !== style))) return result;
  const approval = await db.prepare(`SELECT u.id,u.role FROM style_starter_sets s JOIN staff_members u ON u.id=s.updated_by AND u.tenant_id=s.tenant_id
    JOIN line_accounts a ON a.tenant_id=s.tenant_id WHERE s.id=? AND s.tenant_id=? AND s.version=? AND s.archived_at IS NULL
    AND a.id=? AND a.is_active=1 AND a.archived_at IS NULL AND u.is_active=1 AND u.role IN ('owner','admin')
    AND u.account_scope!='accounts' AND u.access_level!='read_only'
    AND EXISTS(SELECT 1 FROM staff_members i WHERE i.id=? AND i.tenant_id=s.tenant_id AND i.is_active=1 AND i.access_level!='read_only')`)
    .bind(set.id, tenant, set.version, account, actor).first<{ id: string; role: 'owner' | 'admin' }>();
  if (!approval) throw new StyleError('catalog_approval_unavailable', 403);
  // 実在する承認者の現在の権限を使う。店の担当者を統括へ読み替えない。
  const authority: HqTemplateAuthority = { tenantId: tenant, actorId: approval.id, role: approval.role, readOnly: false, accountScoped: false };
  const selections = [...(set.definition.selections ?? [])].sort((a, b) => {
    const order = { tag: 0, template: 1, coupon: 1, form: 2, auto_reply: 3, rich_menu: 4 };
    return (order[a.kind as keyof typeof order] ?? 9) - (order[b.kind as keyof typeof order] ?? 9);
  });
  for (const selection of selections) {
    const answers = JSON.parse(selected.answers_json) as Record<string,{mode:string;value?:unknown}>;
    const answer = answers[selection.kind === 'coupon' ? 'coupons' : 'content'];
    if (answer && (answer.mode !== 'configured' || answer.value === false)) {
      result.items.push({...selection,state:'blocked',reason:'answer_later'}); continue;
    }
    await catalogSelection(db, tenant, selection);
    const now = new Date().toISOString();
    await db.prepare(`INSERT OR IGNORE INTO style_starter_catalog_items
      (line_account_id,template_id,template_version_id,tenant_id,set_id,set_version,style,kind,initiated_by,approved_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(account, selection.templateId, selection.versionId, tenant, set.id, set.version, style, selection.kind, actor, approval.id, now, now).run();
    const item = await db.prepare('SELECT * FROM style_starter_catalog_items WHERE line_account_id=? AND template_id=? AND tenant_id=?')
      .bind(account, selection.templateId, tenant).first<Item>();
    if (!item) throw new StyleError('catalog_application_unavailable', 409);
    if (item.template_version_id !== selection.versionId) {
      result.items.push({ ...selection, state: 'blocked', reason: 'new_version_available' }); continue;
    }
    if (item.state === 'succeeded' || item.state === 'blocked') {
      result.items.push({ ...selection, state: item.state, reason: item.error_code }); continue;
    }
    const lease = crypto.randomUUID();
    const claimed = await db.prepare(`UPDATE style_starter_catalog_items SET state='running',lease_token=?,lease_until=?,updated_at=?
      WHERE line_account_id=? AND template_id=? AND tenant_id=? AND template_version_id=?
      AND (state IN ('pending','failed') OR (state='running' AND lease_until<=?))`)
      .bind(lease, new Date(Date.now() + 120_000).toISOString(), now, account, selection.templateId, tenant, selection.versionId, now).run();
    if (!claimed.meta.changes) { result.items.push({ ...selection, state: 'running', reason: null }); continue; }
    const scoped = fencedDatabase(db, { tenant, account, setId: set.id, setVersion: set.version, approver: approval.id, templateId: selection.templateId, lease });
    try {
      let runId = item.distribution_run_id;
      if (!runId) {
        const preview = await preflightDistribution(scoped, authority, selection.templateId, [account], runtime.bucket, undefined, { versionId: selection.versionId });
        for (const row of preview.stores[0].items) {
          if (!row.targetId) continue;
          const held = await db.prepare('SELECT source_snapshot FROM style_starter_catalog_resources WHERE tenant_id=? AND line_account_id=? AND resource_kind=? AND target_id=?')
            .bind(tenant, account, row.itemKind, row.targetId).first<{ source_snapshot: string }>();
          if (!held || held.source_snapshot !== await catalogResourceSnapshot(db, account, row.itemKind, row.targetId))
            throw new StyleError('catalog_local_changes', 409);
          // 根の同名リソースは再配布で上書きせず、店へ確認を残す。
          if (row.itemKind === selection.kind || (selection.kind === 'coupon' && row.itemKind === 'template')) throw new StyleError('catalog_local_changes', 409);
        }
        runId = preview.preflightId;
        await db.prepare('UPDATE style_starter_catalog_items SET distribution_run_id=? WHERE line_account_id=? AND template_id=? AND lease_token=?')
          .bind(runId, account, selection.templateId, lease).run();
      }
      const resolutions = (await db.prepare('SELECT source_id,item_kind,resolution_mode FROM hq_template_preflight_resolutions WHERE tenant_id=? AND target_account_id=? AND template_id=? AND idempotency_fingerprint=?')
        .bind(tenant, account, selection.templateId, runId).all<{ source_id: string; item_kind: string; resolution_mode: 'create' | 'overwrite' | 'alias' }>()).results;
      const choices: DistributionSelection[] = resolutions.map(row => ({ accountId: account, sourceId: row.source_id, mode: row.resolution_mode }));
      const existing = await db.prepare('SELECT status FROM hq_template_distribution_results WHERE run_id=? AND tenant_id=? AND target_account_id=?').bind(runId, tenant, account).first<{ status: string }>();
      const applied = existing?.status === 'succeeded'
        ? await distributionResult(scoped, authority, selection.templateId, runId, runtime.bucket)
        : await distributeTemplate(scoped, authority, selection.templateId, runId, choices, runtime.bucket, runtime.publicBaseUrl);
      const state = applied.stores.find(row => row.accountId === account)?.status;
      if (state !== 'succeeded') throw new StyleError(state === 'pending' || state === 'staged' ? 'catalog_in_progress' : 'catalog_distribution_failed', 409);
      await rememberResources(scoped, tenant, account, runId);
      await scoped.batch([scoped.prepare(`UPDATE style_starter_catalog_items SET state='succeeded',error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE line_account_id=? AND template_id=? AND lease_token=?`).bind(new Date().toISOString(), account, selection.templateId, lease)]);
      result.items.push({ ...selection, state: 'succeeded', reason: null });
    } catch (error) {
      const reason = error instanceof StyleError ? error.code : 'catalog_distribution_failed';
      const state = reason === 'catalog_local_changes' ? 'blocked' : 'failed';
      await db.prepare(`UPDATE style_starter_catalog_items SET state=?,error_code=?,lease_token=NULL,lease_until=NULL,updated_at=?
        WHERE line_account_id=? AND template_id=? AND lease_token=?`).bind(state, reason, new Date().toISOString(), account, selection.templateId, lease).run();
      result.items.push({ ...selection, state, reason });
      const failed = await db.prepare(`SELECT r.status,EXISTS(SELECT 1 FROM hq_template_owned_r2_keys k WHERE k.run_id=r.run_id AND k.target_account_id=r.target_account_id AND k.state IN ('staged','cleanup_pending')) cleanup
        FROM hq_template_distribution_results r WHERE r.run_id=(SELECT distribution_run_id FROM style_starter_catalog_items WHERE line_account_id=? AND template_id=?) AND r.target_account_id=? AND r.tenant_id=?`)
        .bind(account, selection.templateId, account, tenant).first<{status:string;cleanup:number}>();
      if (failed && !failed.cleanup && ['failed','version_conflict','compensated','unsupported'].includes(failed.status))
        await db.prepare("UPDATE style_starter_catalog_items SET distribution_run_id=NULL WHERE line_account_id=? AND template_id=? AND tenant_id=? AND state='failed' AND lease_token IS NULL")
          .bind(account,selection.templateId,tenant).run();
    }
  }
  return result;
}

function fencedDatabase(db: D1Database, binding: { tenant: string; account: string; setId: string; setVersion: number; approver: string; templateId: string; lease: string }): D1Database {
  return new Proxy(db, { get(target, key) {
    if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
      const guard = db.prepare(`SELECT json(CASE WHEN EXISTS(
        SELECT 1 FROM style_starter_catalog_items i JOIN style_starter_sets s ON s.id=i.set_id AND s.tenant_id=i.tenant_id
        JOIN staff_members u ON u.id=s.updated_by AND u.tenant_id=s.tenant_id JOIN line_accounts a ON a.id=i.line_account_id AND a.tenant_id=i.tenant_id
        WHERE i.tenant_id=? AND i.line_account_id=? AND s.id=? AND s.version=? AND u.id=? AND i.template_id=? AND i.lease_token=?
        AND s.archived_at IS NULL AND a.is_active=1 AND a.archived_at IS NULL AND u.is_active=1
        AND u.role IN ('owner','admin') AND u.account_scope!='accounts' AND u.access_level!='read_only'
      ) THEN '{}' ELSE 'STARTER_APPLICATION_CONFLICT' END)`)
        .bind(binding.tenant, binding.account, binding.setId, binding.setVersion, binding.approver, binding.templateId, binding.lease);
      return (await db.batch([guard, ...statements])).slice(1);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

async function rememberResources(db: D1Database, tenant: string, account: string, runId: string) {
  const rows = (await db.prepare(`SELECT item_kind,target_id FROM hq_template_preflight_resolutions
    WHERE tenant_id=? AND target_account_id=? AND idempotency_fingerprint=? AND target_id IS NOT NULL`).bind(tenant, account, runId).all<{ item_kind: string; target_id: string }>()).results;
  for (const row of rows) {
    const snapshot = await catalogResourceSnapshot(db, account, row.item_kind, row.target_id);
    if (snapshot) await db.batch([db.prepare(`INSERT INTO style_starter_catalog_resources(tenant_id,line_account_id,resource_kind,target_id,source_snapshot,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(line_account_id,resource_kind,target_id) DO UPDATE SET source_snapshot=excluded.source_snapshot,updated_at=excluded.updated_at`)
      .bind(tenant, account, row.item_kind, row.target_id, snapshot, new Date().toISOString())]);
  }
}
