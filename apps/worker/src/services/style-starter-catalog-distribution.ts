import type { AccountStyle } from '@line-crm/shared';
import { applyCatalogStarter, type StarterCatalogRuntime } from './style-starter-catalog-apply.js';
import { digest } from './hq-templates/distribution.js';
import { catalogResourceSnapshot, catalogResourceKind } from './style-starter-catalog-resources.js';
import { starter } from './style-starter-set.js';
import { StyleError } from './style-setup-core.js';

export async function catalogDistributionPlan(db: D1Database, tenant: string, style: AccountStyle, accounts: Array<{accountId:string;profileVersion:number}>) {
  const set = await starter(db,tenant,style);
  const selections = set.definition.selections ?? [];
  const planned = [];
  for (const account of accounts) {
    const bound = (await db.prepare('SELECT template_id,template_version_id,state,error_code,distribution_run_id FROM style_starter_catalog_items WHERE tenant_id=? AND line_account_id=?')
      .bind(tenant,account.accountId).all<{template_id:string;template_version_id:string;state:string;error_code:string|null;distribution_run_id:string|null}>()).results;
    const resources = (await db.prepare('SELECT resource_kind,target_id,source_snapshot FROM style_starter_catalog_resources WHERE tenant_id=? AND line_account_id=? ORDER BY resource_kind,target_id').bind(tenant,account.accountId).all<{resource_kind:string;target_id:string;source_snapshot:string}>()).results;
    const snapshots=await Promise.all(resources.map(async row=>({...row,current:await catalogResourceSnapshot(db,account.accountId,row.resource_kind,row.target_id)})));
    const items=[];
    for(const selection of selections) {
      const binding=bound.find(row=>row.template_id===selection.templateId);
      const refs=binding?.distribution_run_id?(await db.prepare('SELECT item_kind,target_id FROM hq_template_preflight_resolutions WHERE tenant_id=? AND target_account_id=? AND idempotency_fingerprint=?').bind(tenant,account.accountId,binding.distribution_run_id).all<{item_kind:string;target_id:string|null}>()).results:[];
      const edited=Boolean(binding&&(binding.template_version_id!==selection.versionId||binding.state==='blocked'||snapshots.some(snapshot=>snapshot.current!==snapshot.source_snapshot&&refs.some(ref=>catalogResourceKind(ref.item_kind)===snapshot.resource_kind&&ref.target_id===snapshot.target_id))));
      items.push({key:selection.templateId,name:selection.kind,kind:selection.kind,edited,action:'create' as const,binding:null,snapshot:null});
    }
    planned.push({...account,items,editedCount:items.filter(row=>row.edited).length,bound,snapshots});
  }
  return {set,accounts:planned,accountCount:planned.length,editedCount:planned.reduce((n,row)=>n+row.editedCount,0),token:await digest(JSON.stringify({set,accounts:planned}))};
}

export async function distributeCatalog(db:D1Database,tenant:string,actor:string,style:AccountStyle,input:Record<string,unknown>,plan:Awaited<ReturnType<typeof catalogDistributionPlan>>,runtime:StarterCatalogRuntime) {
  if(input.confirmed!==true||input.token!==plan.token)throw new StyleError('distribution_confirmation_required',409);
  if(input.editedAction!==undefined&&!['notify','new_copy'].includes(String(input.editedAction)))throw new StyleError('invalid_edited_action');
  // カタログの店別変更は通知を既定にし、同名の実体を上書きしない。
  const items=[];
  for(const account of plan.accounts) {
    const heldIds=input.editedAction==='new_copy'?[]:account.items.filter(row=>row.edited).map(row=>row.key);
    let applied;
    try {applied=await applyCatalogStarter(db,tenant,account.accountId,actor,style,{...runtime,manual:true,onlyTemplateIds:account.items.filter(row=>!heldIds.includes(row.key)).map(row=>row.key),copyTemplateIds:input.editedAction==='new_copy'?account.items.filter(row=>row.edited).map(row=>row.key):[],copyFromRuns:Object.fromEntries(account.bound.map(row=>[row.template_id,row.distribution_run_id]))})}
    catch(error){if(!(error instanceof StyleError))throw error;applied={mode:'catalog' as const,items:(plan.set.definition.selections??[]).filter(row=>!heldIds.includes(row.templateId)).map(row=>({...row,state:'failed' as const,reason:error.code}))}}
    applied.items.push(...(plan.set.definition.selections??[]).filter(row=>heldIds.includes(row.templateId)).map(row=>({...row,state:'blocked' as const,reason:'new_version_available'})));
    for(const item of applied.items) {
      const edited=account.items.some(row=>row.key===item.templateId&&row.edited);
      const held=input.editedAction!=='new_copy'&&edited;
      items.push({accountId:account.accountId,key:item.templateId,action:held||item.state==='blocked'?'pending':item.state==='succeeded'?'created':'failed',message:item.reason});
      if(held||item.state==='blocked') {
        const id=await digest(JSON.stringify([tenant,account.accountId,plan.set.id,plan.set.version,item.templateId]));
        await db.prepare(`INSERT OR IGNORE INTO notifications(id,event_type,title,body,channel,metadata,line_account_id,category,created_at) VALUES (?,'style_starter_update','本部の初期セットに確認する物があります','お店で直した内容は変えていません。本部の担当者と、新しい版を入れるか確かめてください。','dashboard',?,?,'update',?)`)
          .bind(id,JSON.stringify({starterSetId:plan.set.id,starterSetVersion:plan.set.version,templateId:item.templateId}),account.accountId,new Date().toISOString()).run();
      }
    }
  }
  return {accountCount:plan.accountCount,items};
}
