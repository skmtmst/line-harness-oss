import { withDisplayReadCache } from '@line-crm/db/src/display-read-cache.js';
import {GapError} from './gap-common.js';
import {comparisonKeys,comparisonUnits,comparisonPeriod,storeNumbers,type ComparisonKey} from './store-comparison.js';
import {getVisibleLineAccountScope} from './account-access.js';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';
export async function comparisonData(db:D1Database,visible:Array<{id:string}>,tenant:string,filters:Record<string,string>,allRows=false){
 return withDisplayReadCache(db, async db => {
 const q=(key:string)=>filters[key];
 let accounts=[...visible];const period=comparisonPeriod(q('from'),q('to')),compare=q('compare')??'previous',sort=(q('sort')??'bookings')as ComparisonKey,page=Number(q('page')??1),size=Number(q('pageSize')??20);
 if(!['average','previous'].includes(compare)||!comparisonKeys.includes(sort)||!Number.isSafeInteger(page)||page<1||![10,20,50].includes(size))throw new GapError('invalid_filter');
 const poolId=q('poolId');
 if(poolId){
  const pool=await db.prepare('SELECT p.id FROM traffic_pools p JOIN line_accounts a ON a.id=p.active_account_id WHERE p.id=? AND p.is_active=1 AND a.tenant_id=?').bind(poolId,tenant).first();
  if(!pool)throw new GapError('not_found',404);
  const members=(await db.prepare('SELECT line_account_id FROM pool_accounts WHERE pool_id=? AND is_active=1').bind(poolId).all<{line_account_id:string}>()).results;
  accounts=accounts.filter(a=>members.some(m=>m.line_account_id===a.id));
 }
 if(q('order')&&!['asc','desc'].includes(q('order')!))throw new GapError('invalid_filter');
 const values=await Promise.all(accounts.map(async a=>({a,...await storeNumbers(db,a.id,period)})));
 const average=Object.fromEntries(comparisonKeys.map(k=>{const nums=values.length<3?[]:values.map(v=>v.values[k]).filter((n):n is number=>n!==null);return [k,nums.length>=3?nums.reduce((n,v)=>n+v,0)/nums.length:null];})) as Record<ComparisonKey,number|null>;
 const previous=comparisonPeriod(new Date(Date.parse(period.from)-period.days*86400000).toISOString().slice(0,10),new Date(Date.parse(period.from)-86400000).toISOString().slice(0,10));
 const rows=await Promise.all(values.map(async v=>{const baseline=compare==='average'?average:(await storeNumbers(db,v.a.id,previous)).values;return {accountId:v.a.id,name:(await db.prepare('SELECT name FROM line_accounts WHERE id=?').bind(v.a.id).first<{name:string}>())?.name??'',style:v.style,computedAt:v.computedAt,metrics:Object.fromEntries(comparisonKeys.map(k=>[k,{value:v.values[k],diff:v.values[k]!==null&&baseline[k]!==null?v.values[k]!-baseline[k]!:null,unit:comparisonUnits[k],available:v.values[k]!==null}]))};}));
 const direction=q('order')==='desc'?-1:1;rows.sort((a,b)=>{const x=a.metrics[sort].value,y=b.metrics[sort].value;return x===null?(y===null?a.accountId.localeCompare(b.accountId):1):y===null?-1:direction*(x-y)||a.accountId.localeCompare(b.accountId);});
 return {rows:allRows?rows:rows.slice((page-1)*size,page*size),average,total:rows.length,computedAt:values.every(v=>v.computedAt)?values.map(v=>v.computedAt!).sort()[0]??null:null};
 });
}

export async function checkExportAccess(db:D1Database,job:Record<string,unknown>){
 const staff=await db.prepare("SELECT id,name,role,tenant_id,access_level FROM staff_members WHERE id=? AND tenant_id=? AND is_active=1 AND role IN('owner','admin')").bind(job.requested_by,job.tenant_id).first<{id:string;name:string;role:'owner'|'admin';tenant_id:string;access_level:string}>();
 if(!staff)throw new GapError('export_access_changed',403);
 const scope=await getVisibleLineAccountScope(db,{id:staff.id,name:staff.name,role:staff.role,tenantId:staff.tenant_id,readOnly:staff.access_level==='read_only'} as AuthenticatedStaff);
 const ids=JSON.parse(String(job.account_ids_json)) as string[];
 if(ids.some(id=>!scope.accounts.some(a=>a.id===id)))throw new GapError('export_access_changed',403);
 const data=await comparisonData(db,scope.accounts,staff.tenant_id,JSON.parse(String(job.filters_json)),true);
 if(data.rows.length!==ids.length||data.rows.some(r=>!ids.includes(r.accountId)))throw new GapError('export_scope_changed',403);
 return data;
}
function csvCell(v:unknown){const t=v==null?'':String(v);return '"'+(typeof v==='string'&&/^\s*[=+@\-]/.test(t)?"'"+t:t).replaceAll('"','""')+'"';}
export async function processComparisonExports(db:D1Database,now=new Date()){
 const job=await db.prepare("SELECT * FROM hq_store_comparison_export_jobs WHERE status='pending' ORDER BY created_at,id LIMIT 1").first<Record<string,unknown>>();if(!job)return;
 try{
 if(Date.parse(String(job.expires_at))<=now.getTime())throw new GapError('export_expired',410);
 const data=await checkExportAccess(db,job);
 const labels:Record<ComparisonKey,string>={friendChange:'友だちの増減',blockRate:'ブロック率',clickRate:'クリック率',bookings:'予約',visits:'来店',noShowRate:'無断キャンセル率',responseMinutes:'最初の返信までの時間'};
 const head=['店名',...comparisonKeys.flatMap(k=>[`${labels[k]}（${comparisonUnits[k]}）`,`${labels[k]}の差（${comparisonUnits[k]}）`])];
 const lines=data.rows.map(r=>[r.name,...comparisonKeys.flatMap(k=>[r.metrics[k].value,r.metrics[k].diff])]);
 const csv='\uFEFF'+[head,...lines].map(row=>row.map(csvCell).join(',')).join('\r\n');
 await db.batch([db.prepare("UPDATE hq_store_comparison_export_jobs SET status='completed',csv_text=?,row_count=?,completed_at=? WHERE id=? AND status='pending'").bind(csv,data.rows.length,now.toISOString(),job.id),
 db.prepare("INSERT INTO notifications(id,event_type,title,body,channel,status,category,metadata) SELECT ?,'store_comparison_export','店の比較のCSVができました','書き出しの画面から取得できます','dashboard','sent','info',? WHERE changes()=1").bind(crypto.randomUUID(),JSON.stringify({jobId:job.id,staffId:job.requested_by,tenantId:job.tenant_id}))]);
 }catch(e){await db.prepare("UPDATE hq_store_comparison_export_jobs SET status='failed',error_code=? WHERE id=? AND status='pending'").bind(e instanceof GapError?e.code:'export_failed',job.id).run();}
}
