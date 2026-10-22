import { listQueryNumber } from '../lib/list-paging.js';
import type { Hono, MiddlewareHandler } from 'hono';
import { listFriendDeliveryConsents } from '@line-crm/db/src/friend-delivery-consents.js';
import type { Env } from '../worker-env.js';
import { requireRole, denyReadOnly } from '../middleware/role-guard.js';
import { inputJsonBoundary } from '../lib/input-errors.js';

export function registerFriendDeliveryConsents(app: Hono<Env>, visible: MiddlewareHandler<Env>) {
  app.get('/api/friends/:id/delivery-consents/history', requireRole('owner','admin','staff'), visible, async c => {
    c.header('Cache-Control','no-store');
    const limit=listQueryNumber(c.req.query('limit'), 20),cursor=c.req.query('cursor'),purpose=c.req.query('purpose');
    if(![10,20,50].includes(limit)||cursor!==undefined&&(!/^[1-9]\d*$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))||purpose!==undefined&&!/^[a-z][a-z0-9_-]{0,79}$/.test(purpose))return c.json({success:false,error:'目的・ページを確認してください'},400);
    const binds=[c.req.param('id'),purpose??null,purpose??null];
    const where='e.friend_id=? AND (? IS NULL OR e.purpose=?) AND e.line_account_id=(SELECT f.line_account_id FROM friends f WHERE f.id=e.friend_id)';
    const rows=(await c.env.DB.prepare(`SELECT id,purpose,operation,before_json,after_json,created_at FROM friend_delivery_consent_events e WHERE ${where} AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT ?`).bind(...binds,cursor??null,cursor??null,limit+1).all<{id:number;purpose:string;operation:string;before_json:string|null;after_json:string|null;created_at:string}>()).results;
    const total=await c.env.DB.prepare(`SELECT count(*) n FROM friend_delivery_consent_events e WHERE ${where}`).bind(...binds).first<{n:number}>();
    const items=rows.slice(0,limit).map(r=>{
      const before=r.before_json?JSON.parse(r.before_json):null,after=r.after_json?JSON.parse(r.after_json):null;
      const actor=after?{kind:after.source==='liff_self_service'?'self':after.source==='manual'?'store':'system',id:after.updatedBy??null}:{kind:'unknown',id:null};
      return {id:r.id,purpose:r.purpose,operation:r.operation,before,after,actor,reason:after?.reason??null,createdAt:r.created_at};
    });
    return c.json({success:true,data:{items,total:total?.n??0,nextCursor:rows.length>limit?String(items.at(-1)!.id):null}});
  });
  app.get('/api/friends/:id/delivery-consents', requireRole('owner','admin','staff'), visible, async c => {
    return c.json({success:true,data:await listFriendDeliveryConsents(c.env.DB,c.req.param('id'))});
  });
  app.put('/api/friends/:id/delivery-consents/:purpose', requireRole('owner','admin'), denyReadOnly(), visible, inputJsonBoundary(), async c => {
    const b=await c.req.json<Record<string,unknown>>(), purpose=c.req.param('purpose');
    if(!/^[a-z][a-z0-9_-]{0,79}$/.test(purpose)||typeof b.state!=='string'||!['granted','unknown','revoked'].includes(b.state)
      ||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>1000
      ||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0) {
      return c.json({success:false,error:'目的・状態・理由・版を確認してください'},400);
    }
    const result=await c.env.DB.prepare(`INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source,updated_by,version)
      SELECT line_account_id,id,?,?,?,'manual',?,COALESCE((SELECT MAX(CAST(json_extract(COALESCE(e.after_json,e.before_json),'$.version') AS INTEGER)) FROM friend_delivery_consent_events e WHERE e.friend_id=f.id AND e.purpose=?),0)+1 FROM friends f WHERE id=? AND line_account_id IS NOT NULL AND ?=0
      ON CONFLICT(line_account_id,friend_id,purpose) DO NOTHING`)
      .bind(purpose,b.state,b.reason.trim(),c.get('staff').id,purpose,c.req.param('id'),b.expectedVersion).run();
    let changes=result.meta.changes;
    if(Number(b.expectedVersion)>0) {
      const update=await c.env.DB.prepare(`UPDATE friend_delivery_consents SET state=?,reason=?,source='manual',updated_by=?,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE friend_id=? AND purpose=? AND version=?`)
        .bind(b.state,b.reason.trim(),c.get('staff').id,c.req.param('id'),purpose,b.expectedVersion).run();
      changes=update.meta.changes;
    }
    if(!changes)return c.json({success:false,error:'配信停止・同意の状態が変わりました。読み直してください'},409);
    return c.json({success:true,data:await listFriendDeliveryConsents(c.env.DB,c.req.param('id'))});
  });
}
