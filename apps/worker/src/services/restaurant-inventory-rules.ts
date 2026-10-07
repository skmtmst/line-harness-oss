import { getRestaurantInventoryRules } from '@line-crm/db';
import type { Env } from '../index.js';
import { dbFor } from './db-router.js';
import { tzDateStr } from './availability.js';
import { sendAutomaticBookingLine } from './booking-automatic-line.js';

export async function restaurantResponsibleMembers(db:D1Database,storeId:string,date:string) {
 return (await db.prepare(`SELECT m.id,m.line_uid FROM rt_memberships m JOIN rt_stores st ON st.organization_id=m.organization_id
 WHERE st.id=? AND m.status='active' AND (m.store_id IS NULL OR m.store_id=st.id)
 AND (EXISTS(SELECT 1 FROM staff s JOIN staff_shifts sh ON sh.staff_id=s.id
 WHERE s.staff_member_id=m.staff_id AND s.line_account_id=st.line_account_id AND s.is_active=1 AND s.deleted_at IS NULL AND sh.work_date=? AND sh.is_responsible=1)
 OR (m.role='store_manager' AND NOT EXISTS(SELECT 1 FROM rt_memberships dm JOIN staff ds ON ds.staff_member_id=dm.staff_id
 JOIN staff_shifts dsh ON dsh.staff_id=ds.id WHERE dm.organization_id=st.organization_id AND (dm.store_id IS NULL OR dm.store_id=st.id)
 AND dm.status='active' AND ds.line_account_id=st.line_account_id AND ds.is_active=1 AND ds.deleted_at IS NULL AND dsh.work_date=? AND dsh.is_responsible=1))) ORDER BY m.id`)
 .bind(storeId,date,date).all<{id:string;line_uid:string|null}>()).results;
}

async function upsertTask(db:D1Database,input:{storeId:string;slotId:string;channel:string;reason:string;remaining:number;recipientIds:string[]}) {
 const id=crypto.randomUUID();
 await db.prepare(`INSERT INTO rt_channel_close_tasks(id,store_id,slot_id,channel,status,reason,remaining_seats,recipient_ids_json)
 VALUES(?,?,?,?,'close',?,?,?) ON CONFLICT(slot_id,channel) DO UPDATE SET
 status=CASE WHEN status='reopen' OR reason<>excluded.reason THEN 'close' ELSE status END,
 generation=generation+CASE WHEN status='reopen' OR reason<>excluded.reason THEN 1 ELSE 0 END,
 reason=excluded.reason,remaining_seats=excluded.remaining_seats,recipient_ids_json=excluded.recipient_ids_json,updated_at=datetime('now')`)
 .bind(id,input.storeId,input.slotId,input.channel,input.reason,input.remaining,JSON.stringify(input.recipientIds)).run();
 const task=await db.prepare('SELECT id,generation FROM rt_channel_close_tasks WHERE slot_id=? AND channel=?').bind(input.slotId,input.channel).first<{id:string;generation:number}>();
 if(!task)return;
 for(const memberId of input.recipientIds)await db.prepare(`INSERT OR IGNORE INTO rt_inventory_notification_outbox
 (id,task_id,generation,membership_id,retry_key) VALUES(?,?,?,?,?)`).bind(crypto.randomUUID(),task.id,task.generation,memberId,crypto.randomUUID()).run();
}

/** 判定は卓の占有席を使う。未配席の人数も差し引き、枠をまたぐ滞在も含む。 */
export async function reconcileRestaurantInventory(env:Env['Bindings'],storeId:string) {
 const db=dbFor(env,storeId);
 const rule=await getRestaurantInventoryRules(db,storeId);
 if(!rule.version)return;
 const queue=await db.prepare('SELECT generation FROM rt_inventory_rule_queue WHERE store_id=?').bind(storeId).first<{generation:number}>();
 const store=await db.prepare('SELECT timezone FROM rt_stores WHERE id=?').bind(storeId).first<{timezone:string}>();
 if(!store)return;
 const slots=await db.prepare(`SELECT id,starts_at,total_capacity-occupied_seats-unassigned_guests AS remaining
 FROM rt_inventory_occupancy WHERE store_id=? AND datetime(starts_at)>datetime('now','-1 day')`).bind(storeId).all<{id:string;starts_at:string;remaining:number}>();
 const media=await db.prepare("SELECT code FROM rt_media WHERE is_active=1 AND code NOT IN ('line','manual','phone')").all<{code:string}>();
 for(const slot of slots.results) {
  if(slot.remaining>rule.threshold||!rule.notify) {
   await db.prepare(`UPDATE rt_channel_close_tasks SET status='reopen',updated_at=datetime('now') WHERE slot_id=? AND status<>'reopen' AND reason<>'table_conflict'`).bind(slot.id).run();
   continue;
  }
  const members=await restaurantResponsibleMembers(db,storeId,tzDateStr(store.timezone,new Date(slot.starts_at)));
  for(const m of media.results)await upsertTask(db,{storeId,slotId:slot.id,channel:m.code,reason:slot.remaining<=0?'full':'limited',remaining:slot.remaining,recipientIds:members.map(m=>m.id)});
 }
 // 古い回収が新しい予約の変更を消さない。
 if(queue)await db.prepare('DELETE FROM rt_inventory_rule_queue WHERE store_id=? AND generation=?').bind(storeId,queue.generation).run();
 await dispatchRestaurantInventoryNotices(env,storeId);
}

/** 取り込みを拒否した重複予約も、画面のタスクと担当LINEへ知らせる。顧客本文は残さない。 */
export async function recordRestaurantTableConflict(env:Env['Bindings'],storeId:string,startsAt:string,tableId:string) {
 const db=dbFor(env,storeId);const rule=await getRestaurantInventoryRules(db,storeId);if(!rule.version||!rule.notify)return;
 const slot=await db.prepare(`SELECT id,starts_at FROM rt_inventory_slots WHERE store_id=?
 AND datetime(starts_at)<=datetime(?) AND datetime(starts_at,'+'||slot_minutes||' minutes')>datetime(?) LIMIT 1`).bind(storeId,startsAt,startsAt).first<{id:string;starts_at:string}>();
 const store=await db.prepare('SELECT timezone FROM rt_stores WHERE id=?').bind(storeId).first<{timezone:string}>();
 if(!slot||!store)return;
 const members=await restaurantResponsibleMembers(db,storeId,tzDateStr(store.timezone,new Date(startsAt)));
 await upsertTask(db,{storeId,slotId:slot.id,channel:'table:'+tableId,reason:'table_conflict',remaining:0,recipientIds:members.map(m=>m.id)});
 await dispatchRestaurantInventoryNotices(env,storeId);
}

export async function dispatchRestaurantInventoryNotices(env:Env['Bindings'],storeId?:string) {
 const db=dbFor(env,storeId);
 const rows=await db.prepare(`SELECT o.id,o.retry_key,o.membership_id,t.reason,t.channel,t.remaining_seats,t.store_id,i.starts_at,
 s.line_account_id,s.name,m.line_uid FROM rt_inventory_notification_outbox o JOIN rt_channel_close_tasks t ON t.id=o.task_id
 JOIN rt_inventory_rules ru ON ru.store_id=t.store_id JOIN rt_inventory_slots i ON i.id=t.slot_id
 JOIN rt_stores s ON s.id=t.store_id JOIN rt_memberships m ON m.id=o.membership_id
 WHERE o.sent_at IS NULL AND (o.lease_until IS NULL OR datetime(o.lease_until)<=datetime('now'))
 AND o.generation=t.generation AND t.status='close' AND ru.notify=1 AND m.status='active'
 AND (? IS NULL OR t.store_id=?) LIMIT 100`).bind(storeId??null,storeId??null).all<{id:string;retry_key:string;membership_id:string;reason:string;channel:string;remaining_seats:number;store_id:string;starts_at:string;line_account_id:string;name:string;line_uid:string|null}>();
 for(const row of rows.results) {
  if(!row.line_uid||!row.line_account_id)continue;
  const lease=crypto.randomUUID();
  const claim=await db.prepare(`UPDATE rt_inventory_notification_outbox SET lease_until=datetime('now','+5 minutes'),lease_token=?
 WHERE id=? AND sent_at IS NULL AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))`).bind(lease,row.id).run();
  if(!claim.meta.changes)continue;
  try {
   const text=row.reason==='table_conflict'?`${row.name}の同じ卓に予約が重なりました。予約管理で卓の付け替えを確認してください。`:
    `${row.name} ${row.starts_at}は${row.reason==='full'?'満席':'残り'+Math.max(0,row.remaining_seats)+'席'}です。${row.channel}の受付を閉じてください。`;
   const sent=await sendAutomaticBookingLine(env,{accountId:row.line_account_id,to:row.line_uid,text,retryKey:row.retry_key,featureId:'restaurant_test'});
   if(sent)await db.prepare("UPDATE rt_inventory_notification_outbox SET sent_at=datetime('now') WHERE id=? AND lease_token=?").bind(row.id,lease).run();
  }catch { /* 送信失敗は予約の保存結果を変えない。同じキーで再試行する。 */ }
 }
}

export async function processRestaurantInventoryRuleQueue(env:Env['Bindings']) {
 const db=dbFor(env);
 const stores=await db.prepare('SELECT store_id FROM rt_inventory_rule_queue ORDER BY updated_at LIMIT 100').all<{store_id:string}>();
 for(const store of stores.results)await reconcileRestaurantInventory(env,store.store_id);
 await dispatchRestaurantInventoryNotices(env);
}
