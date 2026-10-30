import { hasDatabaseTable } from './schema-presence.js';
import { activeTenantLineAccountSql, type V6WriteGuard } from '@line-crm/db';
import { buildExecutionPlan, parseActions, type ActionDefinition } from '../features/automations/automation-plan/index.js';

export type FollowupEngine = 'reminder' | 'automation';
interface ApprovedTemplate {
  id: string; line_account_id: string; published_version: number | null;
  message_type: string; message_content: string; message_bubbles_json: string | null;
}
export interface FollowupEngineSnapshot {
  versionId: string;
  contentHash: string;
  plan: ActionDefinition[] | null;
  templates: ReadonlyMap<string, ApprovedTemplate>;
  guard: V6WriteGuard;
}

// 状態や検査日時は指紋に含めず、本文・時期・参照する版・下書きの変更を含める。
const reminderSnapshotSql = `SELECT json_object(
  'accountId',r.line_account_id,'versionId',r.current_published_version_id,
  'settings',v.settings_snapshot,'draftId',r.current_draft_version_id,
  'draft',(SELECT settings_snapshot FROM reminder_versions WHERE id=r.current_draft_version_id),
  'triggerType',r.trigger_type,'deliveryMode',r.delivery_mode,'fieldId',r.trigger_field_id,
  'eventId',r.trigger_event_id,'repeatYearly',r.repeat_yearly,'leapYearPolicy',r.leap_year_policy,
  'offset',r.trigger_offset_minutes,'sendAt',r.send_at_time,'tagId',r.target_tag_id,
  'steps',(SELECT json_group_array(json_object('id',stable_step_id,'offset',offset_minutes,
    'days',offset_days,'time',send_at_time,'type',message_type,'content',message_content,
    'templateId',template_id,'condition',target_condition_json,'action',action_json))
    FROM (SELECT * FROM reminder_version_steps WHERE reminder_version_id=v.id ORDER BY position,stable_step_id))
  ) AS content_json FROM reminders r JOIN reminder_versions v ON v.id=r.current_published_version_id AND v.reminder_id=r.id
  WHERE r.id=? AND v.status='published'`;
const automationSnapshotSql = `SELECT json_object(
  'accountId',d.line_account_id,'versionId',d.current_published_version_id,
  'triggerType',v.trigger_type,'triggerConfig',v.trigger_config,'conditions',v.condition_config,'actions',v.action_config,
  'draftId',d.current_draft_version_id,
  'draft',(SELECT json_array(trigger_type,trigger_config,condition_config,action_config) FROM automation_versions WHERE id=d.current_draft_version_id),
  'bindings',(SELECT json_group_array(json_array(consumer_path,common_action_id,common_action_version_id))
    FROM (SELECT * FROM common_action_bindings WHERE consumer_type='automation' AND consumer_id=d.id
      AND line_account_id=d.line_account_id ORDER BY consumer_path,common_action_id))
  ) AS content_json FROM automation_definitions d JOIN automation_versions v ON v.id=d.current_published_version_id AND v.automation_id=d.id
  WHERE d.id=? AND v.status='published'`;

/** 承認する実物の指紋と、送信直前に同じ内容を照合するSQLを同時に作る。 */
export async function readFollowupEngineSnapshot(db: D1Database, input: {
  engine: FollowupEngine; targetId: string; lineAccountId: string; storeId: string;
}): Promise<FollowupEngineSnapshot | null> {
  const sql = input.engine === 'reminder' ? reminderSnapshotSql : automationSnapshotSql;
  const result = await db.prepare(sql).bind(input.targetId).first<{content_json:string}>();
  if (!result) return null;
  const row = result.content_json;
  const data = JSON.parse(row) as { accountId: string; versionId: string; actions?: string; steps?: Array<{ templateId: string | null }> };
  if (data.accountId !== input.lineAccountId || !data.versionId) return null;
  const plan = input.engine === 'automation' ? await buildExecutionPlan(db, {
    lineAccountId:input.lineAccountId,automationId:input.targetId,actions:parseActions(data.actions!),
  }) : null;
  const templateIds = [...new Set(plan
    ? plan.flatMap(action => typeof (action.params.templateId ?? action.params.template_id) === 'string'
      ? [String(action.params.templateId ?? action.params.template_id)] : [])
    : (data.steps ?? []).flatMap(step => step.templateId ? [step.templateId] : []))].sort();
  const templates = new Map<string,ApprovedTemplate>();
  const clauses = [`(${sql})=?`];
  const binds: unknown[] = [input.targetId,row];
  const store = await db.prepare('SELECT timezone FROM rt_stores WHERE id=? AND line_account_id=?')
    .bind(input.storeId,input.lineAccountId).first<{timezone:string}>();
  if (!store) return null;
  clauses.push('EXISTS(SELECT 1 FROM rt_stores WHERE id=? AND line_account_id=? AND timezone=?)');
  binds.push(input.storeId,input.lineAccountId,store.timezone);
  for (const id of templateIds) {
    const template = await db.prepare(`SELECT id,line_account_id,published_version,message_type,message_content,message_bubbles_json
      FROM templates WHERE id=? AND line_account_id=?`).bind(id,input.lineAccountId).first<ApprovedTemplate>();
    if (!template) return null;
    templates.set(id,template);
    clauses.push(`EXISTS(SELECT 1 FROM templates WHERE id=? AND line_account_id=? AND published_version IS ?
      AND message_type=? AND message_content=? AND message_bubbles_json IS ?)`);
    binds.push(id,input.lineAccountId,template.published_version,template.message_type,template.message_content,template.message_bubbles_json);
  }
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([data,plan,[...templates.values()],store])));
  const contentHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
  return {versionId:data.versionId,contentHash,plan,templates,guard:{sql:clauses.join(' AND '),binds}};
}

export type FollowupEngineGate = { managed: false; allowed: true } | {
  managed: true; allowed: false;
} | {
  managed: true; allowed: true; storeId: string; trigger: string;
  snapshot: FollowupEngineSnapshot; guard: V6WriteGuard;
};

/** 管理対象だけに承認を要求する。解除後も実物IDを対応表へ残し、一般の定義へ戻さない。 */
async function readFollowupEngineGateUncached(db: D1Database, input: {
  engine: FollowupEngine; targetId: string; lineAccountId: string; versionId: string;
  executionPlanJson?: string | null;
}): Promise<FollowupEngineGate> {
  // Workerを先に出す段階では対応表がまだ無く、管理する実物もまだ存在しない。
  if (!await hasDatabaseTable(db,'rt_store_followup_targets'))
    return {managed:false,allowed:true};
  const column = input.engine === 'reminder' ? 'reminder_id' : 'automation_id';
  const target = await db.prepare(`SELECT store_id,trigger FROM rt_store_followup_targets WHERE ${column}=?`)
    .bind(input.targetId).first<{store_id:string;trigger:string}>();
  if (!target) return {managed:false,allowed:true};
  const snapshot = await readFollowupEngineSnapshot(db,{...input,storeId:target.store_id});
  if (!snapshot || snapshot.versionId !== input.versionId) return {managed:true,allowed:false};
  if (input.executionPlanJson !== undefined && canonicalJson(input.executionPlanJson) !== canonicalJson(JSON.stringify(snapshot.plan)))
    return {managed:true,allowed:false};
  const state = input.engine === 'reminder'
    ? `EXISTS(SELECT 1 FROM reminders d WHERE d.id=ft.reminder_id AND d.line_account_id=s.line_account_id
        AND d.deleted_at IS NULL AND d.is_active=1 AND d.lifecycle_status='published' AND d.current_published_version_id=ft.approved_version_id)`
    : `EXISTS(SELECT 1 FROM automation_definitions d WHERE d.id=ft.automation_id AND d.line_account_id=s.line_account_id
        AND d.status='active' AND d.archived_at IS NULL AND d.current_published_version_id=ft.approved_version_id)`;
  const sql = `EXISTS(SELECT 1 FROM rt_store_followup_targets ft
    JOIN rt_stores s ON s.id=ft.store_id
    JOIN line_accounts la ON la.id=s.line_account_id AND la.is_active=1 AND la.archived_at IS NULL
    JOIN rt_approval_requests a ON a.id=ft.approval_id AND a.store_id=s.id AND a.organization_id=s.organization_id
    WHERE ft.${column}=? AND ft.engine=? AND s.line_account_id=? AND s.status='active'
      AND ft.enabled=1 AND ft.sending_status='active' AND ft.approved_version_id=? AND ft.approved_content_hash=?
      AND a.status='approved' AND a.kind='line_message' AND json_valid(a.payload_json)
      AND json_extract(CASE WHEN json_valid(a.payload_json) THEN a.payload_json ELSE '{}' END,'$.operation')='start_restaurant_followup_engines'
      AND json_extract(CASE WHEN json_valid(a.payload_json) THEN a.payload_json ELSE '{}' END,'$.lineAccountId')=s.line_account_id
      AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(a.payload_json) THEN a.payload_json ELSE '{}' END,'$.targets') approved
        WHERE json_extract(CASE WHEN json_valid(approved.value) THEN approved.value ELSE '{}' END,'$.trigger')=ft.trigger AND json_extract(CASE WHEN json_valid(approved.value) THEN approved.value ELSE '{}' END,'$.engine')=ft.engine
        AND json_extract(CASE WHEN json_valid(approved.value) THEN approved.value ELSE '{}' END,'$.targetId')=ft.${column}
        AND json_extract(CASE WHEN json_valid(approved.value) THEN approved.value ELSE '{}' END,'$.versionId')=ft.approved_version_id
        AND json_extract(CASE WHEN json_valid(approved.value) THEN approved.value ELSE '{}' END,'$.contentHash')=ft.approved_content_hash)
      AND ${state} AND ${activeTenantLineAccountSql('la.id')}) AND ${snapshot.guard.sql}`;
  const binds = [input.targetId,input.engine,input.lineAccountId,input.versionId,snapshot.contentHash,...snapshot.guard.binds];
  if (!await db.prepare(`SELECT 1 WHERE ${sql}`).bind(...binds).first()) return {managed:true,allowed:false};
  return {managed:true,allowed:true,storeId:target.store_id,trigger:target.trigger,snapshot,guard:{sql,binds}};
}

export type FollowupApprovalScope=Map<string,Promise<FollowupEngineGate>>;
/** 同じ実行では写しを共有し、許可の結果でなくSQLの証明を毎回照合する。 */
export async function readFollowupEngineGate(db:D1Database,input:Parameters<typeof readFollowupEngineGateUncached>[1],scope?:FollowupApprovalScope):Promise<FollowupEngineGate>{
  const key=JSON.stringify(input),saved=scope?.get(key);
  if(!saved){const pending=readFollowupEngineGateUncached(db,input);scope?.set(key,pending);return pending;}
  const gate=await saved;
  if(gate.managed&&gate.allowed&&!await db.prepare(`SELECT 1 WHERE ${gate.guard.sql}`).bind(...gate.guard.binds).first())
    return {managed:true,allowed:false};
  return gate;
}

function canonicalJson(value:string|null):string{
  const normalize=(item:unknown):unknown=>Array.isArray(item)?item.map(normalize):item&&typeof item==='object'
    ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>[key,normalize(val)])):item;
  try{return JSON.stringify(normalize(JSON.parse(value??'null')));}catch{return '';}
}
