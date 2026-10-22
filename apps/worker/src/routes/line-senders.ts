import { listQueryNumber } from '../lib/list-paging.js';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { gapAccount,gapBody,gapKey,gapVersion,gapWrite,GapError } from '../services/gap-common.js';
import { senderIcon,senderResponse,validSenderName,type SenderRow } from '../services/line-senders.js';
export const lineSenders=new Hono<Env>();
lineSenders.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:'senders_unavailable'},e instanceof GapError?e.status:503));
lineSenders.get('/api/line-accounts/:id/sender-icons',async c=>{
 const a=await gapAccount(c,c.req.param('id')),offset=listQueryNumber(c.req.query('offset'), 0);
 if(!Number.isSafeInteger(offset)||offset<0)throw new GapError('invalid_pagination');
 const items=(await c.env.DB.prepare("SELECT id,public_url url,filename name,width,height FROM media WHERE line_account_id=? AND archived_at IS NULL AND mime_type IN('image/jpeg','image/png') AND size_bytes<=1048576 AND width>0 AND width=height AND public_url LIKE 'https://%' ORDER BY created_at DESC,id LIMIT 20 OFFSET ?").bind(a,offset).all()).results;
 return c.json({success:true,data:{items,nextOffset:items.length===20?offset+20:null}});
});
lineSenders.get('/api/line-accounts/:id/senders',async c=>{
 const account=await gapAccount(c,c.req.param('id')),staff=c.get('staff');
 const rows=await c.env.DB.prepare(`SELECT s.*,(SELECT COUNT(*) FROM messages_log m WHERE m.sender_id=s.id) usage_count,
   CASE WHEN s.icon_url IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media m WHERE m.id=s.icon_media_id AND m.line_account_id=s.account_id AND m.archived_at IS NULL) THEN 1 ELSE 0 END icon_missing
   FROM line_senders s WHERE account_id=? AND (? IN ('owner','admin') OR visibility='all' OR owner_staff_id=?) ORDER BY updated_at,id`)
   .bind(account,staff.role,staff.id).all<SenderRow & {usage_count:number;icon_missing:number}>();
 return c.json({success:true,data:rows.results.map(r=>({...senderResponse(r),usageCount:r.usage_count,iconMissing:!!r.icon_missing}))});
});
lineSenders.post('/api/line-accounts/:id/senders',async c=>{
 gapWrite(c);const account=await gapAccount(c,c.req.param('id')),key=gapKey(c),b=await gapBody(c),staff=c.get('staff');
 if(!validSenderName(b.name)||!['all','owner_only'].includes(String(b.visibility))) throw new GapError('invalid_sender');
 const owner= b.visibility==='owner_only' ? (typeof b.ownerStaffId==='string'?b.ownerStaffId:staff.id) : null;
 if(staff.role==='staff' && (b.visibility!=='owner_only'||owner!==staff.id)) throw new GapError('forbidden',403);
 if(owner && !await c.env.DB.prepare('SELECT id FROM staff_members WHERE id=? AND tenant_id=? AND is_active=1').bind(owner,staff.tenantId??'default').first()) throw new GapError('invalid_owner');
 const icon=await senderIcon(c.env.DB,account,b.iconMediaId),canonical=JSON.stringify([String(b.name).trim(),b.visibility,owner,icon]);
 let row=await c.env.DB.prepare('SELECT * FROM line_senders WHERE account_id=? AND idempotency_key=?').bind(account,key).first<SenderRow>();
 if(!row) {
  try {await c.env.DB.prepare(`INSERT INTO line_senders(id,account_id,name,icon_media_id,icon_url,visibility,owner_staff_id,created_by,updated_at,idempotency_key,request_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,idempotency_key) DO NOTHING`).bind(crypto.randomUUID(),account,String(b.name).trim(),icon?.id??null,icon?.url??null,b.visibility,owner,staff.id,new Date().toISOString(),key,canonical).run();}
  catch(e) {if(String(e).includes('sender_limit')) throw new GapError('sender_limit',409);throw e;}
  row=await c.env.DB.prepare('SELECT * FROM line_senders WHERE account_id=? AND idempotency_key=?').bind(account,key).first<SenderRow>();
 }
 if(!row||row.request_json!==canonical) throw new GapError('idempotency_conflict',409);
 return c.json({success:true,data:senderResponse(row)},201);
});
lineSenders.on(['PUT','DELETE'],'/api/line-accounts/:id/senders/:senderId',async c=>{
 gapWrite(c);const account=await gapAccount(c,c.req.param('id')),b=await gapBody(c),version=gapVersion(b.expectedVersion),staff=c.get('staff');
 const r=await c.env.DB.prepare('SELECT * FROM line_senders WHERE id=? AND account_id=?').bind(c.req.param('senderId'),account).first<SenderRow>();
 if(!r) throw new GapError('not_found',404);
 if(staff.role==='staff'&&(r.owner_staff_id!==staff.id||r.visibility!=='owner_only')) throw new GapError('forbidden',403);
 const remove=c.req.method==='DELETE';
 if(!remove&&!validSenderName(b.name)) throw new GapError('invalid_sender');
 const icon=remove?null:await senderIcon(c.env.DB,account,b.iconMediaId);
 const result=await c.env.DB.prepare(`UPDATE line_senders SET name=?,icon_media_id=?,icon_url=?,status=?,version=version+1,updated_at=? WHERE id=? AND account_id=? AND version=?`)
 .bind(remove?r.name:String(b.name).trim(),remove?r.icon_media_id:icon?.id??null,remove?r.icon_url:icon?.url??null,remove?'inactive':r.status,new Date().toISOString(),r.id,account,version).run();
 if(!result.meta.changes) throw new GapError('version_conflict',409);
 return c.json({success:true,data:senderResponse((await c.env.DB.prepare('SELECT * FROM line_senders WHERE id=?').bind(r.id).first<SenderRow>())!)});
});
