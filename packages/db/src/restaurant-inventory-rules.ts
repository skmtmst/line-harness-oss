import type { RestaurantInventoryRules, RestaurantInventoryRulesInput, RestaurantChannelCloseTask } from '@line-crm/shared';
type RuleRow = {store_id:string;threshold:number;stop_line:number;stop_same_day:number;notify:number;version:number};
export async function getRestaurantInventoryRules(db:D1Database,storeId:string):Promise<RestaurantInventoryRules> {
 const r=await db.prepare('SELECT * FROM rt_inventory_rules WHERE store_id=?').bind(storeId).first<RuleRow>();
 return {storeId,threshold:r?.threshold??2,stopLine:r?!!r.stop_line:false,stopSameDay:r?!!r.stop_same_day:false,notify:r?!!r.notify:true,version:r?.version??0};
}
export function validateRestaurantInventoryRules(b:unknown):b is RestaurantInventoryRulesInput {
 if(!b||typeof b!=='object')return false;const r=b as RestaurantInventoryRulesInput;
 return typeof r.storeId==='string'&&!!r.storeId&&Number.isSafeInteger(r.threshold)&&r.threshold>=0&&r.threshold<=10000
 &&[r.stopLine,r.stopSameDay,r.notify].every(v=>typeof v==='boolean')&&Number.isSafeInteger(r.expectedVersion)&&r.expectedVersion>=0;
}
export async function saveRestaurantInventoryRules(db:D1Database,b:RestaurantInventoryRulesInput):Promise<boolean> {
 const result=await db.prepare(`INSERT INTO rt_inventory_rules(store_id,threshold,stop_line,stop_same_day,notify,version)
 SELECT ?,?,?,?,?,1 WHERE ?=0 OR EXISTS(SELECT 1 FROM rt_inventory_rules WHERE store_id=?)
 ON CONFLICT(store_id) DO UPDATE SET threshold=excluded.threshold,stop_line=excluded.stop_line,
 stop_same_day=excluded.stop_same_day,notify=excluded.notify,version=version+1,updated_at=datetime('now') WHERE version=?`)
 .bind(b.storeId,b.threshold,Number(b.stopLine),Number(b.stopSameDay),Number(b.notify),b.expectedVersion,b.storeId,b.expectedVersion).run();
 return result.meta.changes>0;
}
export async function listRestaurantCloseTasks(db:D1Database,storeId:string):Promise<RestaurantChannelCloseTask[]> {
 const rows=await db.prepare(`SELECT t.*,i.starts_at FROM rt_channel_close_tasks t JOIN rt_inventory_slots i ON i.id=t.slot_id
 WHERE t.store_id=? ORDER BY i.starts_at,t.channel LIMIT 500`).bind(storeId).all<{id:string;store_id:string;slot_id:string;starts_at:string;channel:string;status:RestaurantChannelCloseTask['status'];reason:RestaurantChannelCloseTask['reason'];remaining_seats:number;recipient_ids_json:string;created_at:string;updated_at:string}>();
 const direct=await db.prepare(`SELECT id,store_id,starts_at,channel,status,reservation_id,created_at,updated_at FROM rt_reservation_close_tasks WHERE store_id=? ORDER BY starts_at,channel LIMIT 500`).bind(storeId).all<{id:string;store_id:string;starts_at:string;channel:string;status:RestaurantChannelCloseTask['status'];reservation_id:string;created_at:string;updated_at:string}>();
 const existing=rows.results.map(r=>({id:r.id,storeId:r.store_id,slotId:r.slot_id,startsAt:r.starts_at,channel:r.channel,status:r.status,reason:r.reason,remainingSeats:r.remaining_seats,recipientIds:JSON.parse(r.recipient_ids_json),createdAt:r.created_at,updatedAt:r.updated_at}));
 return [...existing,...direct.results.map(r=>({id:r.id,storeId:r.store_id,slotId:null,reservationId:r.reservation_id,startsAt:r.starts_at,channel:r.channel,status:r.status,reason:'limited' as const,remainingSeats:null,recipientIds:[],createdAt:r.created_at,updatedAt:r.updated_at}))].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.channel.localeCompare(b.channel));
}
