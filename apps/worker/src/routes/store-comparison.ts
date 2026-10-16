import {Hono,type Context} from 'hono';
import type {Env} from '../index.js';
import {GapError} from '../services/gap-common.js';
import {getVisibleLineAccountScope} from '../services/account-access.js';
import {comparisonKeys,comparisonUnits,comparisonPeriod,storeNumbers,type ComparisonKey} from '../services/store-comparison.js';
export const storeComparison=new Hono<Env>();
storeComparison.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'comparison_unavailable'},e instanceof GapError?e.status:503));
async function stores(c:Context<Env>){const s=c.get('staff');if(!s?.tenantId||!['owner','admin'].includes(s.role))throw new GapError('forbidden',403);const member=await c.env.DB.prepare("SELECT id FROM staff_members WHERE id=? AND tenant_id=? AND role IN('owner','admin') AND is_active=1").bind(s.id,s.tenantId).first();if(!member&&c.get('impersonation')?.tenantId!==s.tenantId)throw new GapError('forbidden',403);return (await getVisibleLineAccountScope(c.env.DB,s)).accounts;}
storeComparison.get('/api/hq/store-comparison',async c=>{
 let accounts=await stores(c);const period=comparisonPeriod(c.req.query('from'),c.req.query('to')),compare=c.req.query('compare')??'previous',sort=(c.req.query('sort')??'bookings')as ComparisonKey,page=Number(c.req.query('page')??1),size=Number(c.req.query('pageSize')??20);
 if(!['average','previous'].includes(compare)||!comparisonKeys.includes(sort)||!Number.isSafeInteger(page)||page<1||![10,20,50].includes(size))throw new GapError('invalid_filter');
 const poolId=c.req.query('poolId');
 if(poolId){
  const pool=await c.env.DB.prepare('SELECT p.id FROM traffic_pools p JOIN line_accounts a ON a.id=p.active_account_id WHERE p.id=? AND p.is_active=1 AND a.tenant_id=?').bind(poolId,c.get('staff').tenantId!).first();
  if(!pool)throw new GapError('not_found',404);
  const members=(await c.env.DB.prepare('SELECT line_account_id FROM pool_accounts WHERE pool_id=? AND is_active=1').bind(poolId).all<{line_account_id:string}>()).results;
  accounts=accounts.filter(a=>members.some(m=>m.line_account_id===a.id));
 }
 if(c.req.query('order')&&!['asc','desc'].includes(c.req.query('order')!))throw new GapError('invalid_filter');
 const values=await Promise.all(accounts.map(async a=>({a,...await storeNumbers(c.env.DB,a.id,period)})));
 const average=Object.fromEntries(comparisonKeys.map(k=>{const nums=values.length<3?[]:values.map(v=>v.values[k]).filter((n):n is number=>n!==null);return [k,nums.length>=3?nums.reduce((n,v)=>n+v,0)/nums.length:null];})) as Record<ComparisonKey,number|null>;
 const previous=comparisonPeriod(new Date(Date.parse(period.from)-period.days*86400000).toISOString().slice(0,10),new Date(Date.parse(period.from)-86400000).toISOString().slice(0,10));
 const rows=await Promise.all(values.map(async v=>{const baseline=compare==='average'?average:(await storeNumbers(c.env.DB,v.a.id,previous)).values;return {accountId:v.a.id,name:(await c.env.DB.prepare('SELECT name FROM line_accounts WHERE id=?').bind(v.a.id).first<{name:string}>())?.name??'',style:v.style,computedAt:v.computedAt,metrics:Object.fromEntries(comparisonKeys.map(k=>[k,{value:v.values[k],diff:v.values[k]!==null&&baseline[k]!==null?v.values[k]!-baseline[k]!:null,unit:comparisonUnits[k],available:v.values[k]!==null}]))};}));
 const direction=c.req.query('order')==='desc'?-1:1;rows.sort((a,b)=>{const x=a.metrics[sort].value,y=b.metrics[sort].value;return x===null?(y===null?a.accountId.localeCompare(b.accountId):1):y===null?-1:direction*(x-y)||a.accountId.localeCompare(b.accountId);});
 return c.json({success:true,data:{rows:rows.slice((page-1)*size,page*size),average,total:rows.length,computedAt:values.every(v=>v.computedAt)?values.map(v=>v.computedAt!).sort()[0]??null:null}});
});
storeComparison.get('/api/hq/store-comparison/:accountId',async c=>{
 const id=c.req.param('accountId');if(!(await stores(c)).some(a=>a.id===id))throw new GapError('not_found',404);
 const numbers=await storeNumbers(c.env.DB,id,comparisonPeriod(c.req.query('from'),c.req.query('to')));
 const recent=(await c.env.DB.prepare('SELECT id,title,status,sent_at FROM broadcasts WHERE line_account_id=? ORDER BY created_at DESC LIMIT 3').bind(id).all()).results;
 return c.json({success:true,data:{accountId:id,...numbers,recentBroadcasts:recent,attention:null}});
});
