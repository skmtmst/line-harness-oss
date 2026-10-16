import type { Hono, MiddlewareHandler } from 'hono';
import { listFriendDeliveryConsents } from '@line-crm/db/src/friend-delivery-consents.js';
import type { Env } from '../index.js';
import { requireRole, denyReadOnly } from '../middleware/role-guard.js';
import { inputJsonBoundary } from '../lib/input-errors.js';

export function registerFriendDeliveryConsents(app: Hono<Env>, visible: MiddlewareHandler<Env>) {
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
