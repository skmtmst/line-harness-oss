import type { AccountStyle } from '@line-crm/shared';
import { applyCatalogStarter, type StarterCatalogRuntime } from './style-starter-catalog-apply.js';
import { digest } from './hq-templates/distribution.js';
import { starter } from './style-starter-set.js';
import { StyleError } from './style-setup-core.js';

export async function catalogDistributionPlan(db: D1Database, tenant: string, style: AccountStyle, accounts: Array<{accountId:string;profileVersion:number}>) {
  const set = await starter(db,tenant,style);
  const selections = set.definition.selections ?? [];
  const planned = [];
  for (const account of accounts) {
    const bound = (await db.prepare('SELECT template_id,template_version_id,state,error_code FROM style_starter_catalog_items WHERE tenant_id=? AND line_account_id=?')
      .bind(tenant,account.accountId).all<{template_id:string;template_version_id:string;state:string;error_code:string|null}>()).results;
    planned.push({...account,items:selections.map(selection=>({
      key:selection.templateId,name:selection.kind,kind:selection.kind,
      edited:bound.some(row=>row.template_id===selection.templateId&&(row.template_version_id!==selection.versionId||row.state==='blocked')),
      action:'create' as const,binding:null,snapshot:null,
    })),editedCount:bound.filter(row=>row.state==='blocked'||selections.some(selection=>selection.templateId===row.template_id&&selection.versionId!==row.template_version_id)).length, bound});
  }
  return {set,accounts:planned,accountCount:planned.length,editedCount:planned.reduce((n,row)=>n+row.editedCount,0),token:await digest(JSON.stringify({set,accounts:planned}))};
}

export async function distributeCatalog(db:D1Database,tenant:string,actor:string,style:AccountStyle,input:Record<string,unknown>,plan:Awaited<ReturnType<typeof catalogDistributionPlan>>,runtime:StarterCatalogRuntime) {
  if(input.confirmed!==true||input.token!==plan.token)throw new StyleError('distribution_confirmation_required',409);
  if(input.editedAction!==undefined&&!['notify','new_copy'].includes(String(input.editedAction)))throw new StyleError('invalid_edited_action');
  // カタログの店別変更は通知を既定にし、同名の実体を上書きしない。
  const items=[];
  for(const account of plan.accounts) {
    const applied=await applyCatalogStarter(db,tenant,account.accountId,actor,style,{...runtime,manual:true});
    for(const item of applied.items)items.push({accountId:account.accountId,key:item.templateId,action:item.state==='succeeded'?'created' as const:'pending' as const,message:item.reason});
  }
  return {accountCount:plan.accountCount,items};
}
