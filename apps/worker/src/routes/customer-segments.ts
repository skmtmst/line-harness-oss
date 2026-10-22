import { listQueryNumber } from '../lib/list-paging.js';
import {createSavedSearch} from '@line-crm/db';
import {Hono} from 'hono';
import type { Env } from '../worker-env.js';
import {requirePermission} from '../middleware/role-guard.js';
import {GapError,gapAccount,gapBody,gapWrite} from '../services/gap-common.js';
import {segmentName} from '../services/customer-segments.js';
export const customerSegments=new Hono<Env>();
customerSegments.use('/api/analytics/customer-segments*',requirePermission('/analytics'));
customerSegments.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'segments_unavailable'},e instanceof GapError?e.status:503));
const optedOut="EXISTS(SELECT 1 FROM friend_delivery_consents consent WHERE consent.line_account_id=c.account_id AND consent.friend_id=c.friend_id AND consent.purpose='marketing' AND consent.state='revoked')";
function filters(basis='both',measure='count') {if(!['visit','purchase','both'].includes(basis)||!['count','amount'].includes(measure))throw new GapError('invalid_basis');return {basis,column:measure==='amount'?'m_bucket':'f_bucket'};}
customerSegments.get('/api/analytics/customer-segments',async c=>{
 const a=await gapAccount(c),{basis,column}=filters(c.req.query('basis'),c.req.query('measure'));
 const rows=(await c.env.DB.prepare(`SELECT r_bucket r,${column} f,count(*) count,SUM(CASE WHEN ${optedOut} THEN 1 ELSE 0 END) optedOutCount FROM customer_activity_daily c WHERE account_id=? AND basis=? AND r_bucket IS NOT NULL AND ${column} IS NOT NULL GROUP BY r_bucket,${column}`).bind(a,basis).all<{r:number;f:number;count:number;optedOutCount:number}>()).results;
 const names=(await c.env.DB.prepare('SELECT * FROM rfm_segment_names WHERE account_id=?').bind(a).all<{r_bucket:number;f_bucket:number;name:string}>()).results;
 const outside=await c.env.DB.prepare(`SELECT count(*) count FROM customer_activity_daily WHERE account_id=? AND basis=? AND (r_bucket IS NULL OR ${column} IS NULL)`).bind(a,basis).first<{count:number}>();
 const stamp=await c.env.DB.prepare('SELECT computed_at at,status FROM customer_activity_runs WHERE account_id=?').bind(a).first<{at:string|null;status:string}>();
 const cells=Array.from({length:25},(_,i)=>{const r=1+Math.floor(i/5),f=1+i%5,row=rows.find(x=>x.r===r&&x.f===f);return {r,f,name:names.find(n=>n.r_bucket===r&&n.f_bucket===f)?.name??segmentName(r,f),count:stamp?.at?row?.count??0:null,optedOutCount:stamp?.at?row?.optedOutCount??0:null};});
 return c.json({success:true,data:{cells,outside:stamp?.at?outside:{count:null},total:stamp?.at?rows.reduce((n,r)=>n+r.count,0)+(outside?.count??0):null,computedAt:stamp?.at??null,status:stamp?.status??'not_computed'}});
});
customerSegments.get('/api/analytics/customer-segments/cells/:r/:f/friends',async c=>{
 const a=await gapAccount(c),r=Number(c.req.param('r')),f=Number(c.req.param('f')),{basis,column}=filters(c.req.query('basis'),c.req.query('measure')),offset=listQueryNumber(c.req.query('cursor')??c.req.query('offset'), 0);
 const all=r===0&&f===0;if(!all&&![r,f].every(x=>Number.isInteger(x)&&x>=1&&x<=5)||!Number.isSafeInteger(offset)||offset<0)throw new GapError('invalid_filter');
 const where=`c.account_id=? AND c.basis=?${all?'':` AND c.r_bucket=? AND c.${column}=?`}`,binds=all?[a,basis]:[a,basis,r,f];
 const total=await c.env.DB.prepare(`SELECT count(*) n,SUM(CASE WHEN ${optedOut} THEN 1 ELSE 0 END) optedOutCount FROM customer_activity_daily c WHERE ${where}`).bind(...binds).first<{n:number;optedOutCount:number}>();
 const rows=(await c.env.DB.prepare(`SELECT f.id,f.display_name,c.activity_count,c.amount,c.last_activity_at FROM customer_activity_daily c JOIN friends f ON f.id=c.friend_id AND f.line_account_id=c.account_id WHERE ${where} ORDER BY f.id LIMIT 20 OFFSET ?`).bind(...binds,offset).all<Record<string,unknown>>()).results;
 return c.json({success:true,data:{items:rows.map(x=>({...x,display_name:c.get('impersonation')?'（非表示）':x.display_name})),total:total?.n??0,optedOutCount:total?.optedOutCount??0,nextCursor:offset+rows.length<(total?.n??0)?String(offset+rows.length):null}});
});
customerSegments.put('/api/analytics/customer-segments/cells/:r/:f/name',async c=>{
 gapWrite(c,{admin:true});const a=await gapAccount(c),b=await gapBody(c),r=Number(c.req.param('r')),f=Number(c.req.param('f'));if(![r,f].every(x=>Number.isInteger(x)&&x>=1&&x<=5)||typeof b.name!=='string'||!b.name.trim()||b.name.length>50)throw new GapError('invalid_name');
 await c.env.DB.prepare('INSERT INTO rfm_segment_names(account_id,r_bucket,f_bucket,name) VALUES(?,?,?,?) ON CONFLICT(account_id,r_bucket,f_bucket) DO UPDATE SET name=excluded.name').bind(a,r,f,b.name.trim()).run();return c.json({success:true,data:{r,f,name:b.name.trim()}});
});

customerSegments.post('/api/analytics/customer-segments/cells/:r/:f/saved-search',async c=>{
 gapWrite(c);const a=await gapAccount(c),b=await gapBody(c),r=Number(c.req.param('r')),f=Number(c.req.param('f')),{basis}=filters(String(b.basis??'both'),String(b.measure??'count'));
 if(![r,f].every(n=>Number.isInteger(n)&&n>=1&&n<=5)||typeof b.name!=='string'||!b.name.trim()||b.name.length>100)throw new GapError('invalid_name');
 const saved=await createSavedSearch(c.env.DB,{name:b.name.trim(),scope:'friends',conditionFormat:'segment_v1',conditions:{version:1,condition:{operator:'AND',rules:[{type:'customer_segment',value:{r,f,basis,measure:b.measure??'count'}}]}},createdBy:c.get('staff').id,lineAccountId:a,isShared:false,displayOrder:0});
 return c.json({success:true,data:saved},201);
});
