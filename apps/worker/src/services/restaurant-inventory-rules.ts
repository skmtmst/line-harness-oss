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

async function reconcileDirectBookingTasks(db:D1Database,storeId:string,timezone:string,notify:boolean) {
 const reservations=(await db.prepare(`SELECT id,starts_at,ends_at,status FROM rt_reservations WHERE store_id=? AND source IN ('line','phone')
   AND datetime(ends_at)>datetime('now','-1 day')`).bind(storeId).all<{id:string;starts_at:string;ends_at:string;status:string}>()).results;
 const media=(await db.prepare(`SELECT m.code FROM rt_store_media_links l JOIN rt_media m ON m.id=l.media_id WHERE l.store_id=? AND l.close_on_booking=1 AND m.accepts_reservations=1`).bind(storeId).all<{code:string}>()).results;
 for(const r of reservations) {
   if(['cancelled','no_show'].includes(r.status)||Date.parse(r.ends_at)<=Date.now()||!notify){await db.prepare(`UPDATE rt_reservation_close_tasks SET status='reopen',generation=generation+1,updated_at=datetime('now') WHERE reservation_id=? AND status<>'reopen'`).bind(r.id).run();continue;}
   await db.prepare("UPDATE rt_reservation_close_tasks SET status='reopen',generation=generation+1,updated_at=datetime('now') WHERE reservation_id=? AND starts_at<>? AND status<>'reopen'").bind(r.id,r.starts_at).run();
   const members=await restaurantResponsibleMembers(db,storeId,tzDateStr(timezone,new Date(r.starts_at)));
   for(const m of media) {
    await db.prepare(`INSERT INTO rt_reservation_close_tasks(id,store_id,reservation_id,channel,starts_at,status) VALUES(?,?,?,?,?,'close')
      ON CONFLICT(reservation_id,channel,starts_at) DO UPDATE SET status=CASE WHEN status='reopen' THEN 'close' ELSE status END,
      generation=generation+CASE WHEN status='reopen' THEN 1 ELSE 0 END,updated_at=datetime('now')`)
      .bind(crypto.randomUUID(),storeId,r.id,m.code,r.starts_at).run();
    const task=await db.prepare('SELECT id,generation FROM rt_reservation_close_tasks WHERE reservation_id=? AND channel=? AND starts_at=?').bind(r.id,m.code,r.starts_at).first<{id:string;generation:number}>();
    for(const member of members)await db.prepare('INSERT OR IGNORE INTO rt_reservation_close_outbox(id,task_id,generation,membership_id,retry_key) VALUES(?,?,?,?,?)')
      .bind(crypto.randomUUID(),task!.id,task!.generation,member.id,crypto.randomUUID()).run();
   }
 }
 await db.prepare(`UPDATE rt_reservation_close_tasks SET status='reopen',generation=generation+1,updated_at=datetime('now') WHERE store_id=? AND status<>'reopen'
   AND NOT EXISTS(SELECT 1 FROM rt_store_media_links l JOIN rt_media m ON m.id=l.media_id WHERE l.store_id=? AND l.close_on_booking=1 AND m.code=rt_reservation_close_tasks.channel)`).bind(storeId,storeId).run();
 const reopen=(await db.prepare("SELECT id,generation,starts_at FROM rt_reservation_close_tasks WHERE store_id=? AND status='reopen'").bind(storeId).all<{id:string;generation:number;starts_at:string}>()).results;
 for(const task of reopen){const members=await restaurantResponsibleMembers(db,storeId,tzDateStr(timezone,new Date(task.starts_at)));
   for(const member of members)await db.prepare('INSERT OR IGNORE INTO rt_reservation_close_outbox(id,task_id,generation,membership_id,retry_key) VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(),task.id,task.generation,member.id,crypto.randomUUID()).run();}

}
async function dispatchDirectBookingNotices(env:Env['Bindings'],storeId:string) {
 const db=dbFor(env,storeId),rows=(await db.prepare(`SELECT o.id,o.retry_key,t.channel,t.starts_at,t.status,s.line_account_id,s.name,s.timezone,m.line_uid
   FROM rt_reservation_close_outbox o JOIN rt_reservation_close_tasks t ON t.id=o.task_id JOIN rt_stores s ON s.id=t.store_id
   JOIN rt_memberships m ON m.id=o.membership_id LEFT JOIN rt_inventory_rules r ON r.store_id=t.store_id
   WHERE t.store_id=? AND t.status IN ('close','reopen') AND o.generation=t.generation AND o.sent_at IS NULL AND m.status='active'
   AND COALESCE(r.notify,1)=1 AND (o.lease_until IS NULL OR datetime(o.lease_until)<=datetime('now')) LIMIT 100`).bind(storeId)
   .all<{id:string;retry_key:string;channel:string;starts_at:string;status:'close'|'reopen';line_account_id:string|null;name:string;timezone:string;line_uid:string|null}>()).results;
 for(const r of rows){if(!r.line_account_id||!r.line_uid)continue;const token=crypto.randomUUID();
   const claim=await db.prepare(`UPDATE rt_reservation_close_outbox SET lease_until=datetime('now','+5 minutes'),lease_token=? WHERE id=? AND sent_at IS NULL AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))`).bind(token,r.id).run();
   if(!claim.meta.changes)continue;
   try{if(await sendAutomaticBookingLine(env,{accountId:r.line_account_id,to:r.line_uid,text:`${r.name} ${new Intl.DateTimeFormat('ja-JP',{timeZone:r.timezone,month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'}).format(new Date(r.starts_at))} ${r.status==='reopen'?`${r.channel}の受付は、もう開けてよい状態です。`:`に予約が入りました。${r.channel}の受付を閉じてください。`}`,retryKey:r.retry_key,featureId:'restaurant_test'}))
     await db.prepare("UPDATE rt_reservation_close_outbox SET sent_at=datetime('now') WHERE id=? AND lease_token=?").bind(r.id,token).run();}catch{/* 同じキーで次の定期処理から再試行 */}
 }
}
/** 判定は卓の占有席を使う。未配席の人数も差し引き、枠をまたぐ滞在も含む。 */
export async function reconcileRestaurantInventory(env:Env['Bindings'],storeId:string) {
 const db=dbFor(env,storeId);
 const rule=await getRestaurantInventoryRules(db,storeId);

 const queue=await db.prepare('SELECT generation FROM rt_inventory_rule_queue WHERE store_id=?').bind(storeId).first<{generation:number}>();
 const store=await db.prepare('SELECT timezone FROM rt_stores WHERE id=?').bind(storeId).first<{timezone:string}>();
 if(!store)return;
 await reconcileDirectBookingTasks(db,storeId,store.timezone,rule.notify);
 const slots=await db.prepare(`SELECT id,starts_at,total_capacity-occupied_seats-unassigned_guests AS remaining
 FROM rt_inventory_occupancy WHERE store_id=? AND datetime(starts_at)>datetime('now','-1 day')`).bind(storeId).all<{id:string;starts_at:string;remaining:number}>();
 const media=await db.prepare(`SELECT m.code FROM rt_store_media_links l JOIN rt_media m ON m.id=l.media_id
 WHERE l.store_id=? AND l.close_on_booking=1 AND m.accepts_reservations=1`).bind(storeId).all<{code:string}>();
 for(const slot of rule.version ? slots.results : []) {
  const direct=await db.prepare(`SELECT 1 FROM rt_reservations WHERE store_id=? AND source IN ('line','phone')
    AND status NOT IN ('cancelled','no_show') AND datetime(starts_at)<datetime(?,'+'||(SELECT slot_minutes FROM rt_inventory_slots WHERE id=?)||' minutes')
    AND datetime(ends_at)>datetime(?) LIMIT 1`).bind(storeId,slot.starts_at,slot.id,slot.starts_at).first();
  if(direct||slot.remaining>rule.threshold||!rule.notify) {
   await db.prepare(`UPDATE rt_channel_close_tasks SET status='reopen',updated_at=datetime('now') WHERE slot_id=? AND status<>'reopen' AND reason<>'table_conflict'`).bind(slot.id).run();
   continue;
  }
  const members=await restaurantResponsibleMembers(db,storeId,tzDateStr(store.timezone,new Date(slot.starts_at)));
  for(const m of media.results)await upsertTask(db,{storeId,slotId:slot.id,channel:m.code,reason:slot.remaining<=0?'full':'limited',remaining:slot.remaining,recipientIds:members.map(m=>m.id)});
 }
 // 古い回収が新しい予約の変更を消さない。
 if(queue)await db.prepare('DELETE FROM rt_inventory_rule_queue WHERE store_id=? AND generation=?').bind(storeId,queue.generation).run();
 await dispatchRestaurantInventoryNotices(env,storeId);
 await dispatchDirectBookingNotices(env,storeId);
 await dispatchClosureNotices(env,storeId);
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
 LEFT JOIN rt_inventory_rules ru ON ru.store_id=t.store_id JOIN rt_inventory_slots i ON i.id=t.slot_id
 JOIN rt_stores s ON s.id=t.store_id JOIN rt_memberships m ON m.id=o.membership_id
 WHERE o.sent_at IS NULL AND (o.lease_until IS NULL OR datetime(o.lease_until)<=datetime('now'))
 AND o.generation=t.generation AND t.status='close' AND COALESCE(ru.notify,1)=1 AND m.status='active'
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
 const pending=(await db.prepare(`SELECT DISTINCT t.store_id FROM rt_reservation_close_outbox o JOIN rt_reservation_close_tasks t ON t.id=o.task_id WHERE o.sent_at IS NULL AND t.status='close' LIMIT 100`).all<{store_id:string}>()).results;
 for(const s of pending)await dispatchDirectBookingNotices(env,s.store_id);
 const closures=await db.prepare("SELECT DISTINCT store_id FROM rt_closure_close_tasks WHERE status IN ('close','reopen')").all<{store_id:string}>();
 for(const s of closures.results)await dispatchClosureNotices(env,s.store_id);
}

/** 自動の媒体作業通知。顧客への1対1連絡は既存チャットから担当者が送る。 */
async function dispatchClosureNotices(env:Env['Bindings'],storeId:string) {
 const db=dbFor(env,storeId);
 const tasks=(await db.prepare(`SELECT t.*,s.timezone,s.name,s.line_account_id FROM rt_closure_close_tasks t JOIN rt_stores s ON s.id=t.store_id WHERE t.store_id=? AND t.status IN ('close','reopen')`).bind(storeId)
 .all<{id:string;generation:number;channel:string;kind:string;start_date:string;end_date:string;all_day:number;start_time:string|null;end_time:string|null;status:string;timezone:string;name:string;line_account_id:string|null}>()).results;
 for(const task of tasks){
  const members=await restaurantResponsibleMembers(db,storeId,task.start_date);
  for(const member of members)await db.prepare('INSERT OR IGNORE INTO rt_closure_close_outbox(id,task_id,generation,membership_id,retry_key) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),task.id,task.generation,member.id,crypto.randomUUID()).run();
 }
 const rows=(await db.prepare(`SELECT o.id,o.retry_key,t.channel,t.kind,t.start_date,t.end_date,t.all_day,t.start_time,t.end_time,t.status,s.name,s.line_account_id,m.line_uid
 FROM rt_closure_close_outbox o JOIN rt_closure_close_tasks t ON t.id=o.task_id JOIN rt_stores s ON s.id=t.store_id JOIN rt_memberships m ON m.id=o.membership_id
 LEFT JOIN rt_inventory_rules r ON r.store_id=t.store_id WHERE t.store_id=? AND o.generation=t.generation AND t.status IN ('close','reopen') AND o.sent_at IS NULL
 AND m.status='active' AND COALESCE(r.notify,1)=1 AND (o.lease_until IS NULL OR datetime(o.lease_until)<=datetime('now')) LIMIT 100`).bind(storeId)
 .all<{id:string;retry_key:string;channel:string;kind:string;start_date:string;end_date:string;all_day:number;start_time:string|null;end_time:string|null;status:string;name:string;line_account_id:string|null;line_uid:string|null}>()).results;
 for(const r of rows){if(!r.line_account_id||!r.line_uid)continue;const token=crypto.randomUUID();
  const lease=await db.prepare(`UPDATE rt_closure_close_outbox SET lease_until=datetime('now','+5 minutes'),lease_token=? WHERE id=? AND sent_at IS NULL AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))`).bind(token,r.id).run();
  if(!lease.meta.changes)continue;
  const kind=({temporary_closed:'臨時休業',private_event:'貸切',maintenance:'設備点検',other:'その他'} as Record<string,string>)[r.kind];
  const dates=r.start_date===r.end_date?r.start_date:r.start_date+'〜'+r.end_date,time=r.all_day?'終日':r.start_time+'〜'+r.end_time;
  try {if(await sendAutomaticBookingLine(env,{accountId:r.line_account_id,to:r.line_uid,text:`${r.name} ${dates} ${time}（${kind}）: ${r.channel}の受付を${r.status==='reopen'?'もう開けてよい状態です。':'閉じてください。'}`,retryKey:r.retry_key,featureId:'restaurant_test'}))await db.prepare("UPDATE rt_closure_close_outbox SET sent_at=datetime('now') WHERE id=? AND lease_token=?").bind(r.id,token).run();}catch{/* 同じキーで次回再試行 */}
 }
}
